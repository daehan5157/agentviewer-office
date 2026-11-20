// Always-on process scan (macOS / Linux). Finds:
//  • agent CLIs (Claude Code, Codex, Gemini, Aider, OpenCode, Goose, ...)
//  • LLM desktop apps (Claude, ChatGPT, Cursor, Windsurf, LM Studio, Ollama)
//  • MCP server processes and which agent/app launched them
// and links running processes to transcript sessions (alive / closed).
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { base, sha256, oneLine } from '../util.js';

export const AGENT_DEFS = [
  { key: 'claude', client: 'Claude Code', vendor: 'anthropic', bins: ['claude'], pkg: /@anthropic-ai\/claude-code/, transcript: true },
  { key: 'codex', client: 'Codex', vendor: 'openai', bins: ['codex'], pkg: /@openai\/codex/, transcript: true },
  { key: 'gemini', client: 'Gemini CLI', vendor: 'google', bins: ['gemini'], pkg: /@google\/gemini-cli/, transcript: true },
  { key: 'aider', client: 'Aider', vendor: 'other', bins: ['aider'], pkg: /aider-chat/ },
  { key: 'opencode', client: 'OpenCode', vendor: 'other', bins: ['opencode'], pkg: /opencode-ai/ },
  { key: 'goose', client: 'Goose', vendor: 'other', bins: ['goose'] },
  { key: 'cursor-agent', client: 'Cursor Agent', vendor: 'other', bins: ['cursor-agent'] },
  { key: 'amp', client: 'Amp', vendor: 'other', bins: ['amp'], pkg: /@sourcegraph\/amp/ },
  { key: 'qwen', client: 'Qwen Code', vendor: 'other', bins: ['qwen'], pkg: /@qwen-code\/qwen-code/ },
  { key: 'copilot', client: 'Copilot CLI', vendor: 'other', bins: ['copilot'], pkg: /@github\/copilot/ },
  { key: 'crush', client: 'Crush', vendor: 'other', bins: ['crush'] },
  { key: 'kiro', client: 'Kiro CLI', vendor: 'other', bins: ['kiro-cli'] },
  { key: 'cline', client: 'Cline CLI', vendor: 'other', bins: ['cline'] },
  { key: 'continue', client: 'Continue CLI', vendor: 'other', bins: ['cn'], pkg: /@continuedev\/cli/ },
  { key: 'llm', client: 'llm CLI', vendor: 'other', bins: ['llm'], args: /^(chat|prompt)\b/ },
  { key: 'ollama-run', client: 'Ollama', vendor: 'other', bins: ['ollama'], args: /^run\b/ },
];

const NOT_HELPER = String.raw`"?(?!.*(--type=|daemon-entry|cli[\\/]index\.js))`;
const appRe = (mac, win) => new RegExp(`${mac ? `\\/${mac}\\.app\\/Contents\\/MacOS\\/[^/]+?(\\s|$)${NOT_HELPER}` : '(?!)'}|${win ? `\\\\${win}\\.exe${NOT_HELPER}` : '(?!)'}`, 'i');

export const APP_DEFS = [
  { key: 'claude-app', client: 'Claude 앱', vendor: 'anthropic', door: 'app', channel: 'Desktop 앱', re: new RegExp(`\\/Claude\\.app\\/Contents\\/MacOS\\/Claude(\\s|$)${NOT_HELPER}|AnthropicClaude\\\\(app-[^\\\\]+\\\\)?claude\\.exe${NOT_HELPER}|WindowsApps\\\\Claude_[^\\\\]+\\\\app\\\\claude\\.exe${NOT_HELPER}`, 'i') },
  { key: 'chatgpt-app', client: 'ChatGPT 앱', vendor: 'openai', door: 'app', channel: 'Desktop 앱', re: appRe('ChatGPT', 'ChatGPT') },
  { key: 'cursor-app', client: 'Cursor', vendor: 'other', door: 'ide', channel: 'Cursor', re: appRe('Cursor', 'Cursor') },
  { key: 'windsurf-app', client: 'Windsurf', vendor: 'other', door: 'ide', channel: 'Windsurf', re: appRe('Windsurf', 'Windsurf') },
  { key: 'lmstudio-app', client: 'LM Studio', vendor: 'other', door: 'app', channel: 'Desktop 앱', re: appRe('LM Studio', 'LM Studio') },
  { key: 'ollama-serve', client: 'Ollama 서버', vendor: 'other', door: 'api', channel: '로컬 LLM', re: /(^|[\\/])ollama(\.exe)?"? serve(\s|$)/i },
  // Orca agent development environment (stablyai/orca): the main window process only
  { key: 'orca-app', client: 'Orca', vendor: 'other', door: 'app', channel: 'Orca', orchestrator: true, re: new RegExp(`${appRe('Orca', 'Orca').source}|(^|\\/)orca-ide(\\s|$)${NOT_HELPER}`, 'i') },
];

// Orca keeps every agent terminal inside its "Orca Agents" terminal daemon (daemon → $SHELL → claude/codex/…)
export const ORCA_HOST_RE = /Orca Agents|(^|[\\/])orca-agents(\s|$)|orca.*daemon-entry\.js.*--socket/i;
const IDE_RE = /Visual Studio Code|Code Helper|\/code(\s|$)|Cursor\.app|Windsurf|JetBrains|IntelliJ|PyCharm|WebStorm|GoLand|Zed\.app/i;
const WRAPPERS = new Set(['node', 'nodejs', 'bun', 'deno', 'python', 'python3', 'pythonw', 'py', 'npx', 'bunx', 'pnpm', 'uv', 'uvx', 'pipx', 'tsx', 'ts-node']);
const isWrapper = (exe) => WRAPPERS.has(exe) || /^python[\d.]*w?$/.test(exe);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'cmd', 'powershell', 'pwsh', 'login', 'conhost', 'wsl']);
const NOT_MCP = new Set(['grep', 'rg', 'ps', 'tail', 'head', 'less', 'cat', 'vim', 'nvim', 'sed', 'awk', 'find', 'ls', 'git', 'tmux', 'screen', 'ssh', 'lsof']);

export function parseEtime(s) {
  const m = String(s || '').trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]);
}

/** Split a command line, keeping "quoted paths with spaces" together (Windows). */
export function splitCmdline(s) {
  return (String(s || '').match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, ''));
}

/** Parse the JSON produced by WIN_PS_SCRIPT. */
export function parseWinProcs(out) {
  const s = String(out || '').trim();
  if (!s) return [];
  let rows = JSON.parse(s.slice(s.indexOf(s.startsWith('[') ? '[' : '{')));
  if (!Array.isArray(rows)) rows = [rows];
  const procs = [];
  for (const r of rows) {
    const args = String(r.c || r.n || '').trim();
    if (!args || !r.p) continue;
    // cpu (%) is filled in by the scanner from the change in cpuMs between two scans
    procs.push({ pid: +r.p, ppid: +r.pp || 0, cpu: 0, cpuMs: r.t == null ? undefined : +r.t, age: Math.max(0, +r.a || 0), args, tokens: splitCmdline(args) });
  }
  return procs;
}

/** pids with an established TCP connection *to* `port`, from `netstat -ano` (Windows). */
export function parseNetstatClients(out, port) {
  const pids = new Set();
  for (const line of String(out || '').split('\n')) {
    const m = line.trim().match(/^TCP\s+\S+\s+(\S+)\s+ESTABLISHED\s+(\d+)$/i);
    if (m && m[1].endsWith(`:${port}`)) pids.add(+m[2]);
  }
  return [...pids];
}

/** pids with an established TCP connection to `port`, from `lsof -Fpn` (macOS / Linux). */
export function parseLsofClients(out, port) {
  const pids = new Set();
  let pid = 0;
  for (const line of String(out || '').split('\n')) {
    if (line[0] === 'p') pid = +line.slice(1);
    else if (line[0] === 'n' && line.includes('->') && line.endsWith(`:${port}`)) pids.add(pid);
  }
  return [...pids];
}

function ollamaBaseUrl() {
  let h = (process.env.OLLAMA_HOST || '').trim();
  if (!h) return 'http://127.0.0.1:11434';
  if (!/^https?:\/\//.test(h)) h = `http://${h}`;
  try {
    const u = new URL(h);
    if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1';
    if (!u.port) u.port = '11434';
    return u.origin;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

const OLLAMA_RUNNER_RE = /(^|[\\/])(llama-server|ollama_llama_server)(\.exe)?"?(\s|$)|(^|[\\/])ollama(\.exe)?"? runner(\s|$)/i;
const OLLAMA_BUSY_CPU = 20; // % of one core, averaged over a scan interval
const OLLAMA_HOLD_MS = 8000; // keep showing "working" briefly so a 2-second request doesn't flicker

export const WIN_PS_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
  '$now=Get-Date',
  'Get-CimInstance Win32_Process | ForEach-Object { $a=0; if ($_.CreationDate) { $a=[long](($now-$_.CreationDate).TotalSeconds) }; [pscustomobject]@{p=$_.ProcessId;pp=$_.ParentProcessId;n=$_.Name;c=$_.CommandLine;a=$a;t=[long](([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000)} } | ConvertTo-Json -Compress',
].join('; ');

export function parsePs(out) {
  const procs = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const args = m[5].trim();
    if (!args || args.startsWith('[')) continue; // kernel threads
    procs.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], age: parseEtime(m[4]), args, tokens: args.split(/\s+/) });
  }
  return procs;
}

function exeAndRest(p) {
  let exe = base(p.tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  let rest = p.tokens.slice(1);
  if (isWrapper(exe)) {
    const i = rest.findIndex((x) => !x.startsWith('-') && x !== 'exec' && x !== 'run');
    if (i >= 0) {
      exe = base(rest[i]).toLowerCase().replace(/\.(m?js|cjs|py|exe)$/, '');
      rest = rest.slice(i + 1);
    }
  }
  return { exe, rest };
}

export function identifyAgent(p) {
  // Electron helper processes (renderer, gpu, crashpad, …) of desktop apps whose exe is also named claude.exe
  if (/\s--type=[a-z-]+/i.test(p.args)) return null;
  const { exe, rest } = exeAndRest(p);
  for (const d of AGENT_DEFS) {
    if (!(d.bins.includes(exe) || (d.pkg && d.pkg.test(p.args)))) continue;
    if (d.args && !d.args.test(rest.join(' '))) continue;
    if (rest[0] === 'mcp' || rest[0] === 'mcp-server' || rest.some((x) => x === '--version' || x === '--help')) return null;
    return d;
  }
  return null;
}

export function mcpNameFromPkg(pkg) {
  let n = String(pkg || '');
  n = n.replace(/^@modelcontextprotocol\/server-/i, '');
  if (n.startsWith('@')) {
    const [scope, rest = ''] = n.slice(1).split('/');
    n = !rest || /^(mcp|mcp-server|server)$/i.test(rest) ? scope : rest;
  }
  n = n
    .replace(/[-_.]?mcp[-_.]?server[-_.]?/i, '-')
    .replace(/^mcp[-_.]/i, '')
    .replace(/[-_.]mcp$/i, '')
    .replace(/^server[-_.]/i, '')
    .replace(/[-_.]server$/i, '')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return n || 'mcp';
}

/** Returns an MCP server name if this process looks like one. */
export function identifyMcp(p) {
  if (!/mcp|modelcontextprotocol/i.test(p.args) || /agentviewer/i.test(p.args)) return null;
  const exe = base(p.tokens[0] || '').toLowerCase().replace(/\.exe$/, '');
  if (SHELLS.has(exe) || NOT_MCP.has(exe)) return null;
  const { exe: real, rest } = exeAndRest(p);
  if (['claude', 'codex', 'gemini'].includes(real)) {
    if ((rest[0] === 'mcp' && rest[1] === 'serve') || rest[0] === 'mcp-server') return real === 'claude' ? 'claude-code' : real;
    return null;
  }
  const tok = p.tokens.find((x) => /mcp|modelcontextprotocol/i.test(x) && !x.startsWith('-'));
  if (!tok) return null;
  const tokN = tok.replace(/\\/g, '/');
  let pkg = tokN;
  const nm = tokN.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (nm && nm[1] !== '.bin') pkg = nm[1];
  else if (tokN.includes('/') && !tokN.startsWith('@')) {
    // …/slack-mcp-server/dist/index.js → slack-mcp-server
    const segs = tokN.split(/\/+/).filter(Boolean);
    const named = [...segs].reverse().find((s) => /mcp/i.test(s) && !/^mcp$/i.test(s));
    pkg = named || base(tokN);
  }
  pkg = pkg.replace(/\.(m?js|cjs|ts|py|exe)$/i, '').replace(/@(latest|[\d^~][\w.-]*)$/, '');
  if (/^mcp-(remote|proxy)$/i.test(pkg)) {
    const url = p.tokens.find((x) => /^https?:\/\//.test(x));
    if (url) {
      try {
        return new URL(url).host.replace(/^(www|api|mcp)\./, '').split('.')[0];
      } catch {}
    }
  }
  return mcpNameFromPkg(pkg);
}

const LAUNCH_FORMS = [
  [/^npm$/, /^exec$/], [/^pnpm$/, /^dlx$/], [/^uv$/, /^(run|tool)$/], [/^docker$/, /^run$/],
  [/^(npx|bunx|uvx|pipx)$/, null], [/^yarn$/, /^dlx$/],
];

/**
 * A long-lived child an agent/app launched through npx/uvx/docker/... is
 * almost always an MCP server even when "mcp" is not in its name
 * (e.g. `npm exec @wonderwhy-er/desktop-commander`).
 */
export function identifyLaunchedServer(p) {
  const exe = base(p.tokens[0] || '').toLowerCase();
  const form = LAUNCH_FORMS.find(([e, sub]) => e.test(exe) && (!sub || sub.test(p.tokens[1] || '')));
  if (!form) return null;
  const start = form[1] ? 2 : 1;
  const pkg = p.tokens.slice(start).find((x) => !x.startsWith('-') && !/^(run|tool|--)$/.test(x) && !/^(-i|--rm)$/.test(x));
  if (!pkg) return null;
  const clean = (pkg.startsWith('@') ? pkg : base(pkg)).replace(/@(latest|[\d^~][\w.-]*)$/, '').replace(/:[\w.-]+$/, '');
  return mcpNameFromPkg(clean) || null;
}

export class ProcessScanner {
  constructor(store, opts = {}) {
    this.store = store;
    this.platform = opts.platform || process.platform;
    this.intervalMs = opts.intervalMs ?? (this.platform === 'win32' ? 5000 : 3000);
    this.custom = opts.customProcesses || [];
    this.cwdCache = new Map();
    this.claudeSessionsDir = opts.claudeSessionsDir ?? path.join(os.homedir(), '.claude', 'sessions');
    this.procAgents = new Set();
    this.lastDetail = new Map();
    this.cpuPrev = new Map(); // pid → { ms, at } (Windows: CPU% comes from the CPU-time delta)
    this.ollamaUrl = opts.ollamaUrl ?? ollamaBaseUrl();
    this.ollamaBusyAt = 0;
    this.supported = ['darwin', 'linux', 'win32'].includes(this.platform);
    store.setScanner('process', {
      name: '프로세스', root: this.platform === 'win32' ? 'windows (PowerShell)' : this.platform, enabled: this.supported, lastScan: 0, procs: 0, agents: 0, mcp: 0,
      error: this.supported ? null : `${this.platform}에서는 프로세스 스캔을 지원하지 않음`,
    });
  }

  start() {
    if (!this.supported) return;
    this.scan();
    this.timer = setInterval(() => this.scan(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  ps() {
    return new Promise((resolve, reject) => {
      execFile('ps', ['axww', '-o', 'pid=,ppid=,pcpu=,etime=,args='], { maxBuffer: 32 * 1024 * 1024, timeout: 5000 }, (err, out) => (err ? reject(err) : resolve(out)));
    });
  }

  /** Current process table, parsed, on any supported platform. */
  async listProcs() {
    if (this.platform !== 'win32') return parsePs(await this.ps());
    const out = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_SCRIPT],
        { maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true }, (err, so) => (err ? reject(err) : resolve(so)));
    });
    return parseWinProcs(out);
  }

  async cwdOf(pid) {
    if (this.cwdCache.has(pid)) return this.cwdCache.get(pid);
    let cwd = '';
    if (this.platform === 'linux') {
      try {
        cwd = await fsp.readlink(`/proc/${pid}/cwd`);
      } catch {}
    } else if (this.platform === 'darwin') {
      cwd = await new Promise((res) => {
        execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 }, (_e, out) => {
          const m = /^n(.+)$/m.exec(out || '');
          res(m ? m[1] : '');
        });
      });
    }
    this.cwdCache.set(pid, cwd);
    return cwd;
  }

  /**
   * Claude Code writes ~/.claude/sessions/<pid>.json ({ pid, sessionId, cwd }) for every
   * live process, which pairs processes with transcripts exactly — no cwd guessing
   * (Windows has no cheap way to read another process's cwd).
   */
  async claudeSessionPids() {
    const out = new Map();
    if (!this.claudeSessionsDir) return out;
    let names = [];
    try {
      names = await fsp.readdir(this.claudeSessionsDir);
    } catch {
      return out;
    }
    for (const n of names) {
      if (!/^\d+\.json$/.test(n)) continue; // skip the *.key peer-token files
      try {
        const j = JSON.parse(await fsp.readFile(path.join(this.claudeSessionsDir, n), 'utf8'));
        if (j.sessionId && Number(j.pid) > 0) out.set(String(j.sessionId), Number(j.pid));
      } catch {}
    }
    return out;
  }

  /** Windows gives cumulative CPU time only: turn it into % of one core since the last scan (like `ps`). */
  fillCpu(procs, now) {
    const next = new Map();
    for (const p of procs) {
      if (p.cpuMs == null) continue;
      const prev = this.cpuPrev.get(p.pid);
      if (prev && now > prev.at && p.cpuMs >= prev.ms) p.cpu = ((p.cpuMs - prev.ms) / (now - prev.at)) * 100;
      next.set(p.pid, { ms: p.cpuMs, at: now });
    }
    this.cpuPrev = next;
  }

  /** Models Ollama has loaded right now (GET /api/ps), or null when it can't be asked. */
  async ollamaModels() {
    try {
      const r = await fetch(`${this.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return null;
      const j = await r.json();
      return (j.models || []).map((m) => ({ name: m.name || m.model, expiresAt: Date.parse(m.expires_at) || 0, vram: m.size_vram || 0, size: m.size || 0 }));
    } catch {
      return null;
    }
  }

  /** pids of processes connected to the Ollama port (who is asking it for work). */
  async ollamaClients() {
    let port = 11434;
    try {
      port = +new URL(this.ollamaUrl).port || 11434;
    } catch {}
    const run = (cmd, args) => new Promise((res) => {
      execFile(cmd, args, { timeout: 4000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => res(out || ''));
    });
    if (this.platform === 'win32') return parseNetstatClients(await run('netstat', ['-ano', '-p', 'TCP']), port);
    return parseLsofClients(await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn']), port);
  }

  /** Ollama server: busy while its model runner burns CPU, plus which model and which clients. */
  async ollamaPatch(p, procs, kids, byPid, now) {
    const tree = [];
    const walk = (pid) => {
      for (const c of kids.get(pid) || []) {
        tree.push(c);
        walk(c.pid);
      }
    };
    walk(p.pid);
    const runners = tree.filter((c) => OLLAMA_RUNNER_RE.test(c.args));
    const cpu = p.cpu + tree.reduce((n, c) => n + (c.cpu || 0), 0);
    const [models, clientPids] = await Promise.all([this.ollamaModels(), this.ollamaClients()]);
    const ours = new Set([p.pid, ...tree.map((c) => c.pid)]);
    const clientName = (c) => {
      // `pythonw -X utf8 -u poll_feed.py` → poll_feed (the script, not the interpreter or a flag value)
      const script = c.tokens.slice(1).find((x) => /\.(py|m?js|cjs|ts)$/i.test(x));
      return script ? base(script).replace(/\.\w+$/, '') : exeAndRest(c).exe;
    };
    // not Ollama's own processes, and not us (our /api/ps request is open while netstat runs)
    const clients = [...new Set(clientPids.filter((pid) => !ours.has(pid) && pid !== process.pid && byPid.has(pid)).map((pid) => clientName(byPid.get(pid))))].sort();
    const model = models?.length ? models.map((m) => m.name).join(', ') : '';
    if (cpu >= OLLAMA_BUSY_CPU && (runners.length || models?.length)) this.ollamaBusyAt = now;
    const busy = now - this.ollamaBusyAt < OLLAMA_HOLD_MS;
    const from = clients.length ? ` ← ${clients.slice(0, 3).join(', ')}` : '';
    if (busy) {
      return {
        state: 'thinking', lastActivity: now, path: `로컬 LLM › ${model || 'ollama'}`,
        detail: `생성 중 · ${model || '모델'}${from}${cpu >= 1 ? ` (CPU ${Math.round(cpu)}%)` : ''}`,
        task: model ? `${model} 추론 처리` : 'Ollama 추론 처리', logKey: `busy|${model}`,
      };
    }
    if (model) {
      const left = Math.max(...models.map((m) => m.expiresAt)) - now;
      return {
        state: 'idle', path: `로컬 LLM › ${model}`,
        detail: `대기 · ${model} 로드됨${left > 0 ? ` (${Math.ceil(left / 60e3)}분 후 언로드)` : ''}${from}`,
        task: `${model} 로드됨`, logKey: `loaded|${model}`,
      };
    }
    return { state: 'idle', path: '', detail: models ? '대기 · 로드된 모델 없음' : '서버 실행 중', task: 'Ollama 서버 실행 중', logKey: 'idle' };
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const procs = await this.listProcs();
      await this.apply(procs);
      this.store.setScanner('process', { lastScan: Date.now(), procs: procs.length, error: null });
    } catch (err) {
      this.store.setScanner('process', { lastScan: Date.now(), error: err.message });
    } finally {
      this.scanning = false;
    }
  }

  /** Exposed for tests: apply a parsed process table. */
  async apply(procs) {
    const s = this.store;
    const now = Date.now();
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    this.fillCpu(procs, now);
    s.hints.procTable = procs; // other scanners read it instead of listing processes again
    s.hints.procTableAt = now;
    for (const pid of this.cwdCache.keys()) if (!byPid.has(pid)) this.cwdCache.delete(pid);
    const ancestors = (p) => {
      const out = [];
      let cur = byPid.get(p.ppid);
      while (cur && out.length < 25 && cur.pid > 1) {
        out.push(cur);
        cur = byPid.get(cur.ppid);
      }
      return out;
    };

    const agents = [];
    const apps = [];
    const mcps = [];
    for (const p of procs) {
      if (p.pid === process.pid) continue;
      const exe0 = base(p.tokens[0] || '').toLowerCase();
      const custom = !NOT_MCP.has(exe0) && this.custom.find((c) => c.re.test(p.args));
      if (custom) {
        agents.push({ p, def: custom });
        continue;
      }
      const app = APP_DEFS.find((a) => a.re.test(p.args));
      if (app) {
        apps.push({ p, app });
        continue;
      }
      const mcp = identifyMcp(p);
      if (mcp) {
        mcps.push({ p, name: mcp });
        continue;
      }
      const def = identifyAgent(p);
      if (def) agents.push({ p, def });
    }
    const agentByPid = new Map(agents.map((a) => [a.p.pid, a]));
    const roots = agents.filter((a) => !ancestors(a.p).some((x) => agentByPid.get(x.pid)?.def.key === a.def.key));

    // servers launched straight from an agent/app via npx/uvx/docker even without "mcp" in the name
    const launcherPids = new Set([...roots.map((r) => r.p.pid), ...apps.map((a) => a.p.pid)]);
    const mcpPidSet = new Set(mcps.map((m) => m.p.pid));
    for (const p of procs) {
      if (mcpPidSet.has(p.pid) || agentByPid.has(p.pid) || !launcherPids.has(p.ppid) || p.age < 5) continue;
      const name = identifyLaunchedServer(p);
      if (name) {
        mcps.push({ p, name });
        mcpPidSet.add(p.pid);
      }
    }
    // a server's own children (sh -c …, node …) are the same server
    for (let i = mcps.length - 1; i >= 0; i--) {
      const parent = ancestors(mcps[i].p).find((x) => mcpPidSet.has(x.pid));
      if (parent) {
        mcpPidSet.delete(mcps[i].p.pid);
        mcps.splice(i, 1);
      }
    }
    for (const r of roots) {
      r.cwd = await this.cwdOf(r.p.pid);
      const anc = ancestors(r.p);
      const app = anc.map((x) => APP_DEFS.find((d) => d.re.test(x.args))).find(Boolean);
      const orca = anc.some((x) => ORCA_HOST_RE.test(x.args) || APP_DEFS.find((d) => d.key === 'orca-app').re.test(x.args));
      if (r.def.custom) r.via = { channel: r.def.channel, door: r.def.door };
      else if (orca) r.via = { channel: 'Orca', door: 'app', orchestrator: 'Orca' };
      else if (app && app.door === 'ide') r.via = { channel: app.channel, door: 'ide' };
      else if (anc.some((x) => IDE_RE.test(x.args))) r.via = { channel: 'VS Code', door: 'ide' };
      else r.via = { channel: 'CLI', door: 'cli' };
      if (r.def.key === 'gemini' && r.cwd) {
        s.hints.geminiProjects[sha256(r.cwd)] = r.cwd;
        s.hints.geminiProjects[base(r.cwd)] = r.cwd;
      }
    }

    const pidToAgent = new Map();
    const liveIds = new Set();

    // 1) link transcript sessions ↔ processes
    const rootByPid = new Map(roots.map((r) => [r.p.pid, r]));
    const viaPatch = (r) => (r?.via.orchestrator ? { channel: r.via.channel, door: r.via.door, orchestrator: r.via.orchestrator } : {});
    // 0) exact Claude Code pairs from ~/.claude/sessions (only for pids that really are Claude Code processes)
    const exactPid = new Map(); // agent id → pid
    for (const [sid, pid] of await this.claudeSessionPids()) {
      const id = `claude:${sid}`;
      if (rootByPid.get(pid)?.def.key === 'claude' && s.agents.has(id)) exactPid.set(id, pid);
    }
    const exactPids = new Set(exactPid.values());
    for (const [id, pid] of exactPid) {
      const a = s.agents.get(id);
      if (a.pid !== pid || !a.alive) s.upsert(id, { alive: true, pid, ...viaPatch(rootByPid.get(pid)) });
    }
    for (const a of [...s.agents.values()]) {
      // an earlier guess gave this session a pid that is known to belong to another session
      if (a.via === 'transcript' && a.pid && exactPids.has(a.pid) && exactPid.get(a.id) !== a.pid) {
        s.upsert(a.id, { alive: false, pid: null });
        continue;
      }
      if (a.via === 'transcript' && a.pid) {
        if (byPid.has(a.pid)) {
          pidToAgent.set(a.pid, a.id);
          const r = rootByPid.get(a.pid);
          if (r?.via.orchestrator && a.orchestrator !== r.via.orchestrator) s.upsert(a.id, viaPatch(r));
        } else s.upsert(a.id, { alive: false, pid: null });
      }
    }
    const unmatched = [];
    for (const r of roots.filter((x) => x.def.transcript)) {
      if (pidToAgent.has(r.p.pid)) continue;
      const cands = [...s.agents.values()]
        .filter((a) => a.via === 'transcript' && !a.parentId && !a.pid && a.client === r.def.client)
        .sort((x, y) => y.lastActivity - x.lastActivity);
      const started = now - r.p.age * 1000 - 5000;
      // the process keeps its launch folder while the session may cd into sub/sibling folders
      const related = (a) => r.cwd && a.cwd && (a.cwd.startsWith(`${r.cwd}/`) || r.cwd.startsWith(`${a.cwd}/`));
      const match = cands.find((a) => r.cwd && a.cwd === r.cwd) || cands.find(related) || cands.find((a) => a.lastActivity >= started);
      if (match) {
        s.upsert(match.id, { alive: true, pid: r.p.pid, ...viaPatch(r) });
        pidToAgent.set(r.p.pid, match.id);
      } else unmatched.push(r);
    }

    // 2) process-only agents (no transcript adapter, or session with no log yet)
    const kids = new Map();
    for (const p of procs) {
      if (!kids.has(p.ppid)) kids.set(p.ppid, []);
      kids.get(p.ppid).push(p);
    }
    const mcpPids = new Set(mcps.map((m) => m.p.pid));
    for (const r of [...unmatched, ...roots.filter((x) => !x.def.transcript)]) {
      const id = `proc:${r.p.pid}`;
      liveIds.add(id);
      pidToAgent.set(r.p.pid, id);
      const children = (kids.get(r.p.pid) || []).filter((c) => !mcpPids.has(c.pid) && !agentByPid.has(c.pid) && !/^(node|bun)$/.test(base(c.tokens[0])) && !/caffeinate|rg --files/.test(c.args));
      let patch;
      if (r.def.transcript) patch = { state: 'done', detail: '세션 열림 · 아직 대화 기록 없음', path: '' };
      else if (children.length) {
        const c = children[0];
        const shown = SHELLS.has(base(c.tokens[0])) && c.tokens.length > 2 ? c.tokens.slice(2).join(' ') : c.args;
        patch = { state: 'running', detail: `$ ${oneLine(shown, 70)}`, path: `CLI › ${base(c.tokens[SHELLS.has(base(c.tokens[0])) ? 2 : 0] || c.tokens[0])}`, lastActivity: now };
      } else if (r.p.cpu > 15) patch = { state: 'thinking', detail: `처리 중 (CPU ${Math.round(r.p.cpu)}%)`, path: '', lastActivity: now };
      else patch = { state: 'done', detail: '대기 중', path: '' };
      const isNew = !s.get(id);
      s.upsert(id, {
        name: r.def.name || base(r.cwd) || r.def.client, client: r.def.client, vendor: r.def.vendor, via: 'process',
        channel: r.via.channel, door: r.via.door, orchestrator: r.via.orchestrator, cwd: r.cwd, project: base(r.cwd), pid: r.p.pid, alive: true,
        sessionShort: String(r.p.pid), task: isNew ? `${r.def.client} 실행 중` : undefined,
        startedAt: isNew ? now - r.p.age * 1000 : undefined, lastActivity: isNew ? now : patch.lastActivity, ...patch,
      });
      const key = `${patch.state}|${patch.detail}`;
      if (this.lastDetail.get(id) !== key) {
        this.lastDetail.set(id, key);
        s.activity(id, { t: now, text: patch.detail, path: patch.path || '프로세스 › 감지', state: patch.state });
      }
    }

    // 3) LLM desktop apps
    const seenApps = new Set();
    for (const { p, app } of apps) {
      if (seenApps.has(app.key)) continue;
      seenApps.add(app.key);
      const id = `app:${app.key}`;
      liveIds.add(id);
      pidToAgent.set(p.pid, id);
      const isNew = !s.get(id);
      s.upsert(id, {
        name: app.client, client: app.client, vendor: app.vendor, via: 'process', channel: app.channel, door: app.door,
        pid: p.pid, alive: true, sessionShort: String(p.pid),
        ...(isNew ? { state: 'idle', detail: '앱 실행 중', task: `${app.client} 실행 중`, startedAt: now - p.age * 1000, lastActivity: now - 20 * 60e3 } : {}),
      });
      if (isNew) s.activity(id, { t: now, text: '앱 실행 감지', path: '프로세스 › 감지', state: 'idle' });
      if (app.key === 'ollama-serve') {
        // a running server says nothing about work: ask Ollama, and watch its model runner's CPU
        const { logKey, ...patch } = await this.ollamaPatch(p, procs, kids, byPid, now);
        s.upsert(id, patch);
        if (this.lastDetail.get(id) !== logKey) {
          this.lastDetail.set(id, logKey);
          if (!isNew) s.activity(id, { t: now, text: patch.detail.replace(/ \(CPU \d+%\)$/, ''), path: patch.path || '프로세스 › 감지', state: patch.state });
        }
      }
    }

    // 4) MCP servers + who launched them
    const groups = new Map();
    for (const { p, name } of mcps) {
      const launcher = ancestors(p).find((x) => pidToAgent.has(x.pid));
      const app = launcher ? null : ancestors(p).map((x) => APP_DEFS.find((d) => d.re.test(x.args))).find(Boolean);
      const g = groups.get(name) || { pids: [], launchers: new Set(), launcherIds: new Set(), command: p.args };
      g.pids.push(p.pid);
      if (launcher) {
        const aid = pidToAgent.get(launcher.pid);
        g.launcherIds.add(aid);
        g.launchers.add(s.get(aid)?.name || aid);
      } else if (app) g.launchers.add(app.client);
      groups.set(name, g);
    }
    for (const [name, g] of groups) {
      s.touchMcp(name, { proc: true, pids: g.pids, launchers: [...g.launchers], command: oneLine(g.command, 160) });
      const m = s.mcp.get(name);
      m.launcherIds = [...g.launcherIds];
    }
    for (const id of liveIds) {
      if (!id.startsWith('app:') || id === 'app:ollama-serve') continue; // Ollama's detail is its own
      const names = [...groups].filter(([, g]) => g.launcherIds.has(id)).map(([n]) => n);
      const a = s.get(id);
      const detail = names.length ? `MCP 연결: ${names.slice(0, 4).join(', ')}` : '앱 실행 중';
      if (a && a.detail !== detail && a.state === 'idle') s.upsert(id, { detail, path: names.length ? `MCP › ${names[0]}` : '' });
    }

    // 5) processes that went away
    for (const id of this.procAgents) {
      if (!liveIds.has(id)) {
        s.remove(id);
        this.lastDetail.delete(id);
        if (id === 'app:ollama-serve') this.ollamaBusyAt = 0;
      }
    }
    this.procAgents = liveIds;
    s.setScanner('process', { agents: roots.length + seenApps.size, mcp: groups.size });
  }
}

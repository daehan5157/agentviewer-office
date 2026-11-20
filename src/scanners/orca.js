// Orca (stablyai/orca) — the desktop "agent development environment" that
// runs Claude Code, Codex and 30+ other CLI agents in parallel git worktrees.
//
// Three layers, from most to least precise:
//  1. `orca worktree ps --json` (official CLI, only while Orca is running):
//     every agent pane with its state (working / blocked / waiting / done),
//     current tool, prompt and worktree. Agents Agentviewer has no other
//     adapter for (Grok, Cursor, Amp, OpenCode, …) appear from this alone.
//  2. Worktree paths: sessions whose folder is under ~/orca/workspaces are
//     tagged as coming in through Orca even when the CLI is unavailable.
//  3. Process tree (in ProcessScanner): agents whose ancestor is the
//     "Orca Agents" terminal daemon.
// Orca-managed Claude/Codex accounts keep transcripts inside Orca's data
// folder; orcaTranscriptRoots() hands those folders to the other scanners.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { classifyTool } from '../classify.js';
import { oneLine, base, readdirSafe } from '../util.js';

const AGENT_TYPES = {
  claude: ['Claude Code', 'anthropic', 'claude'],
  openclaude: ['OpenClaude', 'anthropic', 'claude'],
  codex: ['Codex', 'openai', 'codex'],
  gemini: ['Gemini CLI', 'google', 'gemini'],
  antigravity: ['Antigravity', 'google', 'gemini'],
  opencode: ['OpenCode', 'other', 'other'],
  cursor: ['Cursor Agent', 'other', 'other'],
  copilot: ['Copilot CLI', 'other', 'other'],
  amp: ['Amp', 'other', 'other'],
  grok: ['Grok CLI', 'other', 'other'],
  'qwen-code': ['Qwen Code', 'other', 'other'],
  droid: ['Droid', 'other', 'other'],
  kiro: ['Kiro CLI', 'other', 'other'],
  pi: ['Pi', 'other', 'other'],
};

export function agentTypeInfo(type) {
  const t = String(type || '').toLowerCase();
  const [client, vendor, vkey] = AGENT_TYPES[t] || [type ? String(type) : 'Orca 에이전트', 'other', 'other'];
  return { client, vendor, vkey };
}

export function orcaUserDataCandidates() {
  const h = os.homedir();
  if (process.platform === 'darwin') return [path.join(h, 'Library', 'Application Support', 'Orca')];
  if (process.platform === 'win32') return [path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'Orca')];
  const cfg = process.env.XDG_CONFIG_HOME || path.join(h, '.config');
  return [path.join(cfg, 'Orca'), path.join(cfg, 'orca')];
}

export function orcaBinCandidates() {
  const h = os.homedir();
  if (process.platform === 'darwin') {
    return ['/Applications/Orca.app/Contents/Resources/bin/orca', path.join(h, 'Applications/Orca.app/Contents/Resources/bin/orca'), 'orca'];
  }
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    const dir = path.join(la, 'Programs', 'orca', 'resources', 'bin');
    return [path.join(dir, 'orca.cmd'), path.join(dir, 'orca.exe'), 'orca.cmd', 'orca'];
  }
  return ['orca-ide']; // on Linux `orca` is usually the GNOME screen reader
}

/** Transcript folders of Orca-managed Claude / Codex accounts. */
export async function orcaTranscriptRoots(userData) {
  const out = { claude: [], codex: [] };
  if (!userData) return out;
  for (const e of await readdirSafe(path.join(userData, 'claude-profiles'))) {
    if (e.isDirectory()) out.claude.push(path.join(userData, 'claude-profiles', e.name, 'home', 'projects'));
  }
  out.codex.push(path.join(userData, 'codex-runtime-home', 'home', 'sessions'));
  return out;
}

// A cold Orca CLI start while other scanners are busy can take well over 8s on Windows
function runCli(bin, args, timeout = 20000) {
  // Windows .cmd shims must go through the shell; our arguments are fixed literals
  const viaShell = /\.(cmd|bat)$/i.test(bin);
  const file = viaShell && /\s/.test(bin) ? `"${bin}"` : bin;
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' }, windowsHide: true, shell: viaShell }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

export function parseCliJson(stdout) {
  const s = String(stdout);
  const i = s.indexOf('{');
  if (i < 0) throw new Error('Orca CLI 출력에 JSON이 없음');
  const env = JSON.parse(s.slice(i));
  if (env.ok === false) throw new Error(env.error?.message || 'Orca CLI 오류');
  return env.result ?? env;
}

/** The live terminal behind an Orca agent pane (`worktree ps` paneKey = `<tabId>:<leafId>`). */
export function terminalForPane(listResult, paneKey) {
  return (listResult?.terminals || []).find((t) => `${t.tabId}:${t.leafId}` === paneKey && t.connected !== false && !t.orphaned) || null;
}

export const PROMPT_MAX = 4000;

/** Rendered screen rows without the braille-dot spinner noise agent TUIs draw. */
export function cleanScreen(rows) {
  const out = [];
  for (const raw of rows) {
    const line = String(raw).replace(/[⠀-⣿]/g, ' ').replace(/\s+$/, '');
    if (!line.trim() && !out.length) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.slice(-200);
}

/**
 * Numbered choices an agent shows for an approval, e.g. Codex:
 *   › 1. Yes, proceed (y)   2. Yes, and don't ask again (p)   3. No, and tell Codex what to do (esc)
 * Only keys spelled out on screen are offered, so a button presses exactly what the screen asks for.
 */
export function screenChoices(lines) {
  let out = [];
  let open = null; // an item whose text wrapped onto the next line(s) before its "(key)"
  const close = (text) => {
    const m = text.match(/^(.+?)\s+\((esc|enter|[a-z0-9])\)\s*$/i);
    if (!m) return false;
    out.push({ n: open.n, label: m[1].replace(/\s+/g, ' ').trim(), key: m[2].toLowerCase() });
    open = null;
    return true;
  };
  for (const l of lines.slice(-25)) {
    const start = l.match(/^\s*[›>❯]?\s*(\d)\.\s+(.+)$/);
    if (start) {
      if (+start[1] === 1) out = []; // a newer menu: only the last one counts
      open = { n: +start[1], text: start[2], extra: 0 };
      close(open.text);
    } else if (open && /^\s+\S/.test(l) && open.extra < 3) {
      open.extra++;
      open.text += ` ${l.trim()}`;
      close(open.text);
    } else open = null;
  }
  // a real menu is numbered 1, 2, …
  return out.length >= 2 && out[0].n === 1 && out.every((c, i) => c.n === i + 1) ? out : [];
}

export class OrcaScanner {
  constructor(store, opts = {}) {
    this.store = store;
    this.bin = opts.orcaBin || null;
    const cands = opts.userData ? [opts.userData] : orcaUserDataCandidates();
    this.userData = cands.find((p) => fs.existsSync(p)) || cands[0];
    this.workspaceDir = opts.workspaceDir || path.join(os.homedir(), 'orca', 'workspaces');
    this.intervalMs = opts.intervalMs ?? 4000;
    this.claimed = new Map(); // Orca paneKey → transcript agent it was merged into
    this.own = new Set(); // orca:* agents created by the last apply
    this.lastKey = new Map();
    this.nextTry = 0;
    this.worktreePaths = [];
    // the orchestrator: the pane other agents name as their parent. Remembered (and saved),
    // because its workers' panes close when they finish — it stays the orchestrator.
    this.leadsFile = opts.leadsFile || null; // the app passes ~/.agentviewer/orca-leads.json
    this.leads = new Set();
    try {
      if (this.leadsFile) for (const k of JSON.parse(fs.readFileSync(this.leadsFile, 'utf8'))) this.leads.add(String(k));
    } catch {}
    store.setScanner('orca', {
      name: 'Orca', root: this.workspaceDir, enabled: true, lastScan: 0, worktrees: 0, agents: 0,
      error: fs.existsSync(this.userData) ? null : 'Orca 미설치 (데이터 폴더 없음)',
    });
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Is the Orca desktop runtime up? (avoids spawning the CLI for nothing) */
  async runtimeAlive() {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(this.userData, 'orca-runtime.json'), 'utf8'));
      if (!meta.pid) return false;
      process.kill(meta.pid, 0);
      return true;
    } catch (err) {
      return err?.code === 'EPERM';
    }
  }

  async ps() {
    const cands = this.bin ? [this.bin] : orcaBinCandidates();
    for (const bin of cands) {
      if (path.isAbsolute(bin) && !fs.existsSync(bin)) continue;
      try {
        const out = await runCli(bin, ['worktree', 'ps', '--json', '--limit', '200']);
        this.bin = bin;
        return parseCliJson(out);
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        if (err.killed || err.signal) throw new Error(`orca worktree ps 시간 초과 (응답 없음, ${err.signal || 'killed'})`);
        const msg = oneLine(err.stderr || err.stdout || err.message, 160);
        throw new Error(`orca worktree ps 실패: ${msg}`);
      }
    }
    throw new Error('Orca CLI를 찾을 수 없음 (Orca 설정 > CLI 설치 또는 --orca-bin 지정)');
  }

  /**
   * A launcher that takes free text safely. On Windows that is orca.exe: the orca.cmd shim goes
   * through cmd.exe, which reparses its arguments (quotes, &, |, newlines) — never pass a prompt there.
   */
  nativeBin() {
    const cands = [this.bin, ...orcaBinCandidates()].filter(Boolean);
    for (const bin of cands) {
      const exe = /\.(cmd|bat)$/i.test(bin) ? bin.replace(/\.(cmd|bat)$/i, '.exe') : bin;
      if (process.platform === 'win32' && !/\.exe$/i.test(exe)) continue;
      if (path.isAbsolute(exe) && !fs.existsSync(exe)) continue;
      return exe;
    }
    return null;
  }

  /** Type a prompt into an Orca agent's terminal and press Enter (like the user would in Orca). */
  async sendPrompt(paneKey, text) {
    const { bin, term } = await this.terminalFor(paneKey);
    if (term.writable === false) throw new Error('이 터미널은 입력을 받지 않음');
    let out;
    try {
      out = await runCli(bin, ['terminal', 'send', '--terminal', term.handle, '--text', text, '--enter', '--wait-submit', '15', '--json'], 45000);
    } catch (err) {
      throw new Error(`orca terminal send 실패: ${oneLine(err.stderr || err.stdout || err.message, 160)}`);
    }
    const res = parseCliJson(out);
    if (res?.send?.accepted === false) throw new Error('Orca가 입력을 받지 않았어요');
    // e.g. ['input_accepted', 'submitted', 'turn_started'] — only recognised agents report past acceptance
    const stages = res?.send?.prompt?.stages || [];
    return { handle: term.handle, title: term.title || '', stages, started: stages.some((s) => /turn|start/i.test(s)) };
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.tagWorkspaceAgents();
      if (Date.now() < this.nextTry) return;
      if (!(await this.runtimeAlive())) {
        this.clearOwn();
        this.store.setScanner('orca', {
          lastScan: Date.now(), worktrees: 0, agents: 0,
          error: fs.existsSync(this.userData) ? 'Orca 앱이 실행 중이 아님' : 'Orca 미설치 (데이터 폴더 없음)',
        });
        this.nextTry = Date.now() + 8000;
        return;
      }
      const result = await this.ps();
      const counts = this.apply(result);
      this.store.setScanner('orca', { lastScan: Date.now(), error: null, ...counts });
    } catch (err) {
      this.nextTry = Date.now() + 15000;
      this.store.setScanner('orca', { lastScan: Date.now(), error: err.message });
    } finally {
      this.busy = false;
    }
  }

  clearOwn() {
    for (const id of this.own) this.store.remove(id);
    this.own = new Set();
    this.claimed.clear();
  }

  /** Sessions running inside Orca worktrees came in through Orca. */
  tagWorkspaceAgents() {
    const roots = [this.workspaceDir, ...this.worktreePaths];
    for (const a of this.store.agents.values()) {
      if (a.via !== 'transcript' || a.orchestrator === 'Orca' || !a.cwd) continue;
      const root = roots.find((r) => a.cwd === r || a.cwd.startsWith(`${r}${path.sep}`));
      if (!root) continue;
      const rel = path.relative(this.workspaceDir, a.cwd).split(path.sep).filter(Boolean);
      const worktree = root === this.workspaceDir ? rel[1] || rel[0] : base(root);
      this.store.upsert(a.id, { channel: 'Orca', door: 'app', orchestrator: 'Orca', orca: { ...(a.orca || {}), worktree } });
    }
  }

  rowPatch(w, r) {
    const { client, vendor, vkey } = agentTypeInfo(r.agentType);
    const cls = r.toolName ? classifyTool(r.toolName, r.toolInput ?? {}, vkey) : null;
    let state;
    let detail;
    let p = cls?.path || '';
    switch (r.state) {
      case 'working':
        state = cls ? cls.state : 'thinking';
        detail = cls ? cls.detail : r.lastAssistantMessage ? `답변 작성: ${oneLine(r.lastAssistantMessage, 70)}` : '작업 중';
        break;
      case 'blocked':
        state = 'waiting';
        detail = cls ? `승인 대기: ${cls.detail}` : '확인 필요 (막힘)';
        break;
      case 'waiting':
        state = 'waiting';
        detail = cls ? `승인 대기: ${cls.detail}` : '응답 대기';
        break;
      default:
        state = 'done';
        detail = r.interrupted ? '중단됨 · 다음 요청 대기' : '완료 · 다음 요청 대기';
        p = '';
    }
    const lead = this.leads.has(r.paneKey);
    const own = r.displayName || r.conversationName || w.displayName || base(w.path);
    return {
      // the orchestrator is named after what it runs ("프로젝트 오케스트레이팅"); its chat title stays as the session title
      name: lead ? `${w.displayName || base(w.path)} 오케스트레이팅` : own,
      ...(lead ? { title: oneLine(r.conversationName || r.displayName || '', 120) } : {}),
      client, vendor,
      via: 'orca', channel: 'Orca', door: 'app', orchestrator: 'Orca',
      project: w.repo || base(w.path), cwd: w.path, branch: w.branch,
      task: oneLine(r.taskTitle || r.prompt || '', 300),
      state, detail, path: p,
      lastActivity: r.updatedAt || Date.now(), stateSince: r.stateStartedAt || r.updatedAt,
      alive: r.hasLivePty ? true : null,
      sessionShort: oneLine(w.displayName || base(w.path), 14),
      ttlMs: 30 * 60e3,
      orca: {
        worktree: w.displayName || base(w.path), worktreeStatus: w.status, paneKey: r.paneKey, pr: w.linkedPR?.number ?? null, lead,
        // the orchestrator's last answer in full, and what it is waiting on (shown on its card)
        ...(lead ? {
          reply: String(r.lastAssistantMessage || '').slice(0, 8000),
          asking: r.state === 'blocked' || r.state === 'waiting' ? detail : '',
        } : {}),
      },
    };
  }

  /** The live terminal behind an agent pane. */
  async terminalFor(paneKey) {
    const bin = this.nativeBin();
    if (!bin) throw new Error('Orca CLI(orca.exe)를 찾을 수 없음');
    if (!(await this.runtimeAlive())) throw new Error('Orca 앱이 실행 중이 아님');
    const term = terminalForPane(parseCliJson(await runCli(bin, ['terminal', 'list', '--json'])), paneKey);
    if (!term) throw new Error('이 에이전트의 Orca 터미널을 찾을 수 없음 (닫혔거나 다시 시작됨)');
    return { bin, term };
  }

  /** What the agent's terminal shows right now (rendered screen), plus any numbered choices on it. */
  async readScreen(paneKey) {
    const { bin, term } = await this.terminalFor(paneKey);
    const res = parseCliJson(await runCli(bin, ['terminal', 'read', '--terminal', term.handle, '--screen', '--json']));
    const lines = cleanScreen(res?.terminal?.tail || []);
    return { lines, choices: screenChoices(lines) };
  }

  /** Press one key in the agent's terminal (to answer an on-screen choice). */
  async sendKey(paneKey, key) {
    const { bin, term } = await this.terminalFor(paneKey);
    if (term.writable === false) throw new Error('이 터미널은 입력을 받지 않음');
    const text = key === 'esc' ? '\x1b' : key === 'enter' ? '\r' : key;
    try {
      await runCli(bin, ['terminal', 'send', '--terminal', term.handle, '--text', text, '--json'], 20000);
    } catch (err) {
      throw new Error(`orca terminal send 실패: ${oneLine(err.stderr || err.stdout || err.message, 160)}`);
    }
    return { handle: term.handle };
  }

  /** Learn orchestrators from parent links; keep them until their pane is gone from Orca. */
  updateLeads(worktrees) {
    const panes = new Set();
    const before = [...this.leads].join('|');
    for (const w of worktrees) {
      for (const r of w.agents || []) {
        if (r?.paneKey) panes.add(r.paneKey);
        if (r?.parentPaneKey) this.leads.add(r.parentPaneKey);
      }
    }
    // its terminal was closed (an empty answer, e.g. Orca restarting, proves nothing)
    if (panes.size) for (const k of this.leads) if (!panes.has(k)) this.leads.delete(k);
    if (this.leadsFile && [...this.leads].join('|') !== before) {
      fsp.mkdir(path.dirname(this.leadsFile), { recursive: true })
        .then(() => fsp.writeFile(this.leadsFile, JSON.stringify([...this.leads])))
        .catch(() => {});
    }
  }

  /** Exposed for tests: apply a `worktree ps` result. */
  apply(result) {
    const s = this.store;
    const worktrees = (result?.worktrees || []).filter((w) => !w.isArchived);
    this.worktreePaths = worktrees.map((w) => w.path).filter(Boolean);
    this.updateLeads(worktrees);
    const seen = new Set();
    const seenPanes = new Set();
    const transcript = [...s.agents.values()].filter((a) => a.via === 'transcript' && !a.parentId);
    const taken = new Set(this.claimed.values());
    let agents = 0;
    const idFor = (paneKey) => this.claimed.get(paneKey) || `orca:${paneKey}`;
    for (const w of worktrees) {
      for (const r of w.agents || []) {
        if (!r?.paneKey) continue;
        agents++;
        seenPanes.add(r.paneKey);
        const patch = this.rowPatch(w, r);
        // Same session also visible through its transcript? enrich that one instead of drawing a twin.
        let tid = this.claimed.get(r.paneKey);
        if (tid && !s.get(tid)) tid = null;
        if (!tid) {
          const inside = (a) => a.cwd && w.path && (a.cwd === w.path || a.cwd.startsWith(`${w.path}${path.sep}`));
          const cand = transcript.filter((a) => !taken.has(a.id) && a.client === patch.client && inside(a)).sort((a, b) => b.lastActivity - a.lastActivity)[0];
          if (cand) {
            tid = cand.id;
            taken.add(tid);
            this.claimed.set(r.paneKey, tid);
          }
        }
        if (tid) {
          const extra = { channel: 'Orca', door: 'app', orchestrator: 'Orca', orca: patch.orca };
          if (patch.orca.lead) Object.assign(extra, { name: patch.name, title: patch.title || undefined });
          if (patch.state === 'waiting') Object.assign(extra, { state: 'waiting', detail: patch.detail, path: patch.path });
          if (r.parentPaneKey) extra.leadId = idFor(r.parentPaneKey);
          s.upsert(tid, extra);
          if (s.get(`orca:${r.paneKey}`)) s.remove(`orca:${r.paneKey}`);
          continue;
        }
        const id = `orca:${r.paneKey}`;
        seen.add(id);
        const isNew = !s.get(id);
        s.upsert(id, { ...patch, leadId: r.parentPaneKey ? idFor(r.parentPaneKey) : null });
        if (isNew && patch.task) s.activity(id, { t: patch.lastActivity, text: `요청: ${oneLine(patch.task, 120)}`, path: `Orca › ${patch.orca.worktree}`, state: 'thinking' });
        const key = `${patch.state}|${patch.detail}`;
        if (this.lastKey.get(id) !== key) {
          this.lastKey.set(id, key);
          s.activity(id, { t: patch.lastActivity, text: patch.detail, path: patch.path || `Orca › ${patch.orca.worktree}`, state: patch.state });
          if (patch.path.startsWith('MCP › ')) s.pulse(id, patch.path.split(' › ')[1], patch.path.split(' › ')[2], patch.lastActivity);
        }
      }
    }
    for (const id of this.own) {
      if (!seen.has(id)) {
        s.remove(id);
        this.lastKey.delete(id);
      }
    }
    for (const pk of [...this.claimed.keys()]) if (!seenPanes.has(pk)) this.claimed.delete(pk);
    this.own = seen;
    this.tagWorkspaceAgents();
    const app = s.get('app:orca-app');
    if (app && app.state === 'idle') s.upsert('app:orca-app', { detail: `워크트리 ${worktrees.length}개 · 에이전트 ${agents}개 관리 중` });
    return { worktrees: worktrees.length, agents };
  }
}

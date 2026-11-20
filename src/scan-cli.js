// `agentviewer scan` — check, from a terminal, what Agentviewer sees on this
// machine without opening the browser.
//   agentviewer scan                 one-shot report
//   agentviewer scan --watch         live report, refreshed every 2s
//   agentviewer scan --grep orca     show matching processes + a config snippet
//   agentviewer scan --json          raw snapshot
import os from 'node:os';
import { Store } from './store.js';
import { createScanners } from './scanners/index.js';
import { loadConfig } from './config.js';
import { oneLine, base } from './util.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const C = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = C('2');
const bold = C('1');
const green = C('32');
const red = C('31');
const yellow = C('33');
const cyan = C('36');
const magenta = C('35');

const STATE = {
  thinking: ['생각 중', magenta], typing: ['코드 작성', cyan], reading: ['읽는 중', cyan], running: ['명령 실행', green],
  web: ['웹 검색', cyan], mcp: ['MCP 호출', magenta], delegating: ['위임 중', yellow], planning: ['계획 중', yellow],
  waiting: ['응답 대기', red], done: ['완료·대기', green], idle: ['휴식', dim],
};
const DOOR = { cli: 'CLI', ide: 'IDE', app: '앱', api: 'SDK·API', mcp: 'MCP', cloud: '클라우드' };
const VIA = { transcript: '세션 기록', process: '프로세스', mcp: 'MCP 브리지', api: 'HTTP API', orca: 'Orca CLI', demo: '데모' };
const home = os.homedir();
const width = (s) => [...String(s)].reduce((n, ch) => n + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0);
const pad = (s, n) => `${s}${' '.repeat(Math.max(0, n - width(s)))}`;
const tilde = (p) => (p && p.startsWith(home) ? `~${p.slice(home.length)}` : p || '');

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

function report(store, cfg) {
  const snap = store.snapshot();
  const now = Date.now();
  const out = [];
  out.push(bold(`Agentviewer 스캔 · ${new Date().toLocaleString()}`));
  out.push('');
  out.push(bold('스캐너'));
  for (const s of Object.values(snap.scanners)) {
    const ok = !s.error && s.enabled !== false;
    const stats = [
      s.files !== undefined && `파일 ${s.files}`, s.active !== undefined && `최근 활성 ${s.active}`,
      s.procs !== undefined && `프로세스 ${s.procs}`, s.worktrees !== undefined && `워크트리 ${s.worktrees}`, s.agents !== undefined && `에이전트 ${s.agents}`, s.mcp !== undefined && `MCP ${s.mcp}`,
      s.custom !== undefined && `사용자 정의 패턴 ${s.custom}`,
    ].filter(Boolean).join(' · ');
    out.push(`  ${ok ? green('●') : dim('○')} ${pad(s.name, 12)} ${dim(tilde(s.root))}  ${stats}${s.error ? `  ${yellow(s.error)}` : ''}`);
  }
  if (cfg && !cfg.loaded) out.push(`  ${dim('○')} ${pad('설정', 12)} ${dim(tilde(cfg.path))}  ${dim('없음 (선택 사항)')}`);

  const agents = snap.agents.slice().sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || b.lastActivity - a.lastActivity);
  out.push('');
  out.push(bold(`에이전트 ${agents.length}`));
  if (!agents.length) out.push(dim('  감지된 에이전트가 없습니다. Claude Code · Codex · Gemini CLI 등을 실행한 뒤 다시 확인하세요.'));
  const roots = agents.filter((a) => !agents.some((p) => p.id === a.parentId || p.id === a.leadId));
  const line = (a, first, indent) => {
    const [label, color] = STATE[a.state] || [a.state, dim];
    const alive = a.alive === true ? green(` 실행 중 PID ${a.pid}`) : a.alive === false ? dim(' 종료됨') : '';
    out.push(`${first}${color('■')} ${a.orchestrator === 'Orca' ? '🐋 ' : ''}${bold(a.name)} ${dim(`#${a.sessionShort || ''}`)}  ${color(label)}  ${dim(ago(now - a.lastActivity))}`);
    const orca = a.orchestrator ? cyan(`  ${a.orchestrator}${a.orca?.worktree ? ` 워크트리 ${a.orca.worktree}` : ''}`) : '';
    out.push(`${indent}  경로  ${DOOR[a.door] || a.door} 출입문 · ${a.client} · ${a.channel} · ${VIA[a.via] || a.via}${alive}${orca}`);
    if (a.task) out.push(`${indent}  작업  ${oneLine(a.task, 90)}`);
    if (a.detail) out.push(`${indent}  지금  ${a.path ? `${cyan(a.path)}  ` : ''}${oneLine(a.detail, 80)}`);
    if (a.cwd) out.push(`${indent}  폴더  ${dim(tilde(a.cwd))}${a.branch ? dim(`  ⎇ ${a.branch}`) : ''}`);
  };
  for (const a of roots) {
    line(a, '  ', '  ');
    for (const c of agents.filter((x) => x.parentId === a.id || x.leadId === a.id)) line(c, '    ↳ ', '      ');
  }

  out.push('');
  out.push(bold(`MCP 서버 ${snap.mcp.length}`));
  if (!snap.mcp.length) out.push(dim('  없음'));
  for (const m of snap.mcp) {
    const who = [m.launchers?.length && `실행: ${m.launchers.join(', ')}`, m.users?.length && `사용: ${m.users.map((u) => snap.agents.find((a) => a.id === u)?.name || u).join(', ')}`, `${m.calls}회 호출`].filter(Boolean).join(' · ');
    out.push(`  ${m.live ? green('●') : dim('○')} ${bold(m.name.padEnd(18))} ${who}`);
  }
  return out.join('\n');
}

async function grepProcesses(pattern, scanner) {
  const re = new RegExp(pattern, 'i');
  const procs = await scanner.listProcs();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const hits = procs.filter((p) => p.pid !== process.pid && re.test(p.args) && !/agentviewer(\.js)? scan/.test(p.args));
  const out = [bold(`"${pattern}" 와 일치하는 프로세스 ${hits.length}개`)];
  if (!hits.length) {
    out.push(dim('  없음 — 해당 프로그램이 실행 중인지 확인하세요.'));
    return out.join('\n');
  }
  for (const p of hits.slice(0, 30)) {
    const chain = [];
    let cur = byPid.get(p.ppid);
    while (cur && chain.length < 6 && cur.pid > 1) {
      chain.push(`${base(cur.tokens[0])}(${cur.pid})`);
      cur = byPid.get(cur.ppid);
    }
    out.push(`  ${bold(String(p.pid).padStart(6))}  ${oneLine(p.args, 140)}`);
    out.push(`          ${dim(`부모: ${chain.join(' ← ') || '-'} · 폴더: ${tilde(await scanner.cwdOf(p.pid)) || '?'} · CPU ${p.cpu}%`)}`);
  }
  const esc = pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  out.push('');
  out.push(dim('이 프로세스들을 오피스에 띄우려면 ~/.agentviewer/config.json 에:'));
  const SH = /^(sh|bash|zsh|fish|dash|node|python3?|bun|deno)$/;
  const named = hits.map((p) => base(p.tokens[0])).find((b) => !SH.test(b)) || pattern;
  out.push(`  { "processes": [ { "name": "${named}", "match": "${esc}", "client": "${named}" } ] }`);
  return out.join('\n');
}

export async function runScan(args) {
  const windowMs = Number(args.window || 60) * 60e3;
  const cfg = await loadConfig(args.config);
  const store = new Store({ removeMs: windowMs });
  store.setScanner('config', { name: '설정', root: cfg.path, enabled: cfg.loaded, custom: cfg.processes.length, error: null });
  const { claude, codex, gemini, proc, orca } = createScanners(store, { ...args, demo: false }, cfg);
  if (!cfg.loaded) delete store.scanners.config;

  const once = async (first) => {
    if (claude) await (first ? claude.discover() : claude.poll());
    if (claude && first) await claude.discover(); // pick up sub-agents of sessions found in pass one
    if (codex) await (first ? codex.discover() : codex.poll());
    if (gemini) await gemini.scan();
    if (proc) await proc.scan();
    if (orca) await orca.tick();
    store.tick();
  };
  await once(true);

  if (args.json) {
    console.log(JSON.stringify(store.snapshot(), null, 2));
    return;
  }
  const grep = typeof args.grep === 'string' ? args.grep : null;
  const render = async () => {
    let text = report(store, cfg);
    if (grep && proc) text += `\n\n${await grepProcesses(grep, proc)}`;
    return text;
  };
  if (!args.watch) {
    console.log(await render());
    return;
  }
  let tick = 0;
  for (;;) {
    const text = await render();
    if (tty) process.stdout.write('\x1b[2J\x1b[H');
    console.log(`${text}\n\n${dim('2초마다 갱신 중 · Ctrl+C로 종료')}`);
    await new Promise((r) => setTimeout(r, 2000));
    if (claude && ++tick % 2 === 0) await claude.discover();
    if (codex && tick % 2 === 0) await codex.discover();
    await once(false);
  }
}

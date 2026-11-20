import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { OrcaScanner, orcaTranscriptRoots, parseCliJson, agentTypeInfo, cleanScreen, screenChoices } from '../src/scanners/orca.js';
import { ProcessScanner } from '../src/scanners/processes.js';

const now = Date.now();
const row = (o) => ({
  paneKey: 'tab1:leaf1', parentPaneKey: null, state: 'working', agentType: 'claude', prompt: '', taskTitle: null, displayName: null,
  lastAssistantMessage: null, toolName: null, toolInput: null, interrupted: false, stateStartedAt: now - 5000, updatedAt: now - 1000, ...o,
});
const wt = (name, agents, o = {}) => ({
  worktreeId: `repo1::/Users/me/orca/workspaces/shop/${name}`, repoId: 'repo1', repo: 'shop', path: `/Users/me/orca/workspaces/shop/${name}`,
  branch: `me/${name}`, displayName: name, isArchived: false, status: 'working', agents, linkedPR: null, ...o,
});

test('worktree ps rows become agents: tools, approvals, lead/worker links, merge with transcripts', async () => {
  const store = new Store();
  // a Codex session Agentviewer already sees through its transcript, running inside an Orca worktree
  store.upsert('codex:abc', { client: 'Codex', via: 'transcript', cwd: '/Users/me/orca/workspaces/shop/seahorse', name: 'seahorse', lastActivity: now, state: 'running' });
  const sc = new OrcaScanner(store, { userData: '/nonexistent', workspaceDir: '/Users/me/orca/workspaces' });
  const result = {
    worktrees: [
      wt('nautilus', [row({ paneKey: 'lead', agentType: 'claude', taskTitle: '결제 v2 나눠서 진행', toolName: 'Bash', toolInput: 'orca orchestration worker-start --agent codex' })]),
      wt('seahorse', [row({ paneKey: 'w1', parentPaneKey: 'lead', agentType: 'codex', state: 'blocked', toolName: 'Bash', toolInput: 'pnpm add stripe' })]),
      wt('octopus', [row({ paneKey: 'w2', parentPaneKey: 'lead', agentType: 'grok', toolName: 'mcp__figma__get_design_context', toolInput: 'Checkout' })]),
      wt('old', [row({ paneKey: 'x' })], { isArchived: true }),
    ],
  };
  const counts = sc.apply(result);
  assert.deepEqual(counts, { worktrees: 3, agents: 3 });

  const lead = store.get('orca:lead');
  assert.equal(lead.client, 'Claude Code');
  assert.equal(lead.channel, 'Orca');
  assert.equal(lead.door, 'app');
  assert.equal(lead.orchestrator, 'Orca');
  assert.equal(lead.name, 'nautilus 오케스트레이팅', 'the orchestrator is named after what it runs');
  assert.equal(lead.task, '결제 v2 나눠서 진행');
  assert.equal(lead.state, 'running');
  assert.equal(lead.path, 'CLI › orca orchestration');

  // the codex worker merged into its transcript agent instead of drawing a twin
  assert.ok(!store.get('orca:w1'));
  const w1 = store.get('codex:abc');
  assert.equal(w1.orchestrator, 'Orca');
  assert.equal(w1.state, 'waiting');
  assert.equal(w1.detail, '승인 대기: $ pnpm add stripe');
  assert.equal(w1.leadId, 'orca:lead');
  assert.equal(w1.orca.worktree, 'seahorse');

  const w2 = store.get('orca:w2');
  assert.equal(w2.client, 'Grok CLI');
  assert.equal(w2.state, 'mcp');
  assert.equal(w2.leadId, 'orca:lead');
  assert.equal(store.mcp.get('figma').calls, 1);

  // the worker pane closes → its agent leaves; the merged transcript agent stays
  sc.apply({ worktrees: [result.worktrees[0], result.worktrees[1]] });
  assert.ok(!store.get('orca:w2'));
  assert.ok(store.get('codex:abc'));
});

test('the orchestrator is the pane workers name as parent; remembered after they finish, saved across restarts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'av-leads-'));
  const leadsFile = path.join(dir, 'orca-leads.json');
  const store = new Store();
  const sc = new OrcaScanner(store, { userData: '/nonexistent', workspaceDir: '/Users/me/orca/workspaces', leadsFile });
  const lead = row({ paneKey: 'boss', agentType: 'codex' });
  const solo = row({ paneKey: 'solo', agentType: 'codex' });
  sc.apply({ worktrees: [wt('myapp', [lead, solo, row({ paneKey: 'w1', parentPaneKey: 'boss' })])] });
  assert.equal(store.get('orca:boss').orca.lead, true);
  assert.equal(store.get('orca:boss').name, 'myapp 오케스트레이팅');
  assert.equal(store.get('orca:solo').orca.lead, false, 'a Codex with no workers is not the orchestrator');
  assert.equal(store.get('orca:w1').orca.lead, false);
  sc.apply({ worktrees: [wt('myapp', [lead, solo])] }); // the worker finished and its pane closed
  assert.equal(store.get('orca:boss').orca.lead, true);
  await new Promise((r) => setTimeout(r, 50)); // saved in the background
  assert.deepEqual(JSON.parse(await fs.readFile(leadsFile, 'utf8')), ['boss']);
  const again = new OrcaScanner(new Store(), { userData: '/nonexistent', workspaceDir: '/Users/me/orca/workspaces', leadsFile });
  assert.ok(again.leads.has('boss'), 'still known after a restart');
  sc.apply({ worktrees: [wt('myapp', [solo])] }); // the orchestrator's terminal closed
  assert.ok(!sc.leads.has('boss'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('the orchestrator card carries its last answer and what it is waiting on', () => {
  const store = new Store();
  const sc = new OrcaScanner(store, { userData: '/nonexistent', workspaceDir: '/Users/me/orca/workspaces' });
  sc.apply({ worktrees: [wt('myapp', [
    row({ paneKey: 'boss', agentType: 'codex', state: 'blocked', toolName: 'Bash', toolInput: 'Get-Content earnings.json', lastAssistantMessage: '영어 전사 먼저 표시 → 번역 갱신' }),
    row({ paneKey: 'w1', parentPaneKey: 'boss', lastAssistantMessage: 'worker text' }),
  ])] });
  const boss = store.get('orca:boss');
  assert.equal(boss.orca.reply, '영어 전사 먼저 표시 → 번역 갱신');
  assert.equal(boss.orca.asking, '승인 대기: $ Get-Content earnings.json');
  assert.equal(store.get('orca:w1').orca.reply, undefined, 'workers do not ship their whole answers in every snapshot');
});

test('terminal screen: spinner noise removed; approval choices only when the screen spells them out', () => {
  const lines = cleanScreen(['', '⠁⠄⢀ ⠈', '  Run Get-Content earnings.json?', '› 1. Yes, proceed (y)', '  2. Yes, and don\'t ask again for this command (p)', '  3. No, and tell Codex what to do differently (esc)', '   ', '⠂⠐']);
  assert.equal(lines[0], '  Run Get-Content earnings.json?');
  assert.deepEqual(screenChoices(lines), [
    { n: 1, label: 'Yes, proceed', key: 'y' },
    { n: 2, label: "Yes, and don't ask again for this command", key: 'p' },
    { n: 3, label: 'No, and tell Codex what to do differently', key: 'esc' },
  ]);
  assert.deepEqual(screenChoices(['   1           Ollama의 반복 번역 제한       이유 (a)']), [], 'a numbered table row is not a menu');
  assert.deepEqual(screenChoices(['2. second (y)', '3. third (n)']), [], 'menus start at 1');
  // a long choice wraps onto the next line; an older menu higher up is ignored
  assert.deepEqual(screenChoices([
    '› 1. Old (y)', '  2. Older (esc)', '  ran it', '',
    "  $ Get-Content -LiteralPath 'D:\\work\\x.py' -Encoding UTF8",
    '› 1. Yes, proceed (y)',
    '  2. Yes, and don\'t ask again for commands that start with `Get-Content -LiteralPath "D:\\\\work\\\\my-project',
    '     -Encoding UTF8` (p)',
    '  3. No, and tell Codex what to do differently (esc)',
    '  Press enter to confirm or esc to cancel',
  ]).map((c) => [c.n, c.key]), [[1, 'y'], [2, 'p'], [3, 'esc']]);
});

test('sessions inside ~/orca/workspaces are tagged as Orca even without the CLI', () => {
  const store = new Store();
  store.upsert('claude:s1', { client: 'Claude Code', via: 'transcript', cwd: '/Users/me/orca/workspaces/shop/nautilus/src', channel: 'CLI', door: 'cli' });
  store.upsert('claude:s2', { client: 'Claude Code', via: 'transcript', cwd: '/Users/me/code/other' });
  const sc = new OrcaScanner(store, { userData: '/nonexistent', workspaceDir: '/Users/me/orca/workspaces' });
  sc.tagWorkspaceAgents();
  assert.equal(store.get('claude:s1').orchestrator, 'Orca');
  assert.equal(store.get('claude:s1').door, 'app');
  assert.equal(store.get('claude:s1').orca.worktree, 'nautilus');
  assert.equal(store.get('claude:s2').orchestrator, null);
});

test('agents started from the Orca Agents daemon are tagged through the process tree', async () => {
  const store = new Store();
  store.upsert('claude:s9', { client: 'Claude Code', via: 'transcript', cwd: '/w/repo', lastActivity: Date.now() });
  const sc = new ProcessScanner(store);
  sc.cwdOf = async () => '/w/repo';
  const p = (pid, ppid, args) => ({ pid, ppid, cpu: 0, age: 300, args, tokens: args.split(/\s+/) });
  await sc.apply([
    p(5, 1, '/Applications/Orca.app/Contents/MacOS/Orca'),
    p(6, 1, '/Users/me/Library/Application Support/Orca/daemon-host/macos/terminal-host-ab12/app.noindex/Orca Agents.app/Contents/MacOS/Orca Agents --max-semi-space-size=4 daemon-entry.js --socket x'),
    p(7, 6, '/bin/zsh -il'),
    p(8, 7, '/opt/homebrew/bin/claude'),
  ]);
  const a = store.get('claude:s9');
  assert.equal(a.alive, true);
  assert.equal(a.channel, 'Orca');
  assert.equal(a.orchestrator, 'Orca');
  assert.ok(store.get('app:orca-app'), 'the Orca app itself shows up');
});

test('helpers: CLI envelope, agent types, Orca-managed transcript folders', async () => {
  assert.deepEqual(parseCliJson('warning: x\n{"id":"1","ok":true,"result":{"worktrees":[]}}'), { worktrees: [] });
  assert.throws(() => parseCliJson('{"ok":false,"error":{"message":"runtime unavailable"}}'), /runtime unavailable/);
  assert.equal(agentTypeInfo('codex').client, 'Codex');
  assert.equal(agentTypeInfo('mystery').client, 'mystery');
  const ud = await fs.mkdtemp(path.join(os.tmpdir(), 'av-orca-ud-'));
  await fs.mkdir(path.join(ud, 'claude-profiles', 'acct1', 'home', 'projects'), { recursive: true });
  const roots = await orcaTranscriptRoots(ud);
  assert.deepEqual(roots.claude, [path.join(ud, 'claude-profiles', 'acct1', 'home', 'projects')]);
  assert.deepEqual(roots.codex, [path.join(ud, 'codex-runtime-home', 'home', 'sessions')]);
});

test('end to end with a fake `orca` CLI: only polls while the runtime is up', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'av-orca-'));
  const bin = path.join(dir, 'orca');
  const payload = { id: '1', ok: true, result: { worktrees: [wt('nautilus', [row({ paneKey: 'p1', agentType: 'amp', taskTitle: '리팩터링', toolName: 'Edit', toolInput: 'src/a.ts' })])] } };
  await fs.writeFile(bin, `#!/bin/sh\necho "$@" >> "${dir}/calls"\ncat <<'JSON'\n${JSON.stringify(payload)}\nJSON\n`, { mode: 0o755 });
  const store = new Store();
  const sc = new OrcaScanner(store, { orcaBin: bin, userData: dir, workspaceDir: '/Users/me/orca/workspaces' });

  await sc.tick(); // no orca-runtime.json yet → Orca not running, CLI not called
  assert.match(store.scanners.orca.error, /실행 중이 아님/);
  assert.equal(await fs.readFile(path.join(dir, 'calls'), 'utf8').catch(() => ''), '');

  await fs.writeFile(path.join(dir, 'orca-runtime.json'), JSON.stringify({ pid: process.pid, transports: [] }));
  sc.nextTry = 0;
  await sc.tick();
  assert.equal(store.scanners.orca.error, null);
  assert.equal(store.scanners.orca.agents, 1);
  const a = store.get('orca:p1');
  assert.equal(a.client, 'Amp');
  assert.equal(a.state, 'typing');
  assert.equal(a.detail, 'Edit a.ts');
  assert.match(await fs.readFile(path.join(dir, 'calls'), 'utf8'), /worktree ps --json/);
});

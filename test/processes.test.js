import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import {
  ProcessScanner, parsePs, identifyAgent, identifyMcp, identifyLaunchedServer, mcpNameFromPkg, parseEtime,
  parseWinProcs, parseNetstatClients, parseLsofClients,
} from '../src/scanners/processes.js';
import { compileProcesses } from '../src/config.js';

const proc = (pid, ppid, args, cpu = 0, age = 600) => ({ pid, ppid, cpu, age, args, tokens: args.split(/\s+/) });

test('agent CLIs are recognised however they are launched', () => {
  assert.equal(identifyAgent(proc(1, 0, '/opt/homebrew/bin/claude'))?.key, 'claude');
  assert.equal(identifyAgent(proc(1, 0, 'node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js --resume'))?.key, 'claude');
  assert.equal(identifyAgent(proc(1, 0, 'node /Users/me/.nvm/versions/node/v22/bin/codex'))?.key, 'codex');
  assert.equal(identifyAgent(proc(1, 0, '/usr/local/bin/gemini'))?.key, 'gemini');
  assert.equal(identifyAgent(proc(1, 0, '/Users/me/.local/bin/aider --model sonnet'))?.key, 'aider');
  assert.equal(identifyAgent(proc(1, 0, 'ollama run llama3'))?.key, 'ollama-run');
  assert.equal(identifyAgent(proc(1, 0, 'ollama serve')), null);
  assert.equal(identifyAgent(proc(1, 0, 'claude mcp serve')), null);
  assert.equal(identifyAgent(proc(1, 0, 'claude --version')), null);
  assert.equal(identifyAgent(proc(1, 0, '/usr/bin/vim claude.md')), null);
});

test('MCP server names from packages, binaries, docker images and URLs', () => {
  assert.equal(mcpNameFromPkg('@modelcontextprotocol/server-github'), 'github');
  assert.equal(mcpNameFromPkg('@playwright/mcp'), 'playwright');
  assert.equal(mcpNameFromPkg('mcp-server-fetch'), 'fetch');
  assert.equal(mcpNameFromPkg('github-mcp-server'), 'github');
  assert.equal(mcpNameFromPkg('@upstash/context7-mcp'), 'context7');
  assert.equal(mcpNameFromPkg('mcp-pdf-server'), 'pdf');
  assert.equal(identifyMcp(proc(5, 1, 'npm exec @modelcontextprotocol/server-pdf --stdio')), 'pdf');
  assert.equal(identifyMcp(proc(5, 1, 'node /root/.npm/_npx/65/node_modules/.bin/mcp-pdf-server --stdio')), 'pdf');
  assert.equal(identifyMcp(proc(5, 1, 'uvx mcp-server-git --repository .')), 'git');
  assert.equal(identifyMcp(proc(5, 1, 'docker run -i --rm ghcr.io/github/github-mcp-server')), 'github');
  assert.equal(identifyMcp(proc(5, 1, 'npx -y mcp-remote https://mcp.linear.app/sse')), 'linear');
  assert.equal(identifyMcp(proc(5, 1, 'claude mcp serve')), 'claude-code');
  assert.equal(identifyMcp(proc(5, 1, 'sh -c mcp-pdf-server --stdio')), null);
  assert.equal(identifyMcp(proc(5, 1, 'grep mcp')), null);
  assert.equal(identifyLaunchedServer(proc(6, 1, 'npm exec @wonderwhy-er/desktop-commander@latest')), 'desktop-commander');
  assert.equal(parseEtime('2-01:02:03'), 2 * 86400 + 3723);
  assert.equal(parsePs('  93     1  1.2       25:01 /opt/node22/bin/claude --x\n    2     0  0.0   1:00 [kthreadd]')[0].pid, 93);
});

test('process scan links sessions, finds MCP launchers, apps and custom agents', async () => {
  const store = new Store();
  store.upsert('claude:s1', { client: 'Claude Code', via: 'transcript', cwd: '/w/shop/api', name: 'api', lastActivity: Date.now() });
  const sc = new ProcessScanner(store, {
    customProcesses: compileProcesses([{ name: 'MyApp', match: 'orca.*\\bmyapp\\b', client: 'Orca', channel: 'Orca' }]),
  });
  sc.cwdOf = async (pid) => ({ 10: '/w/shop', 20: '/w/other', 40: '/w/orca' })[pid] || '';
  const procs = [
    proc(10, 1, '/opt/homebrew/bin/claude'),
    proc(11, 10, 'npm exec @modelcontextprotocol/server-github'),
    proc(12, 11, 'sh -c mcp-server-github'),
    proc(13, 10, 'npm exec @wonderwhy-er/desktop-commander@latest'),
    proc(20, 1, '/Users/me/.local/bin/aider'),
    proc(21, 20, '/bin/zsh -c pytest -q'),
    proc(30, 1, '/Applications/Claude.app/Contents/MacOS/Claude'),
    proc(31, 30, 'node /Users/me/mcp/slack-mcp-server/index.js'),
    proc(40, 1, 'python -m orca.agents.myapp --worker 2'),
  ];
  await sc.apply(procs);

  const claude = store.get('claude:s1');
  assert.equal(claude.alive, true, 'session linked to its process even though it cd-ed into a sub-folder');
  assert.equal(claude.pid, 10);
  assert.ok(!store.get('proc:10'), 'no duplicate process-only agent');

  const gh = store.mcp.get('github');
  assert.deepEqual(gh.launcherIds, ['claude:s1']);
  assert.ok(store.mcp.get('desktop-commander'), 'npx-launched server detected without "mcp" in its name');
  assert.deepEqual(store.mcp.get('slack').launchers, ['Claude 앱']);

  const aider = store.get('proc:20');
  assert.equal(aider.client, 'Aider');
  assert.equal(aider.state, 'running');
  assert.equal(aider.detail, '$ pytest -q');

  const app = store.get('app:claude-app');
  assert.equal(app.door, 'app');
  assert.equal(app.detail, 'MCP 연결: slack');

  const abs = store.get('proc:40');
  assert.equal(abs.name, 'MyApp');
  assert.equal(abs.client, 'Orca');
  assert.equal(abs.channel, 'Orca');

  // aider exits → removed; claude exits → marked closed
  await sc.apply(procs.filter((p) => p.pid !== 20 && p.pid !== 10 && p.ppid !== 10 && p.ppid !== 11));
  assert.ok(!store.get('proc:20'));
  assert.equal(store.get('claude:s1').alive, false);
});

test('Windows CPU % comes from the CPU-time change between scans', () => {
  const procs = parseWinProcs('[{"p":7,"pp":1,"n":"x.exe","c":"x.exe","a":10,"t":1000}]');
  assert.equal(procs[0].cpuMs, 1000);
  const sc = new ProcessScanner(new Store(), { platform: 'win32' });
  sc.fillCpu(procs, 10_000);
  assert.equal(procs[0].cpu, 0, 'first sighting: nothing to compare with yet');
  const later = parseWinProcs('[{"p":7,"pp":1,"n":"x.exe","c":"x.exe","a":15,"t":8500}]');
  sc.fillCpu(later, 15_000);
  assert.equal(later[0].cpu, 150, '7.5 s of CPU in 5 s = 1.5 cores');
});

test('who is connected to Ollama, from netstat (Windows) and lsof', () => {
  const netstat = `
  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       28176
  TCP    127.0.0.1:11434        127.0.0.1:60123        ESTABLISHED     28176
  TCP    127.0.0.1:60123        127.0.0.1:11434        ESTABLISHED     15156
  TCP    10.0.0.2:50000         1.2.3.4:443            ESTABLISHED     900`;
  assert.deepEqual(parseNetstatClients(netstat, 11434), [15156]);
  assert.deepEqual(parseLsofClients('p500\nn127.0.0.1:5000->127.0.0.1:11434\np28\nn127.0.0.1:11434->127.0.0.1:5000\n', 11434), [500]);
});

test('Ollama server shows working while its model runner burns CPU, idle with the model loaded otherwise', async () => {
  const store = new Store();
  const sc = new ProcessScanner(store, { platform: 'win32' });
  const now = Date.now();
  sc.ollamaModels = async () => [{ name: 'exaone3.5:7.8b', expiresAt: now + 4 * 60e3 }];
  sc.ollamaClients = async () => [15156, 28176];
  const table = (runnerMs, t) => parseWinProcs(JSON.stringify([
    { p: 28176, pp: 2896, n: 'ollama.exe', c: 'C:\\Ollama\\ollama.exe serve', a: 900, t: 5000 },
    { p: 47476, pp: 28176, n: 'llama-server.exe', c: 'C:\\Ollama\\lib\\ollama\\llama-server.exe --model C:\\m\\blob --port 50001', a: 600, t: runnerMs },
    { p: 15156, pp: 1, n: 'pythonw.exe', c: 'C:\\Python311\\pythonw.exe -X utf8 -u poll_feed.py --watch', a: 3000, t: 100 },
  ])).map((p) => ({ ...p, _t: t }));
  const realNow = Date.now;
  try {
    Date.now = () => now;
    await sc.apply(table(1000, now));
    let a = store.get('app:ollama-serve');
    assert.equal(a.state, 'idle');
    assert.match(a.detail, /exaone3\.5:7\.8b 로드됨/);
    Date.now = () => now + 5000;
    await sc.apply(table(8500, now + 5000)); // runner used 7.5 s of CPU in 5 s
    a = store.get('app:ollama-serve');
    assert.equal(a.state, 'thinking');
    assert.match(a.detail, /생성 중 · exaone3\.5:7\.8b ← poll_feed/);
    assert.equal(a.task, 'exaone3.5:7.8b 추론 처리');
    Date.now = () => now + 20000;
    await sc.apply(table(8500, now + 20000)); // quiet again
    assert.equal(store.get('app:ollama-serve').state, 'idle');
  } finally {
    Date.now = realNow;
  }
});

test('Claude Code ~/.claude/sessions/<pid>.json pairs processes with sessions exactly (Windows desktop app)', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'av-sessions-'));
  await fsp.writeFile(path.join(dir, '200.json'), JSON.stringify({ pid: 200, sessionId: 'aaa', cwd: 'D:\\' }));
  await fsp.writeFile(path.join(dir, '300.json'), JSON.stringify({ pid: 300, sessionId: 'bbb', cwd: 'D:\\' }));
  await fsp.writeFile(path.join(dir, '200.deadbeef.key'), '{"peerToken":"x"}');
  const store = new Store();
  const now = Date.now();
  // newest activity on 'bbb' would win a cwd-less guess for either process
  store.upsert('claude:aaa', { client: 'Claude Code', via: 'transcript', cwd: 'D:\\', lastActivity: now - 60e3 });
  store.upsert('claude:bbb', { client: 'Claude Code', via: 'transcript', cwd: 'D:\\', lastActivity: now });
  // and a stale wrong guess from before
  store.upsert('claude:bbb', { pid: 200, alive: true });
  const sc = new ProcessScanner(store, { platform: 'win32', claudeSessionsDir: dir });
  const app = '"C:\\Program Files\\WindowsApps\\Claude_5.1.0_x64__abc\\app\\claude.exe"';
  const cc = 'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude-code\\2.1\\x\\claude.exe --output-format stream-json';
  const p = (pid, ppid, args) => ({ pid, ppid, cpu: 0, age: 600, args, tokens: args.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')) });
  await sc.apply([
    p(100, 1, app),
    p(101, 100, `${app} --type=renderer`),
    p(200, 100, cc),
    p(300, 100, cc),
  ]);
  assert.equal(store.get('claude:aaa').pid, 200);
  assert.equal(store.get('claude:bbb').pid, 300);
  assert.equal(store.get('claude:aaa').alive, true);
  // the Store-installed desktop app is an app, not a Claude Code CLI session
  assert.ok(![...store.agents.values()].some((a) => (a.pid === 100 || a.pid === 101) && a.client === 'Claude Code'));
  assert.equal([...store.agents.values()].filter((a) => a.client === 'Claude Code').length, 2);
  await fsp.rm(dir, { recursive: true, force: true });
});

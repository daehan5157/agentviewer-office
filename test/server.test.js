import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agentviewer.js');

async function start(opts = {}) {
  const store = new Store();
  const server = createServer(store, opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { store, server, url };
}

test('HTTP report API: upsert, nesting, MCP pulse, static files', async () => {
  const { store, server, url } = await start();
  try {
    const auth = { 'content-type': 'application/json' };
    let r = await fetch(`${url}/api/report`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ id: 'orca-myapp', name: 'MyApp', client: 'Orca', channel: 'Orca', state: 'running', task: '배치 처리', detail: '$ run job', mcp_server: 'postgres', tool: 'insert' }),
    });
    assert.equal(r.status, 200);
    r = await fetch(`${url}/api/report`, { method: 'POST', headers: auth, body: JSON.stringify({ id: 'orca-myapp-w1', name: 'worker-1', parent: 'orca-myapp', state: 'reading' }) });
    assert.equal(r.status, 200);
    const snap = await (await fetch(`${url}/api/state`)).json();
    const app = snap.agents.find((a) => a.id === 'api:orca-myapp');
    assert.equal(app.client, 'Orca');
    assert.equal(app.door, 'api');
    assert.equal(app.task, '배치 처리');
    assert.equal(snap.agents.find((a) => a.id === 'api:orca-myapp-w1').parentId, 'api:orca-myapp');
    assert.equal(snap.mcp.find((m) => m.name === 'postgres').calls, 1);
    const bad = await fetch(`${url}/api/report`, { method: 'POST', headers: auth, body: '{nope' });
    assert.equal(bad.status, 400);
    const html = await fetch(`${url}/`);
    assert.match(await html.text(), /Agentviewer/);
    assert.equal((await fetch(`${url}/../package.json`)).status, 404);
    await fetch(`${url}/api/agents/orca-myapp`, { method: 'DELETE', headers: auth });
    assert.ok(store.get('api:orca-myapp').finishedAt);
  } finally {
    server.close();
  }
});

test('MCP stdio bridge: handshake, tools, report shows up through the MCP door', async () => {
  const { store, server, url } = await start();
  const child = spawn(process.execPath, [BIN, 'mcp', '--url', url], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: child.stdout });
  const waiting = new Map();
  rl.on('line', (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  const call = (id, method, params) =>
    new Promise((resolve) => {
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor-vscode', version: '1.9' } });
    assert.equal(init.result.serverInfo.name, 'agentviewer');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = await call(2, 'tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name), ['agentviewer_report', 'agentviewer_list_agents']);
    const res = await call(3, 'tools/call', { name: 'agentviewer_report', arguments: { state: 'typing', task: '랜딩 페이지 수정', detail: 'Edit hero.tsx' } });
    assert.equal(res.result.content[0].text, 'reported');
    const a = [...store.agents.values()].find((x) => x.client === 'cursor-vscode');
    assert.ok(a, 'MCP client registered as an agent');
    assert.equal(a.door, 'mcp');
    assert.equal(a.via, 'mcp');
    assert.equal(a.state, 'typing');
    assert.equal(a.task, '랜딩 페이지 수정');
    const listed = await call(4, 'tools/call', { name: 'agentviewer_list_agents', arguments: {} });
    assert.match(listed.result.content[0].text, /cursor-vscode/);
    const unknown = await call(5, 'nope/method', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    child.stdin.end();
    await new Promise((r) => child.on('exit', r));
    server.close();
  }
  assert.ok([...store.agents.values()].find((x) => x.client === 'cursor-vscode').finishedAt, 'leaves the office when the client disconnects');
});

test('handing a task to an Orca agent: only from this PC, only with the control header, only Orca agents', async () => {
  const http = await import('node:http');
  const sent = [];
  const control = {
    canPrompt: (a) => !!(a.orca?.paneKey && a.orca.lead),
    sendPrompt: async (a, text) => {
      sent.push([a.id, text]);
      return { handle: 'term_1', stages: ['input_accepted', 'turn_started'], started: true };
    },
    readScreen: async () => ({ lines: ['Run it?', '› 1. Yes (y)', '  2. No (esc)'], choices: [{ n: 1, label: 'Yes', key: 'y' }, { n: 2, label: 'No', key: 'esc' }] }),
    sendKey: async (a, key) => {
      sent.push([a.id, `key:${key}`]);
      return { handle: 'term_1' };
    },
  };
  const { store, server, url } = await start({ control });
  store.upsert('orca:tab:leaf', { name: '오케스트레이터', client: 'Codex', orca: { paneKey: 'tab:leaf', lead: true } });
  store.upsert('orca:tab:worker', { name: 'worker', client: 'Claude Code', orca: { paneKey: 'tab:worker', lead: false } });
  store.upsert('proc:9', { name: 'aider', client: 'Aider' });
  const post = (id, body, headers = {}) => fetch(`${url}/api/agents/${encodeURIComponent(id)}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agentviewer-control': '1', ...headers }, body: JSON.stringify(body),
  });
  // raw request so Host can be forged (DNS rebinding: evil.example resolving to 127.0.0.1)
  const raw = (host) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, method: 'POST', path: '/api/agents/orca%3Atab%3Aleaf/prompt', headers: { host, 'content-type': 'application/json', 'x-agentviewer-control': '1' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end('{"text":"hi"}');
  });
  try {
    assert.deepEqual(await (await fetch(`${url}/api/control`)).json(), { canSend: true, canScreen: true, role: 'owner' });
    let r = await post('orca:tab:leaf', { text: '  배치 큐 상태 확인해줘\r\n2번째 줄  ' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).started, true);
    assert.deepEqual(sent, [['orca:tab:leaf', '배치 큐 상태 확인해줘\n2번째 줄']]);
    assert.match(store.get('orca:tab:leaf').log[0].text, /^내가 보낸 작업: 배치 큐/);

    assert.equal((await post('orca:tab:leaf', { text: 'x' }, { 'x-agentviewer-control': '' })).status, 403, 'a cross-site form/fetch cannot add the header');
    assert.equal((await post('orca:tab:leaf', { text: 'x' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal(await raw('evil.example:4747'), 403);
    assert.equal(await raw(`localhost:${new URL(url).port}`), 200);
    assert.equal((await post('proc:9', { text: 'x' })).status, 400, 'not an Orca agent');
    assert.equal((await post('orca:tab:worker', { text: 'x' })).status, 400, 'workers take orders from the orchestrator, not from here');
    assert.equal((await post('orca:tab:leaf', { text: '   ' })).status, 400);
    assert.equal((await post('nope', { text: 'x' })).status, 404);
    assert.equal(sent.length, 2);

    // reading its screen and answering an on-screen choice
    const screen = await (await fetch(`${url}/api/agents/orca%3Atab%3Aleaf/screen`)).json();
    assert.deepEqual(screen.choices.map((c) => c.key), ['y', 'esc']);
    assert.equal((await fetch(`${url}/api/agents/orca%3Atab%3Aworker/screen`)).status, 400, 'only the orchestrator');
    assert.equal((await fetch(`${url}/api/agents/orca%3Atab%3Aleaf/screen`, { headers: { origin: 'https://evil.example' } })).status, 403);
    const key = (k, headers = {}) => fetch(`${url}/api/agents/orca%3Atab%3Aleaf/key`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-agentviewer-control': '1', ...headers }, body: JSON.stringify({ key: k }),
    });
    assert.equal((await key('y')).status, 200);
    assert.equal((await key('esc')).status, 200);
    assert.equal((await key('rm -rf /')).status, 400, 'one key only');
    assert.equal((await key('y', { 'x-agentviewer-control': '' })).status, 403);
    assert.deepEqual(sent.slice(2), [['orca:tab:leaf', 'key:y'], ['orca:tab:leaf', 'key:esc']]);
    assert.match(store.get('orca:tab:leaf').log[0].text, /^내가 고른 답: Esc/);
  } finally {
    server.close();
  }
  const plain = await start(); // no control wired (e.g. --no-orca)
  try {
    assert.deepEqual(await (await fetch(`${plain.url}/api/control`)).json(), { canSend: false, canScreen: false, role: 'viewer' });
  } finally {
    plain.server.close();
  }
});


test('other machines are refused: only this PC can see or drive anything', async (t) => {
  const os = await import('node:os');
  const ip = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  if (!ip) return t.skip('no LAN address in this environment');
  const store = new Store();
  const sent = [];
  const control = { canPrompt: () => true, sendPrompt: async (a, text) => (sent.push(text), {}), readScreen: async () => ({ lines: ['secret'] }), sendKey: async () => ({}) };
  const server = createServer(store, { control });
  store.upsert('orca:a:b', { name: 'x', orca: { paneKey: 'a:b', lead: true } });
  // even if someone binds every interface, a request from another machine gets nothing
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const port = server.address().port;
  const H = { 'content-type': 'application/json', 'x-agentviewer-control': '1' };
  try {
    for (const p of ['/', '/index.html', '/api/state', '/api/stream', '/api/control', '/api/agents/orca%3Aa%3Ab/screen']) {
      const r = await fetch(`http://${ip}:${port}${p}`);
      assert.equal(r.status, 403, p);
      assert.doesNotMatch(await r.text(), /secret|orca/);
    }
    assert.equal((await fetch(`http://${ip}:${port}/api/report`, { method: 'POST', headers: H, body: '{"name":"x"}' })).status, 403);
    assert.equal((await fetch(`http://${ip}:${port}/api/agents/orca%3Aa%3Ab/prompt`, { method: 'POST', headers: H, body: '{"text":"rm -rf"}' })).status, 403);
    assert.equal((await fetch(`http://${ip}:${port}/?t=anything`)).status, 403, 'no share links');
    assert.equal((await fetch(`http://${ip}:${port}/login`, { method: 'POST', body: 'code=123456' })).status, 403, 'no code sign-in');
    assert.equal(sent.length, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`)).status, 200, 'this PC still works');
  } finally {
    server.close();
  }
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';
import { Look } from '../src/look.js';
import { ThemeWorker, extractJson } from '../src/themeworker.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'av-worker-'));
const until = async (f, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
};

test('extractJson finds the theme in a plain or fenced answer', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('여기 있어요:\n```json\n{"a":{"b":2}}\n```\n끝'), { a: { b: 2 } });
  assert.equal(extractJson('JSON 없음'), null);
});

test('a separate worker makes the theme; Agentviewer checks it and saves it', async () => {
  const dir = tmp();
  const look = new Look({ dir });
  const calls = [];
  const answer = '```json\n' + JSON.stringify({ name: '우주', icon: '🚀', floor: { pattern: 'tiles', colors: ['#1b2447', 'nope'] }, evil: '<script>' }) + '\n```';
  const run = async (bin, args, stdin, cwd) => (calls.push({ bin, args, stdin, cwd }), answer);
  const w = new ThemeWorker({ look, bins: { claude: '/x/claude', codex: null }, run });
  assert.deepEqual(w.engines(), [{ id: 'claude', name: 'Claude Code' }]);
  assert.throws(() => w.start('우주', 'codex'), /없는/);

  w.start('우주', 'claude');
  assert.throws(() => w.start('바다', 'claude'), /만드는 중/, 'one at a time');
  const job = await until(() => (w.status().state !== 'running' ? w.status() : null));
  assert.equal(job.state, 'done', job.error);
  assert.equal(job.themeId, '우주');
  const saved = JSON.parse(await fsp.readFile(path.join(dir, 'themes', '우주.json'), 'utf8'));
  assert.deepEqual(saved.floor.colors, ['#1b2447']);
  assert.equal(saved.evil, undefined);

  // the worker has no tools and gets the spec inline; it runs outside any project
  const c = calls[0];
  assert.ok(c.args.includes('-p') && c.args[c.args.indexOf('--tools') + 1] === '');
  assert.match(c.stdin, /우주/);
  assert.match(c.stdin, /workstation/);
  assert.ok(c.cwd.startsWith(os.tmpdir()));
  assert.equal(fs.existsSync(c.cwd), false, 'temp folder cleaned up');

  // the same idea again gets a new file, never overwriting
  w.start('우주', 'claude');
  assert.equal((await until(() => (w.status().state !== 'running' ? w.status() : null))).themeId, '우주-2');
});

test('a worker that answers nonsense ends in an error, no file', async () => {
  const dir = tmp();
  const w = new ThemeWorker({ look: new Look({ dir }), bins: { claude: 'x' }, run: async () => '미안해요' });
  w.start('우주', 'claude');
  const job = await until(() => (w.status().state !== 'running' ? w.status() : null));
  assert.equal(job.state, 'error');
  assert.equal(fs.existsSync(path.join(dir, 'themes')), false);
});

test('look API: start a worker, follow its job, only from this PC', async () => {
  const dir = tmp();
  const look = new Look({ dir });
  let release;
  const gate = new Promise((r) => (release = r));
  const themeWorker = new ThemeWorker({ look, bins: { codex: 'x' }, run: async () => (await gate, '{"name":"바다","floor":{"pattern":"water"}}') });
  const server = createServer(new Store(), { look, themeWorker });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const H = { 'content-type': 'application/json', 'x-agentviewer-control': '1' };
  try {
    const st = await (await fetch(`${url}/api/look`)).json();
    assert.deepEqual(st.engines, [{ id: 'codex', name: 'Codex' }]);
    let r = await fetch(`${url}/api/look/request`, { method: 'POST', headers: H, body: JSON.stringify({ idea: '바다', engine: 'codex' }) });
    const j = await r.json();
    assert.equal(j.started, true);
    assert.equal(j.job.state, 'running');
    r = await fetch(`${url}/api/look/request`, { method: 'POST', headers: H, body: JSON.stringify({ idea: '산', engine: 'codex' }) });
    assert.equal(r.status, 409);
    assert.equal((await fetch(`${url}/api/look/job`, { headers: { origin: 'https://evil.example' } })).status, 403);
    release();
    const job = await until(async () => {
      const { job: jb } = await (await fetch(`${url}/api/look/job`)).json();
      return jb.state !== 'running' ? jb : null;
    });
    assert.equal(job.state, 'done');
    assert.ok((await (await fetch(`${url}/api/look`)).json()).themes.some((t) => t.id === '바다' && t.mine));
  } finally {
    server.close();
  }
});

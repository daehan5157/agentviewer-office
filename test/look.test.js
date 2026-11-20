import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';
import { Look, cleanTheme, cleanLook, BUILTIN_THEMES } from '../src/look.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'av-look-'));

test('theme files are checked: bad colours, unknown keys and oversized art are dropped', () => {
  const t = cleanTheme({
    name: '공사장', icon: '🚧', evil: '<script>',
    floor: { pattern: 'lava', colors: ['#AABBCC', 'red', 'url(x)'], line: '#123456' },
    wall: { paper: '#ffffff', trim: 'javascript:alert(1)' },
    props: [
      { pixels: ['ab', 'ba'], colors: { a: '#ff0000', b: 'blue', ab: '#00ff00' }, layer: 'roof', x: 5, y: -1, scale: 9, repeat: 99 },
      { pixels: ['xx'], colors: {} },
      { pixels: Array(60).fill('a'.repeat(60)), colors: { a: '#000000' } },
    ],
    outfit: { accessory: 'jetpack', shirt: '#f07a1a' },
  }, 'construction');
  assert.equal(t.evil, undefined);
  assert.deepEqual(t.floor, { colors: ['#aabbcc'], line: '#123456' }, 'unknown pattern and bad colours dropped');
  assert.deepEqual(t.wall, { paper: '#ffffff' });
  assert.equal(t.props.length, 2, 'a prop with no usable colours is dropped');
  assert.deepEqual(t.props[0], { pixels: ['ab', 'ba'], colors: { a: '#ff0000' }, layer: 'floor', x: 1, y: 0, scale: 4, repeat: 30, gap: 0.1 });
  assert.equal(t.props[1].pixels.length, 48);
  assert.equal(t.props[1].pixels[0].length, 48);
  assert.deepEqual(t.outfit, { shirt: '#f07a1a' });
  assert.equal(cleanLook({ hair: 'x' }), null);
});

test('built-in themes are valid and keep their art', async () => {
  const look = new Look({ dir: tmp() });
  const ids = (await look.themes()).map((t) => t.id).sort();
  assert.deepEqual(ids, ['cafe', 'construction', 'office', 'pool']);
  for (const id of ids) {
    const raw = JSON.parse(await fsp.readFile(path.join(BUILTIN_THEMES, `${id}.json`), 'utf8'));
    const t = await look.theme(id);
    assert.equal(t.props?.length || 0, raw.props?.length || 0, `${id}: no prop dropped`);
  }
  assert.equal((await look.theme('construction')).outfit.accessory, 'hardhat');
  for (const id of ['cafe', 'construction', 'pool']) {
    const ws = (await look.theme(id)).workstation;
    assert.ok(ws?.desk?.screen && ws.chair, `${id}: has its own desk with a screen and a chair`);
    const art = ws.desk.pixels;
    const { x, y, w, h } = ws.desk.screen;
    assert.ok(x + w <= art[0].length && y + h <= art.length, `${id}: screen sits inside the desk art`);
  }
  assert.ok((await look.theme('pool')).workstation.chair.front, 'pool tube is drawn over the swimmer');
});

test('theme workstation art is checked: oversized art cut, bad screen dropped, chair can be none', () => {
  const big = { pixels: Array(60).fill('K'.repeat(90)), colors: { K: '#000000', bad: '#fff', z: 'red' } };
  const t = cleanTheme({ name: 'x', workstation: { desk: { ...big, screen: { x: 2, y: 2, w: 'wide', h: 5 } }, chair: 'none' } }, 'x');
  assert.equal(t.workstation.desk.pixels.length, 40);
  assert.equal(t.workstation.desk.pixels[0].length, 64);
  assert.deepEqual(t.workstation.desk.colors, { K: '#000000' });
  assert.equal(t.workstation.desk.screen, undefined);
  assert.equal(t.workstation.noChair, true);
  const c = cleanTheme({ name: 'y', workstation: { chair: { ...big, front: ['K', 5] } } }, 'y');
  assert.equal(c.workstation.chair.pixels.length, 28);
  assert.equal(c.workstation.chair.pixels[0].length, 24);
  assert.deepEqual(c.workstation.chair.front, ['K']);
  assert.equal(cleanTheme({ name: 'z', workstation: 'desk' }, 'z').workstation, undefined);
});

test('look API: everyone reads it; only this PC changes it; agent-made themes appear', async () => {
  const dir = tmp();
  const look = new Look({ dir });
  const store = new Store();
  const sent = [];
  const control = { canPrompt: (a) => !!a.orca?.lead, sendPrompt: async (a, text) => (sent.push([a.id, text]), {}) };
  const server = createServer(store, { look, control });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const put = (body, headers = { 'x-agentviewer-control': '1' }) =>
    fetch(`${url}/api/look`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    let st = await (await fetch(`${url}/api/look`)).json();
    assert.equal(st.theme, 'office');
    assert.equal(st.canEdit, true);
    const v0 = st.version;

    assert.equal((await put({ theme: 'pool' })).status, 200);
    assert.equal((await put({ theme: 'nope' })).status, 404);
    assert.equal((await put({ theme: 'cafe' }, {})).status, 403, 'needs the control header');
    assert.equal((await put({ theme: 'cafe' }, { 'x-agentviewer-control': '1', origin: 'https://evil.example' })).status, 403);
    assert.equal((await put({ chars: { Codex: { hair: '#ff0000', accessory: 'glasses', bogus: 1 }, Bad: { hair: 'red' } } })).status, 200);
    st = await (await fetch(`${url}/api/look`)).json();
    assert.equal(st.theme, 'pool');
    assert.equal(st.themeData.outfit.accessory, 'swimcap');
    assert.deepEqual(st.chars, { Codex: { hair: '#ff0000', accessory: 'glasses' } });
    assert.notEqual(st.version, v0);
    await put({ chars: { Codex: null } });
    assert.deepEqual((await (await fetch(`${url}/api/look`)).json()).chars, {});

    // asking for a theme never types into a running agent, even the orchestrator: without a
    // worker it hands back the prompt to paste
    store.upsert('orca:a:b', { name: '프로젝트 오케스트레이팅', orca: { paneKey: 'a:b', lead: true } });
    const ask = (engine) => fetch(`${url}/api/look/request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentviewer-control': '1' }, body: JSON.stringify({ idea: '우주정거장', engine }) });
    for (const engine of [undefined, 'copy', 'claude']) {
      const r = await (await ask(engine)).json();
      assert.equal(r.started, false);
      assert.match(r.prompt, /우주정거장/);
      assert.ok(r.prompt.includes(path.join(dir, 'themes', '우주정거장.json')));
      assert.doesNotMatch(r.prompt, /\n/, 'one line for a terminal');
    }
    assert.equal(sent.length, 0, 'nothing typed into the orchestrator');

    // the agent writes the file → it shows up (and the version moves)
    const before = (await (await fetch(`${url}/api/look/version`)).json()).version;
    await fsp.mkdir(path.join(dir, 'themes'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'themes', '우주정거장.json'), JSON.stringify({ name: '우주정거장', icon: '🚀', floor: { pattern: 'tiles', colors: ['#1b2447'] } }));
    const themes = (await (await fetch(`${url}/api/look`)).json()).themes;
    assert.ok(themes.some((t) => t.id === '우주정거장' && t.mine));
    assert.notEqual((await (await fetch(`${url}/api/look/version`)).json()).version, before);
    assert.equal((await put({ theme: '우주정거장' })).status, 200);
  } finally {
    server.close();
  }
});

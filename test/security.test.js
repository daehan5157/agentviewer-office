import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';

const listen = async (opts) => {
  const server = createServer(new Store(), opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
};

/** a raw request, so the Host header can be anything (fetch won't let us forge it) */
const raw = (port, { path = '/', method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });

test('every response refuses to be framed and leaks no referrer', async () => {
  const { server, port } = await listen({});
  try {
    for (const path of ['/', '/api/state', '/nope']) {
      const r = await raw(port, { path, headers: { host: `localhost:${port}` } });
      assert.equal(r.headers['x-frame-options'], 'DENY', path);
      assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['referrer-policy'], 'no-referrer');
    }
  } finally {
    server.close();
  }
});

test('DNS rebinding: a loopback connection naming another host is refused', async () => {
  const { server, port } = await listen({});
  try {
    assert.equal((await raw(port, { path: '/api/state', headers: { host: `localhost:${port}` } })).status, 200);
    assert.equal((await raw(port, { path: '/api/state', headers: { host: `evil.example:${port}` } })).status, 403);
    assert.equal((await raw(port, { path: '/', headers: { host: `evil.example:${port}` } })).status, 403);
  } finally {
    server.close();
  }
  // shared: the loopback shortcut (no token needed) only for loopback names
  const s = await listen({ token: 'tok', trustLoopback: true });
  try {
    assert.equal((await raw(s.port, { path: '/api/state', headers: { host: `127.0.0.1:${s.port}` } })).status, 200);
    assert.equal((await raw(s.port, { path: '/api/state', headers: { host: `evil.example:${s.port}` } })).status, 401);
  } finally {
    s.server.close();
  }
});

test('code guessing is capped per address and across all addresses', async () => {
  const { server, port } = await listen({ token: 'tok', codes: { view: '123456', collab: '654321' } });
  const login = (code, ip) =>
    raw(port, { path: '/login', method: 'POST', headers: { host: `pc:${port}`, 'content-type': 'application/x-www-form-urlencoded', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: `code=${code}` });
  try {
    for (let i = 0; i < 5; i++) assert.match((await login('000000')).headers.location, /e=(bad|wait)/);
    const r = await login('123456');
    assert.equal(r.headers.location, '/?e=wait', 'locked even with the right code');
    assert.equal(r.headers['set-cookie'], undefined);
    // x-forwarded-for is not trusted: still the same address
    assert.equal((await login('123456', '10.9.9.9')).headers.location, '/?e=wait');
  } finally {
    server.close();
  }
});

test('the collaborator link is off unless asked for', async () => {
  const { server, port } = await listen({ token: 'tok', codes: { view: '123456', collab: '654321' } }); // no collabToken
  try {
    const r = await raw(port, { path: '/login', method: 'POST', headers: { host: `pc:${port}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=654321' });
    assert.equal(r.headers.location, '/?e=bad', 'the collab code means nothing without --collab');
  } finally {
    server.close();
  }
});

test('server errors never echo internal details', async () => {
  const { server, port } = await listen({});
  try {
    const r = await raw(port, { path: '/%E0%A4%A', headers: { host: `localhost:${port}` } });
    assert.ok(r.status >= 400);
    assert.doesNotMatch(r.body, /URI|malformed|at \w+ \(/i);
  } finally {
    server.close();
  }
});

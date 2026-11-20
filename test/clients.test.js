import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function start() {
  const store = new Store();
  const server = createServer(store);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { store, server, url: `http://127.0.0.1:${server.address().port}` };
}

const hasPython = await new Promise((r) => execFile('python3', ['--version'], (e) => r(!e)));

test('Python reporter shows up with task, steps and sub-workers', { skip: !hasPython && 'python3 not installed' }, async () => {
  const { store, server, url } = await start();
  const script = `
from agentviewer_reporter import Reporter
av = Reporter("MyApp", client="내 파이프라인")
av.update("web", "피드 확인 중", task="피드 감시")
with av.step("typing", "요약 생성: 샘플 항목"):
    pass
w = av.child("전송기")
w.update("running", "결과 전송: 대상 서버")
try:
    with av.step("running", "외부 API 호출"):
        raise TimeoutError("feed timeout")
except TimeoutError:
    pass
`;
  try {
    await new Promise((resolve, reject) =>
      execFile('python3', ['-c', script], { env: { ...process.env, PYTHONPATH: path.join(ROOT, 'clients/python'), AGENTVIEWER_URL: url } }, (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve())),
    );
    const abs = store.get('api:myapp');
    assert.ok(abs, 'MyApp registered');
    assert.equal(abs.client, '내 파이프라인');
    assert.equal(abs.task, '피드 감시');
    assert.equal(abs.state, 'waiting');
    assert.match(abs.detail, /TimeoutError: feed timeout/);
    assert.ok(abs.log.some((l) => l.text === '요약 생성: 샘플 항목'));
    const worker = store.get('api:myapp-전송기');
    assert.equal(worker.parentId, 'api:myapp');
    assert.equal(worker.state, 'running');
  } finally {
    server.close();
  }
});

test('Python reporter never fails the host program when Agentviewer is down', { skip: !hasPython && 'python3 not installed' }, async () => {
  const t0 = Date.now();
  await new Promise((resolve, reject) =>
    execFile('python3', ['-c', 'from agentviewer_reporter import Reporter\nr=Reporter("MyApp")\nfor i in range(20): r.update("running", str(i))\nprint("ok")'],
      { env: { ...process.env, PYTHONPATH: path.join(ROOT, 'clients/python'), AGENTVIEWER_URL: 'http://127.0.0.1:9' } },
      (e, so) => (e ? reject(e) : (assert.equal(so.trim(), 'ok'), resolve()))),
  );
  assert.ok(Date.now() - t0 < 4000);
});

test('Node reporter keeps order and nests children', async () => {
  const { store, server, url } = await start();
  try {
    const { Reporter } = await import('../clients/node/agentviewer-reporter.mjs');
    const av = new Reporter('MyApp', { client: '내 파이프라인', url });
    av.update('web', '피드 확인', { task: '피드 감시' });
    await av.step('typing', '요약 생성', async () => 'caption');
    const child = av.child('전송기');
    child.update('running', '전송 중');
    await av.done('전송 완료');
    assert.equal(store.get('api:myapp').state, 'done');
    assert.deepEqual(store.get('api:myapp').log.slice(0, 3).map((l) => l.text).reverse(), ['피드 확인', '요약 생성', '전송 완료']);
    assert.equal(store.get('api:myapp-전송기').parentId, 'api:myapp');
  } finally {
    server.close();
  }
});

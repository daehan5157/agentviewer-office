// Agentviewer reporter for Node.js (18+): let your own system (e.g. a data
// pipeline or a batch job) show up in the Agentviewer office.
// Copy this single file into your project. No dependencies. It never throws
// and never blocks: if Agentviewer is not running, reports are dropped.
//
//   import { Reporter } from './agentviewer-reporter.mjs';
//   const av = new Reporter('MyApp', { client: '내 파이프라인' });
//   av.update('web', '피드 확인 중', { task: '피드 감시' });
//   await av.step('typing', '요약 생성: 샘플 항목', async () => summarize(item));
//   av.update('running', '결과 전송: 대상 서버');
//   av.done('전송 완료');

const STATES = new Set(['thinking', 'typing', 'reading', 'running', 'web', 'mcp', 'delegating', 'planning', 'waiting', 'done', 'idle']);
let chain = Promise.resolve(); // keeps reports in order

export class Reporter {
  constructor(name, { client, channel, id, door = 'api', parent, url, token, ttlSeconds = 600, project } = {}) {
    this.server = (url || process.env.AGENTVIEWER_URL || 'http://127.0.0.1:4747').replace(/\/+$/, '');
    this.url = `${this.server}/api/report`;
    token = token || process.env.AGENTVIEWER_TOKEN;
    this.token = token;
    this.headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
    this.id = id || name;
    this.base = { id: this.id, name, client: client || name, channel: channel || client || name, door, ttl_seconds: ttlSeconds };
    if (parent) this.base.parent = parent;
    if (project) this.base.project = project;
    this.task = null;
  }

  send(body) {
    chain = chain
      .then(() => fetch(this.url, { method: 'POST', headers: this.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) }))
      .then((r) => r.body?.cancel?.())
      .catch(() => {});
    return chain;
  }

  update(state, detail, { task, path, tool, mcpServer } = {}) {
    if (task !== undefined) this.task = task;
    const body = { ...this.base, state: STATES.has(state) ? state : 'running' };
    if (this.task) body.task = this.task;
    if (detail !== undefined) body.detail = String(detail).slice(0, 300);
    if (path) body.path = path;
    if (tool) body.tool = tool;
    if (mcpServer) body.mcp_server = mcpServer;
    return this.send(body); // awaiting is optional; resolves once delivered (or dropped)
  }

  /** Report a step around an async function; failures are reported too. */
  async step(state, detail, fn, opts) {
    this.update(state, detail, opts);
    try {
      return await fn();
    } catch (err) {
      this.update('waiting', `오류: ${err?.message || err}`.slice(0, 300));
      throw err;
    }
  }

  done(detail = '완료') {
    return this.update('done', detail);
  }

  idle(detail = '대기 중') {
    return this.update('idle', detail);
  }

  child(name, opts = {}) {
    const { client, channel, door } = this.base;
    return new Reporter(name, { client, channel, door, url: this.server, token: this.token, id: `${this.id}-${name}`, ...opts, parent: this.id });
  }

  /** Leave the office (await on shutdown). */
  close(detail = '종료') {
    return this.send({ ...this.base, state: 'done', detail, finished: true });
  }
}

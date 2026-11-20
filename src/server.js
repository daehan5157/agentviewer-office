import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doorFor } from './channels.js';
import { STATES } from './classify.js';
import { oneLine } from './util.js';
import { cleanLook, slugify } from './look.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const VENDORS = new Set(['anthropic', 'openai', 'google', 'other']);

// on every response: never inside another site's frame (an invisible frame could trick the owner
// into clicking an approval), no MIME sniffing, and no token-bearing address leaked as a referrer
const SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** is the Host header a loopback name? (a loopback connection with another Host is DNS rebinding) */
export function localHost(req) {
  try {
    return LOCAL_HOSTS.has(new URL(`http://${req.headers.host || ''}`).hostname);
  } catch {
    return false;
  }
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  if (code >= 500 && body && typeof body === 'object' && !Buffer.isBuffer(body)) body = { error: '서버 오류' }; // no internal details
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Apply a report from the HTTP API / MCP bridge / CLI to the store. */
export function applyReport(store, body, defaults = {}) {
  const b = { ...defaults, ...body };
  const name = oneLine(b.name || b.agent || b.agent_name || 'agent', 60);
  const id = b.id ? `api:${slug(b.id)}` : `api:${slug(b.client || 'agent')}:${slug(name)}`;
  const now = Date.now();
  const state = STATES.includes(b.state) ? b.state : undefined;
  const exists = !!store.get(id);
  const parentId = b.parent ? (store.get(b.parent) ? b.parent : `api:${slug(b.parent)}`) : undefined;
  const channel = b.channel ? oneLine(b.channel, 30) : exists ? undefined : 'HTTP API';
  const path = b.path || b.tool_path || (b.tool ? `도구 › ${oneLine(b.tool, 40)}` : undefined);
  store.upsert(id, {
    name,
    client: b.client ? oneLine(b.client, 40) : exists ? undefined : 'Custom',
    vendor: VENDORS.has(b.vendor) ? b.vendor : exists ? undefined : 'other',
    via: b.via || (exists ? undefined : 'api'),
    channel,
    door: b.door ? doorFor(b.door) : channel ? doorFor(channel, b.via === 'mcp' ? 'mcp' : 'api') : undefined,
    parentId,
    project: b.project ? oneLine(b.project, 60) : undefined,
    cwd: b.cwd ? oneLine(b.cwd, 200) : undefined,
    model: b.model ? oneLine(b.model, 60) : undefined,
    task: b.task ? oneLine(b.task, 300) : undefined,
    detail: b.detail !== undefined ? oneLine(b.detail, 160) : undefined,
    path: path ? oneLine(path, 80) : undefined,
    state,
    lastActivity: now,
    ttlMs: Number.isFinite(b.ttl_seconds) ? Math.max(10, b.ttl_seconds) * 1000 : exists ? undefined : 10 * 60e3,
    finishedAt: b.finished ? now : undefined,
    sessionShort: exists ? undefined : slug(b.id || name).slice(0, 6),
  });
  if (b.task && b.task !== store.get(id)?._lastTask) {
    store.get(id)._lastTask = b.task;
    store.activity(id, { t: now, text: `작업: ${oneLine(b.task, 120)}`, path: b.via === 'mcp' ? 'MCP › agentviewer_report' : 'HTTP › /api/report', state: state || 'thinking' });
  }
  if (b.detail || state) store.activity(id, { t: now, text: oneLine(b.detail || state, 120), path: path || '', state: state || '' });
  if (b.mcp_server) store.pulse(id, oneLine(b.mcp_server, 40), oneLine(b.tool || '', 40), now);
  return id;
}

const COOKIE = 'av_token';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const CONTROL_HEADER = 'x-agentviewer-control';

/**
 * May this request drive agents (send prompts)? Only someone at this PC, never a share-link viewer:
 *  • the connection comes from loopback,
 *  • the Host is a loopback name (blocks DNS rebinding),
 *  • any Origin is a loopback page too, and a custom header is present — a page on another site
 *    can't add it without a CORS preflight, which this server never approves.
 */
export function canControl(req, needHeader = true) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  if (!localHost(req)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!LOCAL_HOSTS.has(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return !needHeader || req.headers[CONTROL_HEADER] === '1';
}

const COLLAB_COOKIE = 'av_collab';
const COLLAB_PER_MIN = 10;

/**
 * @param token          when set, /api/* needs it (Bearer header, x-agentviewer-token, ?t= / ?token=, or cookie)
 * @param trustLoopback  requests from this machine skip the token (share mode: local reporters keep working)
 * @param control        { sendPrompt(agent, text) } — lets the user at this PC hand an agent a task
 * @param collabToken    a second share token (link …/?c=…) whose holders may also drive the orchestrator:
 *                       hand it a task, read its screen and answer its on-screen choices (never other agents)
 */
export function createServer(store, { token = null, trustLoopback = false, control = null, collabToken = null, codes = null, look = null, themeWorker = null, log = () => {} } = {}) {
  const clients = new Set();
  let lastSnap = '';
  const broadcast = () => {
    const data = JSON.stringify(store.snapshot());
    if (data === lastSnap) return;
    lastSnap = data;
    for (const res of clients) res.write(`event: snapshot\ndata: ${data}\n\n`);
  };
  store.on('change', broadcast);
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 15000);
  heartbeat.unref();

  const queryToken = (url) => url.searchParams.get('t') || url.searchParams.get('token');
  const authed = (req, url) => {
    if (!token) return true;
    if (trustLoopback && LOOPBACK.has(req.socket.remoteAddress) && localHost(req)) return true;
    const h = req.headers.authorization || '';
    return (
      same(h, `Bearer ${token}`) || same(req.headers['x-agentviewer-token'], token) || same(queryToken(url), token) || same(cookieValue(req, COOKIE), token) ||
      isCollab(req)
    );
  };
  // a collaborator: holds the collab cookie (SameSite=Strict, so other sites can't ride it); for
  // actions also the custom header (forces a CORS preflight) and, if any, a same-origin Origin
  const isCollab = (req, action = false) => {
    if (!collabToken || !same(cookieValue(req, COLLAB_COOKIE), collabToken)) return false;
    if (!action) return true;
    if (req.headers[CONTROL_HEADER] !== '1') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  // sign-in with a short code: a 6-digit code can be guessed, so each address gets 5 tries per 10 minutes
  const failed = new Map(); // remote address → [times]
  const LOGIN_TRIES = 5;
  const LOGIN_WINDOW = 10 * 60e3;
  // …and all addresses together get 30, so many machines guessing at once still can't get far
  const LOGIN_TRIES_ALL = 30;
  let failedAll = [];
  const loginBlocked = (ip, now) => {
    const list = (failed.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW);
    failed.set(ip, list);
    failedAll = failedAll.filter((t) => now - t < LOGIN_WINDOW);
    if (failed.size > 1000) for (const [k, v] of failed) if (!v.length) failed.delete(k);
    return list.length >= LOGIN_TRIES || failedAll.length >= LOGIN_TRIES_ALL;
  };
  const readForm = async (req) => {
    let raw = '';
    for await (const c of req) {
      raw += c;
      if (raw.length > 2048) throw Object.assign(new Error('body too large'), { status: 413 });
    }
    return new URLSearchParams(raw);
  };
  const cookieHeader = (name, value) => `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
  const collabSent = [];
  const collabRateOk = (now) => {
    while (collabSent.length && now - collabSent[0] > 60e3) collabSent.shift();
    if (collabSent.length >= COLLAB_PER_MIN) return false;
    collabSent.push(now);
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    // without a token (not shared) only this PC's own pages may talk to it: a loopback connection
    // naming another host is a DNS-rebinding page trying to read the dashboard
    if (!token && LOOPBACK.has(req.socket.remoteAddress) && !localHost(req)) return send(res, 403, 'forbidden', 'text/plain');
    try {
      if (p.startsWith('/api/')) {
        if (!authed(req, url)) return send(res, 401, { error: 'token required' });
        if (req.method === 'GET' && p === '/api/state') return send(res, 200, store.snapshot());
        if (req.method === 'GET' && p === '/api/stream') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
          clients.add(res);
          req.on('close', () => clients.delete(res));
          return;
        }
        if (req.method === 'POST' && p === '/api/report') {
          const body = await readJson(req);
          const list = Array.isArray(body) ? body : [body];
          const ids = list.map((b) => applyReport(store, b));
          return send(res, 200, { ok: true, ids });
        }
        if (req.method === 'GET' && p === '/api/control') {
          const owner = !!control && canControl(req, false);
          const collab = !owner && !!control && isCollab(req);
          return send(res, 200, { canSend: owner || collab, canScreen: owner || collab, role: owner ? 'owner' : collab ? 'collab' : 'viewer' });
        }
        // how the office looks (theme + character looks); everyone sees it, only this PC changes it
        if (look && p === '/api/look/version' && req.method === 'GET') return send(res, 200, { version: look.version() });
        if (look && p === '/api/look' && req.method === 'GET') {
          const st = await look.state();
          const canEdit = canControl(req, false);
          return send(res, 200, {
            version: look.version(), theme: st.theme, themeData: await look.theme(st.theme), chars: st.chars,
            themes: await look.themes(), canEdit, canRequest: canEdit,
            engines: canEdit && themeWorker ? themeWorker.engines() : [],
            job: canEdit && themeWorker ? themeWorker.status() : null,
          });
        }
        if (look && p === '/api/look/job' && req.method === 'GET') {
          if (!canControl(req, false)) return send(res, 403, { error: '이 PC에서만 볼 수 있어요' });
          return send(res, 200, { job: themeWorker ? themeWorker.status() : null });
        }
        if (look && p === '/api/look' && req.method === 'PUT') {
          if (!canControl(req)) return send(res, 403, { error: '꾸미기는 이 PC에서만 바꿀 수 있어요' });
          const body = await readJson(req);
          const st = await look.state();
          if (typeof body.theme === 'string') {
            if (!(await look.theme(body.theme))) return send(res, 404, { error: '그런 테마가 없어요' });
            st.theme = slugify(body.theme);
          }
          if (body.chars && typeof body.chars === 'object') {
            for (const [name, l] of Object.entries(body.chars).slice(0, 200)) {
              const n = oneLine(name, 80);
              if (!n) continue;
              const c = l === null ? null : cleanLook(l);
              if (c) st.chars[n] = c;
              else delete st.chars[n];
            }
          }
          await look.save(st);
          return send(res, 200, { ok: true, version: look.version() });
        }
        if (look && p === '/api/look/request' && req.method === 'POST') {
          if (!canControl(req)) return send(res, 403, { error: '이 PC에서만 할 수 있어요' });
          // never typed into a running agent (it may be busy with other work): a separate one-off
          // worker makes it, or the user copies the prompt to an agent of their choosing
          const body = await readJson(req);
          const idea = oneLine(String(body.idea || ''), 60);
          if (!idea) return send(res, 400, { error: '어떤 테마인지 적어 주세요' });
          const engine = String(body.engine || '');
          if (!engine || engine === 'copy' || !themeWorker) return send(res, 200, { ok: true, started: false, prompt: look.themePrompt(idea) });
          try {
            return send(res, 200, { ok: true, started: true, job: themeWorker.start(idea, engine) });
          } catch (err) {
            return send(res, 409, { error: err.message });
          }
        }
        // the orchestrator's terminal screen (to read a question or approval), and answering one with a key
        const ctl = p.match(/^\/api\/agents\/([^/]+)\/(screen|key)$/);
        if (ctl && ((req.method === 'GET' && ctl[2] === 'screen') || (req.method === 'POST' && ctl[2] === 'key'))) {
          // reading the screen needs no custom header (a plain GET), so a cross-site page could trigger it but never read the answer
          const isKey = ctl[2] === 'key';
          const owner = !!control && canControl(req, isKey);
          const collab = !owner && !!control && isCollab(req, isKey);
          if (!owner && !collab) return send(res, 403, { error: '이 PC나 공동작업자 링크로만 할 수 있어요' });
          const id = decodeURIComponent(ctl[1]);
          const agent = store.get(id);
          if (!agent) return send(res, 404, { error: '에이전트를 찾을 수 없음' });
          if (!control.canPrompt(agent)) return send(res, 400, { error: 'Orca 오케스트레이터만 가능해요' });
          try {
            if (ctl[2] === 'screen') return send(res, 200, { ok: true, ...(await control.readScreen(agent)) });
            const body = await readJson(req);
            const key = body.key;
            if (!/^(esc|enter|[a-z0-9])$/.test(String(key || ''))) return send(res, 400, { error: '보낼 수 없는 키' });
            const r = await control.sendKey(agent, key);
            const from = collab ? oneLine(typeof body.from === 'string' ? body.from : '', 20) : '';
            const who = collab ? `공동작업자${from ? `(${from})` : ''}가` : '내가';
            store.activity(id, { t: Date.now(), text: `${who} 고른 답: ${key === 'esc' ? 'Esc' : key}`, path: collab ? 'Agentviewer › 공동작업자 승인 응답' : 'Agentviewer › 승인 응답', state: 'thinking' });
            if (collab) log(`key ${key} sent to ${id} by collaborator${from ? ` ${from}` : ''} (${req.socket.remoteAddress})`);
            return send(res, 200, { ok: true, ...r });
          } catch (err) {
            return send(res, 502, { error: err.message });
          }
        }
        if (req.method === 'POST' && /^\/api\/agents\/[^/]+\/prompt$/.test(p)) {
          const owner = !!control && canControl(req);
          const collab = !owner && !!control && isCollab(req, true);
          if (!owner && !collab) return send(res, 403, { error: '작업 보내기는 이 PC나 공동작업자 링크로만 할 수 있어요' });
          const id = decodeURIComponent(p.slice('/api/agents/'.length, -'/prompt'.length));
          const agent = store.get(id);
          if (!agent) return send(res, 404, { error: '에이전트를 찾을 수 없음' });
          if (!control.canPrompt(agent)) return send(res, 400, { error: '작업은 Orca 오케스트레이터에게만 보낼 수 있어요' });
          const body = await readJson(req);
          const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim() : '';
          if (!text) return send(res, 400, { error: '보낼 내용이 비어 있음' });
          if (text.length > 4000) return send(res, 413, { error: '4000자 이하로 보내 주세요' });
          const from = collab ? oneLine(typeof body.from === 'string' ? body.from : '', 20) : '';
          if (collab && !collabRateOk(Date.now())) return send(res, 429, { error: '잠시 후에 다시 보내 주세요 (1분에 10번까지)' });
          try {
            const r = await control.sendPrompt(agent, text);
            const who = collab ? `공동작업자${from ? `(${from})` : ''}` : '내가';
            store.activity(id, {
              t: Date.now(),
              text: `${who} 보낸 작업: ${oneLine(text, 120)}`,
              path: collab ? 'Agentviewer › 공동작업자 지시' : 'Agentviewer › 작업 지시',
              state: 'thinking',
            });
            log(`prompt sent to ${id}${collab ? ` by collaborator${from ? ` ${from}` : ''} (${req.socket.remoteAddress})` : ''}`);
            return send(res, 200, { ok: true, ...r });
          } catch (err) {
            return send(res, 502, { error: err.message });
          }
        }
        if (req.method === 'DELETE' && p.startsWith('/api/agents/')) {
          const id = decodeURIComponent(p.slice('/api/agents/'.length));
          const key = store.get(id) ? id : `api:${slug(id)}`;
          store.finish(key);
          return send(res, 200, { ok: true, id: key });
        }
        return send(res, 404, { error: 'not found' });
      }
      if (req.method === 'POST' && p === '/login' && codes && token) {
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        const back = (q) => {
          res.writeHead(303, { location: q ? `/?e=${q}` : '/', 'cache-control': 'no-store' });
          res.end();
        };
        if (loginBlocked(ip, now)) return back('wait');
        const code = String((await readForm(req)).get('code') || '').replace(/\D/g, '');
        const role = same(code, codes.collab) && collabToken ? 'collab' : same(code, codes.view) ? 'view' : null;
        if (!role) {
          failed.get(ip).push(now);
          failedAll.push(now);
          log(`wrong access code from ${ip}`);
          return back(loginBlocked(ip, now) ? 'wait' : 'bad');
        }
        failed.delete(ip);
        log(`signed in as ${role === 'collab' ? 'collaborator' : 'viewer'} from ${ip}`);
        res.writeHead(303, {
          'set-cookie': role === 'collab' ? cookieHeader(COLLAB_COOKIE, collabToken) : cookieHeader(COOKIE, token),
          location: '/',
          'cache-control': 'no-store',
        });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
      if (p === '/healthz') return send(res, 200, { ok: true });
      // share link (…/?t=TOKEN): remember the token in an HttpOnly cookie, then drop it from the address bar
      if (token && p === '/' && queryToken(url)) {
        if (!same(queryToken(url), token)) return send(res, 401, '링크의 토큰이 맞지 않습니다. 공유 링크를 다시 받아 주세요.', 'text/plain; charset=utf-8');
        res.writeHead(302, {
          'set-cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
          location: '/',
          'cache-control': 'no-store',
        });
        return res.end();
      }
      // collaborator link (…/?c=COLLAB): may watch and hand the orchestrator a task
      if (collabToken && p === '/' && url.searchParams.get('c')) {
        if (!same(url.searchParams.get('c'), collabToken)) return send(res, 401, '링크의 토큰이 맞지 않습니다. 공동작업자 링크를 다시 받아 주세요.', 'text/plain; charset=utf-8');
        res.writeHead(302, {
          'set-cookie': `${COLLAB_COOKIE}=${encodeURIComponent(collabToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
          location: '/',
          'cache-control': 'no-store',
        });
        return res.end();
      }
      // not signed in yet (no link cookie): the code page instead of a dashboard that can't load anything
      const needLogin = !!(codes && token && p === '/' && !authed(req, url));
      const rel = needLogin || p === '/login' ? 'login.html' : p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
      const file = path.resolve(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
      const data = await fsp.readFile(file).catch(() => null);
      if (!data) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (err) {
      log(`request error: ${err.message}`);
      return send(res, err.status || 500, { error: err.message });
    }
  });
  server.on('close', () => clearInterval(heartbeat));
  return server;
}

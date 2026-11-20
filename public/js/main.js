import { World } from './world.js';
import { Panel } from './panel.js';
import { ACTIVE, STATE, ago, clock, dur, esc } from './meta.js';
import { Composer, canPrompt } from './composer.js';
import { LookUI } from './lookui.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const token = params.get('t') || params.get('token');
const q = token ? `?t=${encodeURIComponent(token)}` : '';

const world = new World($('#world'));
const emptyEl = $('#empty'); // kept as a reference: it moves into the PiP window with the stage
const panel = new Panel($('#panel'), { onSelect: (id, fromPanel) => select(id, fromPanel) });
let snap = null;

// 🎨 theme + character looks (kept on the PC running Agentviewer; polled so every viewer follows)
const lookUI = new LookUI({ q, onLook: (l) => world.setLook(l), agents: () => snap?.agents || [] });
$('#lookBtn').addEventListener('click', () => lookUI.open());

// ---------- handing tasks to agents (this PC, or a collaborator link; plain share-link viewers just watch) ----------
let canSend = false;
let role = { canScreen: false, collab: false };
async function sendPrompt(agent, text, from = '') {
  const r = await fetch(`api/agents/${encodeURIComponent(agent.id)}/prompt${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agentviewer-control': '1' },
    body: JSON.stringify(from ? { text, from } : { text }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, started: j.started } : { ok: false, error: j.error || `오류 ${r.status}` };
}
const agentUrl = (agent, what) => `api/agents/${encodeURIComponent(agent.id)}/${what}${q}`;
const control = {
  send: sendPrompt,
  async screen(agent) {
    const r = await fetch(agentUrl(agent, 'screen'), { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { ok: false, error: j.error || `오류 ${r.status}` };
  },
  async key(agent, key, from = '') {
    const r = await fetch(agentUrl(agent, 'key'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentviewer-control': '1' },
      body: JSON.stringify(from ? { key, from } : { key }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: j.error || `오류 ${r.status}` };
  },
};
const composer = new Composer(document, control);
$('#panel').append(composer.el);
let pipComposer = null;
const agentById = (id) => (id && snap ? snap.agents.find((a) => a.id === id) : null);
let pipLeadBtn = null; // PiP: one click to the orchestrator's box (instead of finding it and double-clicking)
const leadAgent = () => snap?.agents.find((a) => canPrompt(a)) || null;
function updateComposers() {
  composer.update(canSend ? agentById(world.selected) : null);
  pipComposer?.update(canSend ? agentById(world.focusId) : null);
  if (pipLeadBtn) {
    const lead = canSend ? leadAgent() : null;
    pipLeadBtn.hidden = !lead || world.focusId === lead.id;
    if (lead) pipLeadBtn.textContent = `👑 ${lead.name}에 지시`;
  }
}
fetch(`api/control${q}`, { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {}))
  .then((j) => {
    canSend = !!j.canSend;
    role = { canScreen: !!j.canScreen, collab: j.role === 'collab' };
    composer.setRole(role);
    pipComposer?.setRole(role);
    updateComposers();
  })
  .catch(() => {});

function select(id, fromPanel = false) {
  world.selected = id;
  panel.select(id);
  if (id && fromPanel) world.center(id);
  updateComposers();
}
world.onSelect = (id) => select(id);

function stats() {
  if (!snap) return;
  const a = snap.agents;
  const n = (f) => a.filter(f).length;
  const working = n((x) => ACTIVE.has(x.state) && x.state !== 'waiting');
  const waiting = n((x) => x.state === 'waiting');
  const done = n((x) => x.state === 'done');
  const idle = n((x) => x.state === 'idle');
  $('#stats').innerHTML = `
    <span><b>${a.length}</b> 에이전트</span>
    <span class="s-work"><b>${working}</b> 작업 중</span>
    <span class="s-wait${waiting ? ' hot' : ''}"><b>${waiting}</b> 응답 대기</span>
    <span class="s-done"><b>${done}</b> 완료</span>
    <span class="s-idle"><b>${idle}</b> 휴식</span>
    <span class="s-mcp"><b>${snap.mcp.length}</b> MCP</span>`;
  document.title = waiting ? `(${waiting}) Agentviewer` : 'Agentviewer';
}

function scanStatus() {
  const el = $('#scanText');
  if (!snap) return;
  const offset = snap._offset || 0;
  const now = Date.now() - offset;
  const scanners = Object.values(snap.scanners).filter((s) => s.lastScan);
  const last = Math.max(0, ...scanners.map((s) => s.lastScan));
  const live = scanners.filter((s) => !s.error && s.enabled !== false).map((s) => s.name);
  const stale = now - last > 15000;
  $('#scan').classList.toggle('stale', stale || !connected);
  el.textContent = !connected ? '연결 끊김 · 재연결 중…' : `상시 스캔 중 · ${live.join(', ') || '대기'} · ${ago(now - last)}`;
}

let connected = false;
function connect() {
  const es = new EventSource(`api/stream${q}`);
  es.addEventListener('snapshot', (e) => {
    snap = JSON.parse(e.data);
    snap._offset = Date.now() - snap.now;
    connected = true;
    world.sync(snap);
    panel.update(snap);
    stats();
    renderPipDetail();
    updateComposers();
    emptyEl.hidden = snap.agents.length > 0;
  });
  es.onopen = () => {
    connected = true;
    scanStatus();
  };
  es.onerror = () => {
    connected = false;
    scanStatus();
  };
}
fetch(`api/state${q}`, { cache: 'no-store' })
  .then((r) => {
    if (r.status === 401) {
      const box = emptyEl;
      box.hidden = false;
      box.innerHTML = '<b>접속 토큰이 필요합니다</b><span>Agentviewer를 실행한 PC의 공유 링크(…/?t=…)로 접속하세요.<br>링크는 그 PC의 <code>~/.agentviewer/share-link.txt</code>에 있습니다.</span>';
      $('#scanText').textContent = '인증 필요';
      $('#scan').classList.add('stale');
      return;
    }
    connect();
  })
  .catch(() => connect());
setInterval(() => {
  scanStatus();
  if (snap) panel.render();
  renderPipDetail(); // keep the "⏱ for how long" ticking
}, 1000);

let last = performance.now();
let loopGen = 0; // bumped to restart the loop; a stale scheduled frame then does nothing
function frame(gen) {
  if (gen !== loopGen) return;
  // drive frames from the window that shows the canvas: a hidden/minimised tab stops its own
  // requestAnimationFrame, but the PiP window keeps running. Schedule first so one bad frame
  // can't stop the animation for good.
  (world.canvas.ownerDocument.defaultView || window).requestAnimationFrame(() => frame(gen));
  // always this page's clock: a PiP window's rAF timestamps count from when *it* opened
  const now = performance.now();
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  try {
    world.update(dt, now);
    world.draw(now);
    world.follow();
  } catch (err) {
    console.error(err);
  }
}
// (re)start drawing in whichever window shows the canvas now. Needed when the PiP window
// closes: the frame it had scheduled never fires, which used to leave the page blank.
function restartLoop() {
  const gen = ++loopGen;
  (world.canvas.ownerDocument.defaultView || window).requestAnimationFrame(() => frame(gen));
}
restartLoop();

window.addEventListener('resize', () => world.resize());
$('#zoomIn').addEventListener('click', () => world.setZoom(world.zoom >= 2 ? world.zoom + 1 : world.zoom + 0.25));
$('#zoomOut').addEventListener('click', () => world.setZoom(world.zoom > 2 ? world.zoom - 1 : world.zoom - 0.25));
$('#zoomFit').addEventListener('click', () => {
  world.autoZoom = true;
  world.resize();
});
const bubbles = $('#showBubbles');
try {
  bubbles.checked = localStorage.getItem('av.bubbles') !== '0';
} catch {}
world.showBubbles = bubbles.checked;
bubbles.addEventListener('change', () => {
  world.showBubbles = bubbles.checked;
  try {
    localStorage.setItem('av.bubbles', bubbles.checked ? '1' : '0');
  } catch {}
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') select(null);
});

// ---------- picture-in-picture: a small always-on-top window with the live office ----------
const pipBtn = $('#pip');
const stageEl = $('#stage');
let pipWin = null;
let pipVideo = null;
let pipDetail = null; // the close-up card inside the PiP window

// what the focused agent is doing, in more detail than the speech bubble
function renderPipDetail() {
  if (!pipDetail) return;
  const a = world.focusId && snap?.agents.find((x) => x.id === world.focusId);
  pipDetail.hidden = !a;
  if (!a) return;
  const now = Date.now() - (snap._offset || 0);
  const s = STATE[a.state] || STATE.idle;
  const meta = [
    `⏱ ${dur(now - a.stateSince)}`,
    a.model && `🧠 ${esc(a.model.replace(/^claude-/, ''))}`,
    a.branch && `⎇ ${esc(a.branch)}`,
    a.cwd && `📁 ${esc(a.cwd)}`,
  ].filter(Boolean).join(' · ');
  const todos = Array.isArray(a.todos) && a.todos.length
    ? `<div class="todos">${a.todos.map((t) => `<div class="todo ${esc(t.status)}">${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'} ${esc(t.content)}</div>`).join('')}</div>`
    : '';
  const log = (a.log || []).slice(0, 8) // newest first, like the side panel
    .map((l) => `<li><time>${clock(l.t)}</time><span>${l.path ? `<code>${esc(l.path)}</code>` : ''}${esc(l.text)}</span></li>`).join('');
  const scroll = pipDetail.scrollTop;
  pipDetail.innerHTML = `
    <div class="r1"><b class="nm">${esc(a.name)}</b><span class="pill" style="--c:${s.color}">${s.icon} ${s.label}</span><span class="mut">${esc(a.client)}${a.pid ? ` · PID ${a.pid}` : ''}</span></div>
    ${a.title ? `<div class="mut">${esc(a.title)}</div>` : ''}
    ${a.task ? `<div class="task">📌 ${esc(a.task)}</div>` : ''}
    <div class="now">${a.path ? `<code>${esc(a.path)}</code>` : ''}${esc(a.detail || '')}</div>
    <div class="mut">${meta}</div>
    ${todos}
    ${log ? `<ol>${log}</ol>` : ''}`;
  pipDetail.scrollTop = scroll;
}
world.onFocus = (id) => {
  if (id) select(id);
  renderPipDetail();
  updateComposers();
};

// Document PiP only exists on https:// or localhost. Opened by its LAN address (a share link), the
// page falls back to a small ordinary window: clickable like the PiP, but not kept on top.
async function openDocPip() {
  const docPip = 'documentPictureInPicture' in window;
  pipWin = docPip
    ? await window.documentPictureInPicture.requestWindow({ width: 640, height: 420 })
    : window.open('', 'agentviewer-mini', 'popup,width=640,height=420');
  if (!pipWin) throw new Error('창을 열 수 없음 (팝업 차단?)');
  const d = pipWin.document;
  if (!docPip) {
    d.head.replaceChildren(); // reused popup: start clean
    d.body.replaceChildren();
  }
  d.title = 'Agentviewer';
  const css = d.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('style.css', location.href).href;
  d.head.append(css);
  const st = d.createElement('style');
  // the canvas keeps margin:auto: centred when it fits, scrolled by world.follow() when magnified
  st.textContent = `html,body{height:100%;margin:0}body{display:block;position:relative}
#stage{width:100vw;height:100vh;padding:0;overflow:hidden}#stage canvas{border-radius:0}
.pip-hint{position:fixed;right:8px;top:6px;font-size:11px;color:#fff;background:rgba(20,16,30,.55);padding:2px 7px;border-radius:6px;pointer-events:none;transition:opacity .6s}
.pip-lead{position:fixed;left:8px;top:6px;font:600 12px system-ui,sans-serif;color:#fff;background:#5b3fd6;border:1px solid #f2c14e;border-radius:8px;padding:4px 10px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45)}.pip-lead:hover{background:#6d50ee}.pip-lead[hidden]{display:none}
.pip-bottom{position:fixed;left:8px;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 16px)}
.pip-bottom .composer{border:1px solid #3a3150;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.45);flex:none}
.pip-detail{min-height:0;flex:0 1 auto;max-height:52vh;overflow:auto;scrollbar-width:thin;background:rgba(24,19,36,.92);color:#ece8f4;border:1px solid #3a3150;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.45;box-shadow:0 8px 30px rgba(0,0,0,.45)}
.pip-detail .r1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pip-detail .nm{font-size:15px}
.pip-detail .pill{border:1px solid var(--c);color:var(--c);border-radius:99px;padding:0 8px;font-size:12px}
.pip-detail .mut{color:#a39cb6;font-size:12px}.pip-detail .task{margin-top:6px;font-weight:600}
.pip-detail .now{margin-top:4px}.pip-detail code{background:#332b48;border-radius:4px;padding:0 4px;margin-right:6px;font-size:12px}
.pip-detail .todos{margin-top:6px}.pip-detail .todo.completed{color:#a39cb6;text-decoration:line-through}.pip-detail .todo.in_progress{color:#f5c451}
.pip-detail ol{list-style:none;margin:6px 0 0;padding:0}.pip-detail li{display:flex;gap:6px;padding:2px 0;border-top:1px solid #2e2740}
.pip-detail time{color:#a39cb6;font-size:11px;flex:none;padding-top:2px}`;
  d.head.append(st);
  d.body.append(stageEl);
  pipDetail = d.createElement('div');
  pipDetail.className = 'pip-detail';
  pipDetail.hidden = true;
  pipComposer = new Composer(d, control);
  pipComposer.setRole(role);
  const bottom = d.createElement('div');
  bottom.className = 'pip-bottom';
  bottom.append(pipDetail, pipComposer.el);
  const hint = d.createElement('div');
  hint.className = 'pip-hint';
  hint.textContent = docPip ? '에이전트를 더블클릭하면 확대' : '에이전트를 더블클릭하면 확대 · 항상 위 고정은 이 주소에선 안 돼요';
  pipLeadBtn = d.createElement('button');
  pipLeadBtn.type = 'button';
  pipLeadBtn.className = 'pip-lead';
  pipLeadBtn.hidden = true;
  pipLeadBtn.addEventListener('click', () => {
    const lead = leadAgent();
    if (lead) world.focus(lead.id);
  });
  d.body.append(bottom, hint, pipLeadBtn);
  updateComposers();
  setTimeout(() => (hint.style.opacity = '0'), 4000);
  world.pip = true;
  world.resize();
  restartLoop(); // draw from the PiP window from now on (keeps going while this tab is hidden)
  pipWin.addEventListener('resize', () => world.resize());
  pipWin.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (world.focusId) world.focus(null);
    else select(null);
  });
  pipWin.addEventListener('pagehide', () => {
    $('main').prepend(stageEl);
    world.pip = false;
    world.focusId = null;
    world.pipZoom = 1;
    pipDetail = null;
    pipComposer?.showScreen(false); // stop polling its screen
    pipComposer = null;
    pipLeadBtn = null;
    restartLoop();
    updateComposers();
    pipWin = null;
    world.resize();
    pipBtn.classList.remove('on');
  });
  pipBtn.classList.add('on');
}

// fallback (Firefox/Safari): a video of the canvas — view only, no clicks
async function openVideoPip() {
  pipVideo = pipVideo || Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  pipVideo.srcObject = world.canvas.captureStream(30);
  await pipVideo.play();
  await pipVideo.requestPictureInPicture();
  pipBtn.classList.add('on');
  pipVideo.addEventListener('leavepictureinpicture', () => pipBtn.classList.remove('on'), { once: true });
}

{
  pipBtn.hidden = false;
  pipBtn.addEventListener('click', async () => {
    try {
      if (pipWin) return pipWin.close();
      if (document.pictureInPictureElement) return document.exitPictureInPicture();
      try {
        return await openDocPip(); // the PiP, or (no https/localhost) a small clickable window
      } catch (err) {
        pipWin = null; // embedded browsers may refuse new windows → fall back to the video PiP
        console.warn('PiP 창 불가, 영상 PiP로 대체', err);
      }
      if (!(document.pictureInPictureEnabled && world.canvas.captureStream)) return;
      await openVideoPip();
    } catch (err) {
      console.error('PiP 실패', err);
    }
  });
}

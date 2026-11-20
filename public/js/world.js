// The office: layout, characters walking between doors / desks / lounge,
// desk monitors that show what each agent is doing, MCP racks and packets.
import { T, buildLayout, findPath } from './office.js';
import { SW, SH, makeSprites, paletteFor, leadPalette, lookPalette, drawLeadFx } from './sprites.js';

const isLead = (a) => !!a.orca?.lead; // Orca orchestrator
// 🎨 꾸미기: per-name looks and the theme's outfit (set by World.setLook)
let LOOK = { chars: {}, outfit: null };
const lookOf = (a) => {
  const own = LOOK.chars[a.name];
  return own || LOOK.outfit ? { ...(LOOK.outfit || {}), ...(own || {}) } : null;
};
import { STATE, DOOR, DOORS, hash, mcpServerOf } from './meta.js';
import { renderBackground, drawWall, drawDesk, drawChair, drawRack, drawFurniture, drawNight, stateRgba, isNight } from './decor.js';

const SPEED = 3.4; // tiles / second
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';
const CAT = [
  { key: 'active', color: '#5aa9ff', test: (s) => !['waiting', 'done', 'idle'].includes(s) },
  { key: 'waiting', color: '#ff5c5c', test: (s) => s === 'waiting' },
  { key: 'done', color: '#8bd17c', test: (s) => s === 'done' },
  { key: 'idle', color: '#8a8f98', test: (s) => s === 'idle' },
];

class Char {
  constructor(agent) {
    this.id = agent.id;
    this.agent = agent;
    this.dress(agent);
    this.x = 0;
    this.y = 0;
    this.path = [];
    this.goal = null;
    this.pose = 'stand';
    this.dir = 'down';
    this.walkT = 0;
    this.animT = Math.random() * 10;
    this.alpha = 1;
    this.leaving = false;
    this.gone = false;
    this.pop = 0;
    this.slot = -1;
    this.lounge = null;
    this.exit = null;
    this.restT = 0;
  }

  /** (Re)build the sprites; the orchestrator keeps its royal outfit (and crown), others wear their look. */
  dress(agent) {
    this.lead = isLead(agent);
    const look = this.lead ? null : lookOf(agent);
    this.lookKey = `${this.lead}:${agent.name}:${JSON.stringify(look)}`;
    this.sprites = this.lead
      ? makeSprites(leadPalette(agent.id), true)
      : makeSprites(lookPalette(paletteFor(agent.id, agent.vendor, agent.parentId), look), false, look?.accessory);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.low = document.createElement('canvas');
    this.g = this.low.getContext('2d');
    this.chars = new Map();
    this.rackOf = new Map();
    this.packets = [];
    this.flash = new Map();
    this.seenPulses = new Set();
    this.lastEmit = new Map();
    this.selected = null;
    this.hover = null;
    this.showBubbles = true;
    this.zoom = 2;
    this.autoZoom = true;
    this.dpr = 1;
    this.first = true;
    this.snap = null;
    this.bg = null;
    this.bgKey = '';
    this.onSelect = () => {};
    this.layout = buildLayout(8, 3);
    this.pip = false;
    this.pipZoom = 1; // PiP only: 1 = whole office, >1 = close-up that follows `focusId`
    this.focusId = null;
    this.onFocus = () => {};
    // PiP: double-click an agent to follow it up close, double-click again (or empty floor) to zoom out
    canvas.addEventListener('dblclick', (e) => {
      if (!this.pip) return;
      const c = this.pick(e);
      this.focus(c && c.id !== this.focusId ? c.id : null);
    });
    canvas.addEventListener('click', (e) => {
      const c = this.pick(e);
      this.onSelect(c ? c.id : null);
    });
    canvas.addEventListener('mousemove', (e) => {
      const c = this.pick(e);
      this.hover = c ? c.id : null;
      canvas.style.cursor = c ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
    });
    this.resize();
  }

  // ---------- state sync ----------

  sync(snap) {
    this.snap = snap;
    const ids = new Set(snap.agents.map((a) => a.id));
    const L0 = this.layout;
    for (const name of [...this.rackOf.keys()]) if (!snap.mcp.some((m) => m.name === name)) this.rackOf.delete(name);
    for (const m of [...snap.mcp].sort((a, b) => b.calls - a.calls)) {
      if (this.rackOf.has(m.name)) continue;
      const used = new Set(this.rackOf.values());
      let k = 0;
      while (used.has(k)) k++;
      this.rackOf.set(m.name, k);
    }
    const needSlots = new Set([...this.chars.keys(), ...ids]).size;
    const needRacks = Math.max(0, ...this.rackOf.values()) + 1;
    if (needSlots > L0.slots.length || needRacks > L0.racks.length) this.relayout(needSlots + 3, needRacks);

    const sorted = [...snap.agents].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    for (const a of sorted) {
      let c = this.chars.get(a.id);
      if (!c) c = this.spawn(a);
      else if (c.leaving) {
        c.leaving = false;
        c.gone = false;
        c.alpha = 1;
        c.goal = null;
      }
      c.agent = a;
      if (c.lookKey !== `${isLead(a)}:${a.name}:${JSON.stringify(isLead(a) ? null : lookOf(a))}`) c.dress(a);
    }
    for (const c of this.chars.values()) if (!ids.has(c.id) && !c.leaving) this.depart(c);

    for (const p of snap.pulses) {
      if (this.seenPulses.has(p.id)) continue;
      this.seenPulses.add(p.id);
      if (!this.first && snap.now - p.t < 6000) this.launchPacket(p.from, p.server);
    }
    if (this.seenPulses.size > 500) this.seenPulses = new Set([...this.seenPulses].slice(-200));
    this.first = false;
  }

  /** 🎨 a new theme / character looks: repaint the background and re-dress everyone */
  setLook({ theme = null, chars = {}, version = '' } = {}) {
    LOOK = { chars: chars || {}, outfit: theme?.outfit || null };
    this.theme = theme;
    this.lookVersion = version;
    this.bg = null;
    for (const c of this.chars.values()) c.dress(c.agent);
  }

  relayout(nSlots, nRacks) {
    this.layout = buildLayout(nSlots, nRacks);
    this.bg = null;
    for (const c of this.chars.values()) {
      c.lounge = null;
      c.goal = null;
      c.path = [];
      const goal = this.goalFor(c);
      c.x = goal.x;
      c.y = goal.y;
    }
    this.resize();
  }

  allocSlot(agent) {
    const L = this.layout;
    const used = new Set([...this.chars.values()].map((c) => c.slot));
    const free = L.slots.filter((s) => !used.has(s.i));
    if (!free.length) return 0;
    const near = agent.parentId || agent.leadId;
    const parent = near && this.chars.get(near);
    if (parent && parent.slot >= 0) {
      const ps = L.slots[parent.slot];
      const d = (s) => Math.abs(s.c - ps.c) + Math.abs(s.r - ps.r) * 1.5 + s.i * 0.001;
      free.sort((a, b) => d(a) - d(b));
    } else {
      // top-level agents take every other column first so their sub-agents can sit next to them
      free.sort((a, b) => (a.c % 2) - (b.c % 2) || a.i - b.i);
    }
    return free[0].i;
  }

  allocLounge(c) {
    const L = this.layout;
    const used = new Set([...this.chars.values()].filter((o) => o !== c && o.lounge).map((o) => `${o.lounge.x},${o.lounge.y}`));
    const spot = L.lounge.find((p) => !used.has(`${p.x},${p.y}`));
    if (spot) return { ...spot };
    for (let i = 0; i < 60; i++) {
      const x = L.sx + (hash(`${c.id}x${i}`) % 7);
      const y = L.ly + 1 + (hash(`${c.id}y${i}`) % 4);
      if (y < L.wallY && !L.block[y][x] && !used.has(`${x},${y}`)) return { x, y, pose: 'stand', dir: 'down' };
    }
    return { x: L.sx + 4, y: L.ly + 1, pose: 'stand', dir: 'down' };
  }

  goalFor(c) {
    if (c.leaving && c.exit) return c.exit;
    const a = c.agent;
    if (a.state === 'idle') {
      if (!c.lounge) c.lounge = this.allocLounge(c);
      return c.lounge;
    }
    c.lounge = null;
    const s = this.layout.slots[c.slot] || this.layout.slots[0];
    return { x: s.seat.x, y: s.seat.y, pose: 'sit' };
  }

  spawn(a) {
    const L = this.layout;
    const c = new Char(a);
    c.slot = this.allocSlot(a);
    this.chars.set(a.id, c);
    const goal = this.goalFor(c);
    const parent = a.parentId && this.chars.get(a.parentId);
    if (this.first) {
      c.x = goal.x;
      c.y = goal.y;
    } else if (parent) {
      const ps = L.slots[parent.slot];
      c.x = ps ? ps.side.x : Math.round(parent.x);
      c.y = ps ? ps.side.y : Math.round(parent.y);
      c.pop = 1;
    } else {
      const d = L.doors[a.door] || L.doors.cli;
      c.x = d.out.x;
      c.y = d.out.y;
    }
    return c;
  }

  depart(c) {
    const L = this.layout;
    c.leaving = true;
    c.lounge = null;
    c.goal = null;
    const p = c.agent.parentId && this.chars.get(c.agent.parentId);
    if (p && !p.leaving && L.slots[p.slot]) {
      const ps = L.slots[p.slot];
      c.exit = { x: ps.side.x, y: ps.side.y, pose: 'exit' };
    } else {
      const d = L.doors[c.agent.door] || L.doors.cli;
      c.exit = { x: d.out.x, y: d.out.y, pose: 'exit' };
    }
  }

  launchPacket(fromId, server) {
    const c = this.chars.get(fromId);
    const k = this.rackOf.get(server);
    const r = k === undefined ? null : this.layout.racks[k];
    if (!c || !r) return;
    const from = this.anchor(c);
    const to = { x: r.x * T + 8, y: r.y * T - 6 };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    this.packets.push({ from, to, t0: performance.now(), dur: 500 + dist * 2.2, server });
  }

  /** World-pixel point of a character's monitor (seated) or head. */
  anchor(c) {
    const s = this.layout.slots[c.slot];
    if (c.pose === 'sit' && s) return { x: (s.x0 + 2) * T, y: s.y0 * T - 6 };
    const { px, py } = this.drawPos(c);
    return { x: px + SW / 2, y: py };
  }

  // ---------- simulation ----------

  update(dt, now) {
    for (const c of [...this.chars.values()]) {
      c.animT += dt;
      if (c.pop > 0) c.pop = Math.max(0, c.pop - dt * 1.4);
      if (c.gone) {
        c.alpha -= dt * 3;
        if (c.alpha <= 0) {
          this.chars.delete(c.id);
          this.lastEmit.delete(c.id);
        }
        continue;
      }
      const goal = this.goalFor(c);
      if (!c.goal || c.goal.x !== goal.x || c.goal.y !== goal.y) {
        c.goal = goal;
        const p = findPath(this.layout, Math.round(c.x), Math.round(c.y), goal.x, goal.y);
        if (p === null) {
          c.x = goal.x;
          c.y = goal.y;
          c.path = [];
        } else c.path = p;
      }
      if (c.path.length) {
        const n = c.path[0];
        const dx = n.x - c.x;
        const dy = n.y - c.y;
        const d = Math.hypot(dx, dy);
        const step = SPEED * dt;
        if (d > 0.01) c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (d <= step) {
          c.x = n.x;
          c.y = n.y;
          c.path.shift();
        } else {
          c.x += (dx / d) * step;
          c.y += (dy / d) * step;
        }
        c.pose = 'walk';
        c.walkT += dt;
        c.restT = 0;
      } else {
        if (c.pose !== goal.pose) c.restT = 0;
        c.restT += dt;
        c.pose = goal.pose;
        if (goal.pose === 'sit') c.dir = 'up';
        else if (goal.dir) c.dir = goal.dir;
        if (goal.pose === 'exit') c.gone = true;
      }
      const a = c.agent;
      if (!c.leaving && a.state === 'mcp' && c.pose === 'sit') {
        const server = mcpServerOf(a.path);
        if (server && now - (this.lastEmit.get(c.id) || 0) > 1100) {
          this.lastEmit.set(c.id, now);
          this.launchPacket(c.id, server);
        }
      }
    }
    this.packets = this.packets.filter((p) => {
      if (performance.now() - p.t0 >= p.dur) {
        this.flash.set(p.server, performance.now() + 450);
        return false;
      }
      return true;
    });
  }

  // ---------- drawing ----------

  resize() {
    const L = this.layout;
    const wpx = L.w * T;
    const hpx = L.h * T;
    const stage = this.canvas.parentElement;
    const win = this.canvas.ownerDocument.defaultView || window; // the PiP window once the canvas moves there
    if (this.pip && stage) {
      // picture-in-picture: always show the whole office, whatever the window size
      const fit = Math.max(0.25, Math.min(stage.clientWidth / wpx, stage.clientHeight / hpx));
      this.zoom = fit * this.pipZoom;
    } else if (this.autoZoom && stage) {
      const availW = Math.max(200, stage.clientWidth - 24);
      const availH = Math.max(200, stage.clientHeight - 24);
      const narrow = win.matchMedia('(max-width: 900px)').matches;
      let z = narrow ? Math.min(2, availW / wpx) : Math.min(availW / wpx, availH / hpx);
      z = z >= 2 ? Math.floor(z) : Math.max(narrow ? 1.25 : 0.75, Math.floor(z * 4) / 4);
      this.zoom = Math.min(z, 4);
    }
    this.dpr = win.devicePixelRatio || 1;
    this.low.width = wpx;
    this.low.height = hpx;
    const S = this.zoom * this.dpr;
    this.canvas.width = Math.round(wpx * S);
    this.canvas.height = Math.round(hpx * S);
    this.canvas.style.width = `${wpx * this.zoom}px`;
    this.canvas.style.height = `${hpx * this.zoom}px`;
  }

  // PiP close-up: magnify and keep the agent centred (null = whole office again)
  focus(id) {
    this.focusId = id && this.chars.has(id) ? id : null;
    this.pipZoom = this.focusId ? 3 : 1;
    this.resize();
    this.follow();
    this.onFocus(this.focusId);
  }

  // called every frame: characters walk, so the camera keeps up with them
  follow() {
    const stage = this.canvas.parentElement;
    if (!this.pip || !stage) return;
    if (!this.focusId) return;
    const c = this.chars.get(this.focusId);
    if (!c) return this.focus(null); // the agent left the office
    const { px, py } = this.drawPos(c);
    // keep the agent in the upper part: the detail card covers the bottom of the window
    stage.scrollLeft = (px + SW / 2) * this.zoom - stage.clientWidth / 2;
    stage.scrollTop = (py + SH / 2) * this.zoom - stage.clientHeight * 0.25;
  }

  setZoom(z) {
    this.autoZoom = false;
    this.zoom = Math.max(0.75, Math.min(5, z));
    this.resize();
  }

  draw(now) {
    const L = this.layout;
    const g = this.g;
    const hour = new Date().getHours();
    const night = isNight(hour);
    const key = `${L.w}x${L.h}:${hour}:${this.lookVersion || ''}`;
    if (!this.bg || this.bgKey !== key) {
      this.bg = renderBackground(L, hour, this.theme);
      this.bgKey = key;
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.bg, 0, 0);
    const live = [...this.chars.values()].filter((c) => !c.leaving);
    drawWall(g, L, CAT.map((k) => live.filter((c) => k.test(c.agent.state)).length), now);

    const seated = new Map();
    for (const c of this.chars.values()) if (c.pose === 'sit' && !c.path.length) seated.set(c.slot, c);
    const occupant = new Map();
    for (const c of live) occupant.set(c.slot, c);

    const items = [];
    const ws = this.theme?.workstation || null; // a theme's own desk / chair
    for (const s of L.slots) {
      items.push({ y: (s.y0 + 1) * T, f: () => drawDesk(g, s, occupant.get(s.i), seated.has(s.i), now, night, ws) });
      if (!seated.has(s.i)) items.push({ y: (s.y0 + 2) * T - 3, f: () => drawChair(g, s, false, ws) });
    }
    const rackNames = new Map([...this.rackOf].map(([n, k]) => [k, n]));
    const pnow = performance.now();
    L.racks.forEach((r, k) => {
      const name = rackNames.get(k);
      const m = name && this.snap?.mcp.find((x) => x.name === name);
      items.push({ y: (r.y + 1) * T, f: () => drawRack(g, r, name, m, now, (this.flash.get(name) || 0) > pnow) });
    });
    for (const f of L.furniture) items.push({ y: f.kind === 'rug' ? -1e6 : (f.y + 1) * T - (f.kind === 'sofa' ? 6 : 0), f: () => drawFurniture(g, f, now) });
    for (const c of this.chars.values()) {
      const { py } = this.drawPos(c);
      items.push({ y: py + SH + (c.pose === 'sit' ? 2 : 0), f: () => this.drawChar(g, c, now) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    if (night) {
      const glows = [];
      for (const s of L.slots) {
        const c = seated.get(s.i);
        const cx = (s.x0 + 2) * T;
        if (c) glows.push({ x: cx - 12, y: s.y0 * T - 13, w: 24, h: 18, a: 0.12, color: stateRgba(c.agent.state) });
        if (s.seed % 4 === 2) glows.push({ x: cx - 24, y: s.y0 * T - 4, w: 14, h: 12, a: 0.11, color: 'rgba(255,214,140,ALPHA)' });
      }
      L.racks.forEach((r, k) => {
        if (rackNames.has(k)) glows.push({ x: r.x * T, y: r.y * T - 12, w: 16, h: 28, a: 0.08, color: 'rgba(89,240,138,ALPHA)' });
      });
      const vend = L.furniture.find((f) => f.kind === 'vending');
      if (vend) glows.push({ x: vend.x * T, y: vend.y * T - 10, w: 16, h: 24, a: 0.12, color: 'rgba(255,120,120,ALPHA)' });
      drawNight(g, L, glows);
    }
    this.drawPackets(g, now);

    const ctx = this.ctx;
    const S = this.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.low, 0, 0, this.low.width * S, this.low.height * S);
    this.drawOverlays(ctx, S, now);
  }

  drawPos(c) {
    let px = c.x * T + (T - SW) / 2;
    let py = (c.y + 1) * T - SH;
    if (c.pose === 'sit' && !c.path.length) {
      px += 8;
      py -= 2;
    } else if (c.pose === 'sofa' && !c.path.length) py -= 2;
    return { px: Math.round(px), py: Math.round(py) };
  }

  frameFor(c, set) {
    const s = c.agent.state;
    const dirKey = { down: 'front', up: 'back', left: 'left', right: 'right' }[c.dir] || 'front';
    if (c.pose === 'walk') return { img: set[dirKey][[1, 0, 2, 0][Math.floor(c.walkT * 8) % 4]], oy: 0 };
    if (c.pose === 'sit') {
      const t = c.animT;
      if (s === 'typing') return { img: Math.floor(t * 7) % 2 ? set.sitA : set.sitB, oy: 0 };
      if (s === 'running' || s === 'mcp') return { img: Math.floor(t * 2.5) % 2 ? set.sitA : set.sitB, oy: 0 };
      if (s === 'reading' || s === 'web') return { img: set.sitA, oy: Math.floor(t * 1.2) % 2 };
      if (s === 'thinking' || s === 'planning' || s === 'delegating') return { img: set.sitB, oy: Math.floor(t * 1.6) % 2 ? -1 : 0 };
      if (s === 'waiting') return { img: set.sitA, oy: Math.floor(t * 4) % 2 ? -1 : 0 };
      return { img: set.sitA, oy: 1 };
    }
    if (c.pose === 'sofa') return { img: c.restT > 3 ? set.sleep : set.sofa, oy: 0 };
    return { img: set[dirKey][0], oy: c.pose === 'stand' && c.restT > 2 ? (Math.floor(c.animT * 0.8) % 2) * -1 * 0 : 0 };
  }

  drawChar(g, c, now) {
    const { px, py } = this.drawPos(c);
    const hi = this.selected === c.id || this.hover === c.id;
    const set = hi ? c.sprites.hi : c.sprites.normal;
    const { img, oy } = this.frameFor(c, set);
    g.globalAlpha = Math.max(0, c.alpha);
    if (c.pose !== 'sit' && c.pose !== 'sofa') {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(px + 3, py + SH - 2, 8, 2);
    }
    const sitting = (c.pose === 'sit' && !c.path.length) || c.pose === 'sofa';
    const fx = c.lead && { sitting, side: set.right.includes(img) || set.left.includes(img) };
    if (fx) drawLeadFx(g, px, py + oy, now, { ...fx, layer: 'floor' });
    const ws = this.theme?.workstation || null;
    const seatedAt = c.pose === 'sit' && !c.path.length ? this.layout.slots[c.slot] : null;
    if (seatedAt) drawChair(g, seatedAt, 'under', ws); // a theme chair sits under the agent
    g.drawImage(img, px, py + oy);
    if (seatedAt) drawChair(g, seatedAt, true, ws);
    if (fx) drawLeadFx(g, px, py + oy, now, { ...fx, layer: 'top' });
    if (c.pop > 0) {
      g.fillStyle = `rgba(255,214,102,${c.pop})`;
      const r = Math.round((1 - c.pop) * 10) + 3;
      const cx = px + SW / 2;
      const cy = py + SH / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 2, 2);
      }
    }
    g.globalAlpha = 1;
    void now;
  }

  drawPackets(g, now) {
    const t = performance.now();
    for (const p of this.packets) {
      const k = Math.min(1, (t - p.t0) / p.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const arc = Math.sin(Math.PI * e) * 14;
      const x = p.from.x + (p.to.x - p.from.x) * e;
      const y = p.from.y + (p.to.y - p.from.y) * e - arc;
      for (let i = 1; i <= 3; i++) {
        const e2 = Math.max(0, e - i * 0.04);
        const x2 = p.from.x + (p.to.x - p.from.x) * e2;
        const y2 = p.from.y + (p.to.y - p.from.y) * e2 - Math.sin(Math.PI * e2) * 14;
        g.fillStyle = `rgba(255,122,217,${0.5 - i * 0.12})`;
        g.fillRect(Math.round(x2), Math.round(y2), 2, 2);
      }
      g.fillStyle = '#ffd6f4';
      g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
      g.fillStyle = '#ff7ad9';
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    void now;
  }

  // ---------- hi-res overlays (text) ----------

  font(size, weight = 600) {
    const s = Math.max(9, Math.round(size * Math.min(1.35, Math.max(0.85, this.zoom / 2)))) * this.dpr;
    return { css: `${weight} ${s}px ${FONT}`, px: s };
  }

  fitText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, lo)}…`;
  }

  drawOverlays(ctx, S, now) {
    const L = this.layout;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // door labels
    let f = this.font(9.5, 700);
    ctx.font = f.css;
    for (const d of DOORS) {
      const door = L.doors[d];
      const busy = [...this.chars.values()].filter((c) => !c.leaving && c.agent.door === d).length;
      const label = busy ? `${DOOR[d].label} ${busy}` : DOOR[d].label;
      const x = (door.out.x * T + 8) * S;
      const y = (door.out.y * T + 8) * S;
      const w = ctx.measureText(label).width + 10 * this.dpr;
      ctx.fillStyle = 'rgba(20,16,30,0.85)';
      roundRect(ctx, x - w / 2, y - f.px * 0.75, w, f.px * 1.5, 4 * this.dpr);
      ctx.fill();
      ctx.fillStyle = DOOR[d].color;
      ctx.fillText(label, x, y + 0.5);
    }
    // zone labels
    f = this.font(9, 700);
    ctx.font = f.css;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#59f08a';
    ctx.fillText('MCP', (L.sx * T + 7) * S, 10.5 * S);
    ctx.fillStyle = '#4a3f55';
    ctx.fillText('서버실', (L.sx * T + 34) * S, 10.5 * S);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.textAlign = 'center';
    ctx.fillText('라운지', (L.sx + 2) * T * S, (L.ly * T + 7) * S);
    // rack labels
    ctx.textAlign = 'center';
    f = this.font(8.5, 600);
    ctx.font = f.css;
    for (const [name, k] of this.rackOf) {
      const r = L.racks[k];
      if (!r) continue;
      const m = this.snap?.mcp.find((s) => s.name === name);
      const x = (r.x * T + 8) * S;
      const y = (r.y * T + 16 + 6) * S;
      const text = this.fitText(ctx, name, 2 * T * S - 4 * this.dpr);
      const w = ctx.measureText(text).width + 8 * this.dpr;
      ctx.fillStyle = 'rgba(15,12,24,0.8)';
      roundRect(ctx, x - w / 2, y - f.px * 0.7, w, f.px * 1.4, 3 * this.dpr);
      ctx.fill();
      ctx.fillStyle = m?.live ? '#9df5b8' : '#d0c8dc';
      ctx.fillText(text, x, y + 0.5);
    }

    const chars = [...this.chars.values()].filter((c) => c.alpha > 0.05).sort((a, b) => a.y - b.y);
    // name tags
    f = this.font(9.5, 600);
    ctx.font = f.css;
    for (const c of chars) {
      const { px, py } = this.drawPos(c);
      const a = c.agent;
      const x = (px + SW / 2) * S;
      const y = (py + SH + (c.pose === 'sit' && !c.path.length ? -1 : 3)) * S + f.px * 0.7;
      const mark = c.lead ? '👑 ' : `${a.parentId || a.leadId ? '↳ ' : ''}${a.orchestrator === 'Orca' ? '🐋 ' : ''}`;
      const label = this.fitText(ctx, `${mark}${a.name}`, 3.6 * T * S);
      const w = ctx.measureText(label).width + 14 * this.dpr;
      const sel = this.selected === c.id;
      ctx.globalAlpha = Math.max(0, c.alpha);
      ctx.fillStyle = sel ? 'rgba(255,224,102,0.95)' : c.lead ? 'rgba(91,63,214,0.95)' : 'rgba(20,16,30,0.82)';
      roundRect(ctx, x - w / 2, y - f.px * 0.72, w, f.px * 1.44, 4 * this.dpr);
      ctx.fill();
      ctx.fillStyle = DOOR[a.door]?.color || '#9aa0aa';
      roundRect(ctx, x - w / 2 + 3 * this.dpr, y - f.px * 0.35, 4 * this.dpr, f.px * 0.7, 2 * this.dpr);
      ctx.fill();
      ctx.fillStyle = sel ? '#1b1726' : '#ffffff';
      ctx.fillText(label, x + 3 * this.dpr, y + 0.5);
      ctx.globalAlpha = 1;
    }
    // bubbles
    f = this.font(10, 600);
    for (const c of chars) {
      if (c.leaving) continue;
      const a = c.agent;
      const st = STATE[a.state] || STATE.idle;
      const focus = this.selected === c.id || this.hover === c.id;
      const lounging = a.state === 'idle';
      if (!this.showBubbles && !focus && a.state !== 'waiting') continue;
      let anchor;
      const s = this.layout.slots[c.slot];
      if (c.pose === 'sit' && !c.path.length && s) anchor = { x: (s.x0 + 2) * T, y: s.y0 * T - 12 };
      else {
        const { px, py } = this.drawPos(c);
        anchor = { x: px + SW / 2, y: py - 1 };
      }
      const ax = anchor.x * S;
      const ay = anchor.y * S;
      let text = lounging && !focus ? st.icon : `${st.icon} ${a.detail || st.label}`;
      const maxW = (focus ? 9 : 3.75) * T * S;
      ctx.font = f.css;
      text = this.fitText(ctx, text, maxW - 12 * this.dpr);
      const lines = [text];
      if (focus && a.task) {
        ctx.font = this.font(9, 500).css;
        lines.push(this.fitText(ctx, `📌 ${a.task}`, maxW - 12 * this.dpr));
      }
      ctx.font = f.css;
      const w0 = ctx.measureText(lines[0]).width;
      ctx.font = this.font(9, 500).css;
      const w1 = lines[1] ? ctx.measureText(lines[1]).width : 0;
      const w = Math.max(w0, w1) + 12 * this.dpr;
      const lh = f.px * 1.3;
      const h = lines.length * lh + 6 * this.dpr;
      const bx = Math.max(2, Math.min(this.canvas.width - w - 2, ax - w / 2));
      const by = ay - h - 5 * this.dpr;
      const blink = a.state === 'waiting' && Math.floor(now / 450) % 2;
      ctx.fillStyle = blink ? '#ffe3e3' : '#fffdf7';
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2 * this.dpr;
      roundRect(ctx, bx, by, w, h, 6 * this.dpr);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax - 4 * this.dpr, by + h - 1);
      ctx.lineTo(ax, by + h + 5 * this.dpr);
      ctx.lineTo(ax + 4 * this.dpr, by + h - 1);
      ctx.closePath();
      ctx.fillStyle = blink ? '#ffe3e3' : '#fffdf7';
      ctx.fill();
      ctx.strokeStyle = st.color;
      ctx.stroke();
      ctx.fillStyle = blink ? '#ffe3e3' : '#fffdf7';
      ctx.fillRect(ax - 3 * this.dpr, by + h - 2 * this.dpr, 6 * this.dpr, 3 * this.dpr);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#1b1726';
      ctx.font = f.css;
      ctx.fillText(lines[0], bx + 6 * this.dpr, by + 3 * this.dpr + lh / 2);
      if (lines[1]) {
        ctx.font = this.font(9, 500).css;
        ctx.fillStyle = '#5b556a';
        ctx.fillText(lines[1], bx + 6 * this.dpr, by + 3 * this.dpr + lh * 1.5);
      }
      ctx.textAlign = 'center';
    }
  }

  // ---------- input ----------

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const wx = ((e.clientX - r.left) / r.width) * this.low.width;
    const wy = ((e.clientY - r.top) / r.height) * this.low.height;
    let best = null;
    let bestY = -Infinity;
    for (const c of this.chars.values()) {
      if (c.gone) continue;
      const { px, py } = this.drawPos(c);
      if (wx >= px && wx < px + SW && wy >= py - 2 && wy < py + SH + 6 && py > bestY) {
        best = c;
        bestY = py;
      }
    }
    if (best) return best;
    for (const c of this.chars.values()) {
      const s = this.layout.slots[c.slot];
      if (!s || c.leaving || c.pose !== 'sit') continue;
      const dx = (s.x0 + 2) * T;
      const dy = s.y0 * T;
      if (Math.abs(wx - dx) < 26 && wy >= dy - 14 && wy < dy + 14) return c;
    }
    return null;
  }

  center(id) {
    const c = this.chars.get(id);
    const stage = this.canvas.parentElement;
    if (!c || !stage) return;
    const { px, py } = this.drawPos(c);
    stage.scrollTo({ left: px * this.zoom - stage.clientWidth / 2, top: py * this.zoom - stage.clientHeight / 2, behavior: 'smooth' });
  }
}

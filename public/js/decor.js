// Pixel-art drawing for the office: floors, walls, desks, chairs, furniture,
// monitors and day/night lighting. Everything is drawn with fillRect at 1×.
import { T } from './office.js';
import { STATE, DOOR, DOORS, hash } from './meta.js';

const WOOD = ['#c08f62', '#b88759', '#c6976a', '#b38257'];
const FABRIC = ['#7d8fb3', '#86a892', '#b39a8f', '#9a8fb3', '#8fa7b3'];
const CHAIRS = ['#3d3f58', '#2f4a6b', '#6b2f3a', '#2f6b4a', '#4a3d6b', '#5a4632'];
const MUGS = ['#e86a5a', '#5aa9e6', '#f2f2f2', '#ffd166', '#6bbf59', '#b48cff'];
const POSTERS = [
  ['#5aa9e6', '#ffd166', '#2f4a6b'],
  ['#e86a5a', '#f7f1e3', '#2a2238'],
  ['#6bbf59', '#2f6b4a', '#f7f1e3'],
  ['#b48cff', '#ff7ad9', '#2a2238'],
];

export const isNight = (h) => h >= 19 || h < 6;

function px(g, c, x, y, w = 1, h = 1) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

export function line(g, x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 96; i++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function skyColors(h) {
  if (h >= 6 && h < 8) return ['#f7b98b', '#fcd9b6', '#ffe9a8'];
  if (h >= 8 && h < 17) return ['#7cc8f7', '#b9e6ff', '#fff3b0'];
  if (h >= 17 && h < 19) return ['#f08a5d', '#f9c48f', '#ffd27a'];
  return ['#1b2447', '#27335e', '#f4f1c9'];
}

// ---------------------------------------------------------------- background

// today's office; a theme (docs/theme-spec.md) overrides any of these
export const DEFAULT_THEME = {
  floor: { pattern: 'planks', colors: WOOD, line: '#9c714a' },
  wall: { top: '#c9bca5', paper: '#efe6d6', stripe: '#e7dbc6', trim: '#7d5f43', panel: '#a98663', panelLine: '#977452', base: '#6b4f38' },
  windows: { show: true, frame: '#8b6d4f', sill: '#e3d5bd' },
  lounge: ['#5f4b73', '#69547f', '#57446a'],
  sideWall: ['#5a4e66', '#6d6080', '#504560'],
  bottomWall: ['#4a3f55', '#55496a', '#6d6080'],
  outside: { sidewalk: '#9a9ea8', grass: '#4f8a3a', grass2: '#5fa046' },
  props: [],
};

function themed(t = {}) {
  const d = DEFAULT_THEME;
  const floor = { ...d.floor, ...(t.floor || {}) };
  if (!floor.colors?.length) floor.colors = t.floor?.pattern && t.floor.pattern !== 'planks' ? ['#b9b2a6', '#aea79b'] : d.floor.colors;
  const list = (k) => d[k].map((c, i) => t[k]?.[i] || c);
  return {
    floor,
    wall: { ...d.wall, ...(t.wall || {}) },
    windows: { ...d.windows, ...(t.windows || {}) },
    lounge: list('lounge'),
    sideWall: list('sideWall'),
    bottomWall: list('bottomWall'),
    outside: { ...d.outside, ...(t.outside || {}) },
    props: t.props || [],
  };
}

/** The office floor in one of the theme patterns (the area between the back and bottom walls). */
function drawFloor(g, L, f) {
  const top = L.top * T;
  const bottom = L.wallY * T;
  const W = L.w * T;
  const C = f.colors;
  const base = C[0];
  const pick = (k) => C[hash(k) % C.length];
  const accents = C.length > 1 ? C.slice(1) : [shade(base, 0.9)];
  const accent = (k) => accents[hash(k) % accents.length];
  switch (f.pattern) {
    case 'tiles':
    case 'checker':
      for (let y = top, r = 0; y < bottom; y += 16, r++) {
        for (let x = 0, i = 0; x < W; x += 16, i++) {
          const c = f.pattern === 'checker' ? C[(r + i) % Math.min(2, C.length)] : pick(`t${r}:${i}`);
          px(g, c, x, y, 16, 16);
          px(g, f.line, x, y + 15, 16, 1);
          px(g, f.line, x + 15, y, 1, 16);
          px(g, shade(c, 1.08), x, y, 15, 1);
        }
      }
      return;
    case 'carpet':
      px(g, base, 0, top, W, bottom - top);
      for (let y = top; y < bottom; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < W; x += 4) if (hash(`c${x}:${y}`) % 3 === 0) px(g, accent(`d${x}:${y}`), x, y, 2, 2);
      return;
    case 'grass':
      px(g, base, 0, top, W, bottom - top);
      for (let y = top; y < bottom; y += 3) for (let x = 0; x < W; x += 3) if (hash(`g${x}:${y}`) % 4 === 0) px(g, accent(`b${x}:${y}`), x + (hash(`o${x}${y}`) % 2), y, 1, 2);
      return;
    case 'water':
      px(g, base, 0, top, W, bottom - top);
      for (let y = top + 2; y < bottom; y += 6) {
        for (let x = (y * 7) % 20; x < W; x += 20) {
          const c = accent(`w${x}:${y}`);
          px(g, c, x, y, 6, 1);
          px(g, c, x + 6, y - 1, 4, 1);
        }
      }
      return;
    case 'dirt':
      px(g, base, 0, top, W, bottom - top);
      for (let y = top; y < bottom; y += 2) for (let x = 0; x < W; x += 2) {
        const h = hash(`s${x}:${y}`) % 11;
        if (h === 0) px(g, accent(`p${x}:${y}`), x, y, 1, 1);
        else if (h === 1 && hash(`r${x}${y}`) % 5 === 0) px(g, f.line, x, y, 3, 2); // pebble
      }
      return;
    case 'concrete':
      px(g, base, 0, top, W, bottom - top);
      for (let y = top; y < bottom; y += 2) for (let x = 0; x < W; x += 2) if (hash(`k${x}:${y}`) % 7 === 0) px(g, accent(`q${x}:${y}`), x, y, 1, 1);
      for (let x = 0; x < W; x += 48) px(g, f.line, x, top, 1, bottom - top); // expansion joints
      for (let y = top + 47; y < bottom; y += 48) px(g, f.line, 0, y, W, 1);
      return;
    default: // planks: staggered boards with colour variation
      for (let r = L.top * 4; r < L.wallY * 4; r++) {
        const y = r * 4;
        let x = T - ((r * 11) % 24);
        for (let i = 0; x < W; i++, x += 24) {
          px(g, pick(`${r}:${i}`), x, y, 24, 4);
          px(g, f.line, x, y + 3, 24, 1);
          px(g, shade(f.line, 1.07), x, y, 1, 3);
          if (hash(`k${r}:${i}`) % 9 === 0) px(g, shade(f.line, 0.98), x + 6 + (hash(`n${r}${i}`) % 12), y + 1, 2, 1);
        }
      }
  }
}

/** Theme pixel props, painted with fillRect only. */
function drawProps(g, L, props, layer) {
  const area = {
    floor: [0, L.top * T, L.w * T, (L.wallY - L.top) * T],
    wall: [0, 0, L.w * T, L.top * T - 2],
    outside: [0, (L.h - 1) * T, L.w * T, T],
  }[layer];
  for (const p of props) {
    if ((p.layer || 'floor') !== layer) continue;
    const s = p.scale || 1;
    for (let k = 0; k < (p.repeat || 1); k++) {
      const x0 = Math.round(area[0] + (p.x + k * (p.gap ?? 0.1)) * area[2]);
      const y0 = Math.round(area[1] + p.y * area[3]);
      if (x0 >= area[0] + area[2]) break;
      p.pixels.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = p.colors[row[x]];
          if (c) px(g, c, x0 + x * s, y0 + y * s, s, s);
        }
      });
    }
  }
}

export function renderBackground(L, hour, theme) {
  const th = themed(theme);
  const c = document.createElement('canvas');
  c.width = L.w * T;
  c.height = L.h * T;
  const g = c.getContext('2d');
  const top = L.top * T;
  const wy = L.wallY * T;

  drawFloor(g, L, th.floor);
  // sunlight patches under the windows during the day
  if (!isNight(hour) && th.windows.show) {
    g.fillStyle = 'rgba(255,244,214,0.13)';
    for (let col = 0; col < L.cols; col++) {
      if (col === 1) continue;
      const cx = (1 + col * 4 + 2) * T;
      for (let k = 0; k < 10; k++) g.fillRect(cx - 16 + k, top + k, 32, 1);
    }
  }
  // chair mats + entrance mats
  for (const s of L.slots) {
    const cx = (s.x0 + 2) * T;
    const y = (s.y0 + 1) * T;
    px(g, 'rgba(225,235,245,0.16)', cx - 13, y - 1, 26, 18);
    px(g, 'rgba(255,255,255,0.12)', cx - 13, y - 1, 26, 1);
  }
  for (const d of DOORS) {
    const door = L.doors[d];
    const mx = door.x * T;
    const my = (L.wallY - 1) * T;
    px(g, shade(DOOR[d].color, 0.45), mx - 3, my + 5, T + 6, 11);
    px(g, shade(DOOR[d].color, 0.6), mx - 2, my + 6, T + 4, 9);
    for (let k = 0; k < 4; k++) px(g, shade(DOOR[d].color, 0.5), mx - 1 + k * 5, my + 7, 2, 7);
  }

  // server room raised floor (+ vents in front of the racks), lounge carpet
  for (let y = L.top; y < L.wallY; y++) {
    for (let x = L.sx; x < L.w - 1; x++) {
      const X = x * T;
      const Y = y * T;
      if (L.floor[y][x] === 's') {
        px(g, '#3a4152', X, Y, T, T);
        px(g, '#46506a', X, Y, T, 1);
        px(g, '#46506a', X, Y, 1, T);
        px(g, '#2d3341', X, Y + T - 1, T, 1);
        px(g, '#2d3341', X + T - 1, Y, 1, T);
        if ((y - L.top) % 3 === 1) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) px(g, '#283040', X + 3 + i * 3, Y + 3 + j * 3, 1, 1);
      } else if (L.floor[y][x] === 'c') {
        px(g, th.lounge[0], X, Y, T, T);
        for (let k = 0; k < 4; k++) px(g, th.lounge[1], X + ((k + y) % 2) * 8, Y + k * 4, 8, 4);
        px(g, th.lounge[2], X, Y + T - 1, T, 1);
      }
    }
  }
  drawProps(g, L, th.props, 'floor');
  // cable trays + glass partition around the server room
  const sxp = L.sx * T;
  const lyp = L.ly * T;
  px(g, 'rgba(160,215,255,0.28)', sxp - 2, top, 3, lyp - top);
  px(g, '#aab4c4', sxp - 2, top, 1, lyp - top);
  px(g, 'rgba(160,215,255,0.28)', sxp, lyp - 2, (L.w - 1) * T - sxp, 3);
  px(g, '#aab4c4', sxp, lyp - 2, (L.w - 1) * T - sxp, 1);
  for (let y = top; y < lyp; y += T) px(g, '#c4ccd8', sxp - 2, y, 3, 2);
  for (let x = sxp; x < (L.w - 1) * T; x += T) px(g, '#c4ccd8', x, lyp - 2, 2, 3);
  px(g, 'rgba(255,255,255,0.35)', sxp - 1, top + 4, 1, 10);

  // back wall: wallpaper, wainscoting, baseboard
  const wl = th.wall;
  for (let x = 0; x < L.w * T; x++) {
    const server = x >= sxp - 2 && x < (L.w - 1) * T;
    px(g, server ? '#d9dde6' : wl.paper, x, 0, 1, top - 14);
    if (x % 6 < 2) px(g, server ? '#cfd4df' : wl.stripe, x, 3, 1, top - 17);
    px(g, server ? '#8d97a8' : wl.panel, x, top - 14, 1, 12);
    if (x % 8 === 0) px(g, server ? '#7d8798' : wl.panelLine, x, top - 13, 1, 11);
  }
  px(g, wl.top, 0, 0, L.w * T, 3);
  px(g, wl.trim, 0, top - 15, L.w * T, 2);
  px(g, wl.base, 0, top - 2, L.w * T, 2);

  // windows with blinds over each desk column (column 1 holds the status TV)
  const [sky1, sky2, sun] = skyColors(hour);
  const frame = th.windows.frame;
  for (let col = 0; col < L.cols; col++) {
    if (col === 1 || !th.windows.show) continue;
    const cx = (1 + col * 4 + 2) * T;
    const x = cx - 18;
    const y = 5;
    px(g, frame, x - 2, y - 2, 40, 27);
    px(g, sky1, x, y, 36, 23);
    px(g, sky2, x, y, 36, 8);
    if (isNight(hour)) {
      for (let k = 0; k < 5; k++) px(g, '#fff6c8', x + 3 + ((col * 13 + k * 7) % 30), y + 3 + ((k * 5 + col) % 15), 1, 1);
      if (col === 0) px(g, sun, x + 26, y + 4, 4, 4);
    } else {
      px(g, '#ffffff', x + 5 + ((col * 9) % 16), y + 12, 9, 3);
      px(g, '#ffffff', x + 8 + ((col * 9) % 16), y + 10, 5, 2);
      if (col === 0) px(g, sun, x + 27, y + 3, 5, 5);
      px(g, '#6fae5f', x, y + 19, 36, 4); // distant trees
      px(g, '#5c9a50', x + 4, y + 17, 6, 2);
      px(g, '#5c9a50', x + 22, y + 16, 8, 3);
    }
    for (let k = 0; k < 4; k++) px(g, 'rgba(242,237,228,0.95)', x, y + k * 2, 36, 1); // blinds
    px(g, frame, x + 17, y, 2, 23);
    px(g, frame, x, y + 11, 36, 1);
    px(g, th.windows.sill, x - 3, y + 23, 42, 2); // sill
    if (col % 2 === 0) {
      px(g, '#b5651d', x + 2, y + 19, 4, 4);
      px(g, '#4caf50', x + 1, y + 16, 6, 3);
    }
  }
  // posters / sconces / boards between windows
  for (let col = 0; col <= L.cols; col++) {
    const x = (1 + col * 4) * T;
    if (x > (L.deskW + 1) * T - 4 || col === 0) continue;
    const kind = col % 3;
    if (kind === 0) {
      const p = POSTERS[col % POSTERS.length];
      px(g, '#3a2e24', x - 6, 6, 12, 16);
      px(g, p[1], x - 5, 7, 10, 14);
      px(g, p[0], x - 4, 12, 8, 6);
      px(g, p[2], x - 3, 9, 6, 2);
    } else if (kind === 1) {
      px(g, '#6b4f38', x - 1, 10, 2, 6);
      px(g, '#ffe7a3', x - 3, 6, 6, 4);
      px(g, '#f3c969', x - 3, 9, 6, 1);
    } else {
      px(g, '#8b6d4f', x - 7, 6, 14, 12);
      px(g, '#c99a5f', x - 6, 7, 12, 10);
      px(g, '#ffe066', x - 5, 8, 4, 3);
      px(g, '#9fd3ff', x + 0, 9, 4, 3);
      px(g, '#ff9ecf', x - 3, 12, 4, 3);
      px(g, '#e86a5a', x - 4, 8, 1, 1);
    }
  }
  // server-room wall: AC unit + label plate + cable tray
  const acx = (L.w - 1) * T - 34;
  px(g, '#f4f6fa', acx, 6, 30, 10);
  px(g, '#d7dce6', acx, 13, 30, 3);
  for (let k = 0; k < 6; k++) px(g, '#c3c9d6', acx + 3 + k * 4, 14, 2, 1);
  px(g, '#59f08a', acx + 26, 8, 2, 1);
  px(g, '#2b2f3a', sxp + 4, 6, 26, 9);
  px(g, '#3c4252', sxp + 5, 7, 24, 7);
  for (let x = sxp; x < (L.w - 1) * T; x += 4) px(g, x % 8 ? '#ffd166' : '#2b2b33', x, top - 17, 4, 2);

  drawProps(g, L, th.props, 'wall');
  // side walls
  const [sw0, sw1, sw2] = th.sideWall;
  for (let y = L.top; y < L.wallY; y++) {
    for (const x of [0, L.w - 1]) {
      px(g, sw0, x * T, y * T, T, T);
      px(g, sw1, x * T + (x === 0 ? T - 3 : 0), y * T, 3, T);
      if (y % 2 === 0) px(g, sw2, x * T + 3, y * T + 6, 9, 1);
    }
  }
  // bottom wall (brick) with doors
  const [bw0, bw1, bw2] = th.bottomWall;
  for (let r = 0; r < 4; r++) {
    px(g, bw0, 0, wy + r * 4, L.w * T, 4);
    for (let x = (r % 2) * 6; x < L.w * T; x += 12) px(g, bw1, x, wy + r * 4, 1, 4);
    px(g, bw1, 0, wy + r * 4 + 3, L.w * T, 1);
  }
  px(g, bw2, 0, wy, L.w * T, 2);
  for (const d of DOORS) {
    const door = L.doors[d];
    const dx = door.x * T;
    const col = DOOR[d].color;
    px(g, '#1d1726', dx + 1, wy + 2, T - 2, T - 2);
    px(g, '#7a5a3e', dx + 1, wy + 2, 3, T - 2);
    px(g, '#7a5a3e', dx + T - 4, wy + 2, 3, T - 2);
    px(g, col, dx, wy, 1, T);
    px(g, col, dx + T - 1, wy, 1, T);
    px(g, col, dx, wy, T, 2);
    px(g, '#fff6c8', dx + 7, wy + 3, 2, 1);
  }
  // street: sidewalk, grass and flowers
  const oy = (L.h - 1) * T;
  const out = th.outside;
  for (let x = 0; x < L.w * T; x += 8) {
    px(g, out.sidewalk, x, oy, 8, 10);
    px(g, shade(out.sidewalk, 0.9), x + 7, oy, 1, 10);
  }
  px(g, shade(out.sidewalk, 0.9), 0, oy + 9, L.w * T, 1);
  px(g, out.grass, 0, oy + 10, L.w * T, 6);
  for (let x = 2; x < L.w * T; x += 7) {
    const doorHere = DOORS.some((d) => Math.abs(L.doors[d].x * T + 8 - x) < 10);
    if (doorHere) continue;
    px(g, out.grass2, x, oy + 11, 3, 2);
    if (hash(`f${x}`) % 3 === 0) px(g, ['#ff9ecf', '#ffd166', '#ffffff'][x % 3], x + 1, oy + 12, 1, 1);
  }
  for (const d of DOORS) {
    const dx = L.doors[d].x * T;
    px(g, '#b8b0a4', dx + 2, oy, T - 4, T);
    px(g, '#a59d91', dx + 2, oy + 7, T - 4, 1);
  }
  drawProps(g, L, th.props, 'outside');
  return c;
}

// ------------------------------------------------------------ wall dynamics

export function drawWall(g, L, counts, now) {
  // status TV on the back wall (column 1)
  const cx = (1 + 4 + 2) * T;
  const x = cx - 27;
  const y = 4;
  px(g, '#1b1b22', x, y, 54, 30);
  px(g, '#3a3a46', x, y, 54, 1);
  const sx = x + 2;
  const sy = y + 2;
  px(g, '#0f1626', sx, sy, 50, 26);
  const cols = ['#5aa9ff', '#ff5c5c', '#8bd17c', '#8a8f98'];
  const max = Math.max(1, ...counts);
  counts.forEach((n, i) => {
    const h = Math.round((n / max) * 14);
    px(g, cols[i], sx + 3 + i * 7, sy + 23 - h, 5, h);
  });
  px(g, '#2a3550', sx + 2, sy + 23, 28, 1);
  // scrolling activity sparkline
  for (let i = 0; i < 16; i++) {
    const v = Math.sin((now / 900 + i) * 0.9) * 3 + Math.sin((now / 400 + i * 2) * 0.5) * 2;
    px(g, '#ff7ad9', sx + 32 + i, sy + 12 + Math.round(v), 1, 1);
  }
  px(g, Math.floor(now / 500) % 2 ? '#59f08a' : '#1f4a30', sx + 45, sy + 2, 2, 2);
  px(g, '#4a4a58', cx - 1, y + 30, 2, 2);

  // clock above the corridor
  const kx = (1 + L.deskW) * T + 8;
  const ky = 18;
  px(g, '#5a4a3a', kx - 7, ky - 7, 15, 15);
  px(g, '#fbfaf5', kx - 6, ky - 6, 13, 13);
  const d = new Date();
  const mAng = ((d.getMinutes() + d.getSeconds() / 60) / 60) * Math.PI * 2;
  const hAng = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2;
  g.fillStyle = '#2a2238';
  line(g, kx, ky, kx + Math.sin(mAng) * 5, ky - Math.cos(mAng) * 5);
  g.fillStyle = '#c0392b';
  line(g, kx, ky, kx + Math.sin(hAng) * 3.4, ky - Math.cos(hAng) * 3.4);
}

// ----------------------------------------------------------------- monitors

export function drawScreen(g, x, y, W, H, state, t, seed) {
  const bg = (c) => px(g, c, x, y, W, H);
  switch (state) {
    case 'typing': {
      bg('#1e1f2e');
      px(g, '#2a2c40', x, y, 3, H);
      const cols = ['#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68', '#7dcfff'];
      const rows = Math.floor((H - 1) / 2);
      for (let i = 0; i < rows; i++) {
        let len = 3 + ((seed * (i + 3)) % (W - 8));
        if (i === rows - 1) len = 1 + Math.floor((t * 7) % (W - 6));
        px(g, cols[i % cols.length], x + 4 + (i % 3 === 1 ? 2 : 0), y + 1 + i * 2, Math.min(len, W - 6), 1);
        if (i === rows - 1 && Math.floor(t * 3) % 2) px(g, '#ffffff', x + 5 + Math.min(len, W - 7), y + 1 + i * 2, 1, 1);
      }
      break;
    }
    case 'reading': {
      bg('#1e1f2e');
      const off = Math.floor(t * 5);
      for (let i = 0; i < H; i += 2) px(g, (i / 2 + off) % 2 ? '#7f8aa8' : '#a9b1d6', x + 1, y + i, 4 + ((seed + i * 3 + off) % (W - 6)), 1);
      px(g, 'rgba(224,175,104,0.45)', x, y + Math.floor(H / 2) - 1, W, 2);
      break;
    }
    case 'running': {
      bg('#0b0f0b');
      const shift = Math.floor(t * 4);
      for (let i = 0; i < Math.floor(H / 2); i++) {
        px(g, i === Math.floor(H / 2) - 1 ? '#a6ffbf' : '#5af78e', x + 1, y + 1 + i * 2, 1, 1);
        px(g, '#5af78e', x + 3, y + 1 + i * 2, 2 + ((seed + i * 5 + shift) % (W - 5)), 1);
      }
      if (Math.floor(t * 3) % 2) px(g, '#5af78e', x + W - 3, y + H - 2, 1, 1);
      break;
    }
    case 'web': {
      bg('#e8eef7');
      px(g, '#4f8cf7', x, y, W, 2);
      px(g, '#ffffff', x + 2, y, W - 6, 1);
      px(g, '#9fc4f0', x + 1, y + 3, Math.floor(W / 3), H - 4);
      const k = Math.floor(t * 2) % 3;
      for (let i = 0; i < 3; i++) px(g, '#c3cfe0', x + Math.floor(W / 3) + 3, y + 3 + i * 2, i === k ? W - Math.floor(W / 3) - 5 : 4, 1);
      break;
    }
    case 'mcp': {
      bg('#1a1330');
      const a = [x + 2, y + 2];
      const b = [x + W - 3, y + 2];
      const c = [x + Math.floor(W / 2), y + H - 3];
      g.fillStyle = '#5a3f7a';
      line(g, ...a, ...b);
      line(g, ...a, ...c);
      line(g, ...b, ...c);
      const k = (t * 1.5) % 1;
      px(g, '#ffd6f4', Math.round(a[0] + (b[0] - a[0]) * k), a[1], 1, 1);
      [a, b, c].forEach(([nx, ny], i) => px(g, Math.floor(t * 3 + i) % 3 === 0 ? '#ffd6f4' : '#ff7ad9', nx - 1, ny - 1, 2, 2));
      break;
    }
    case 'delegating': {
      bg('#1e1f2e');
      const m = x + Math.floor(W / 2);
      px(g, '#ffa94d', m - 1, y + 1, 2, 2);
      px(g, '#6b5a45', m, y + 3, 1, 2);
      px(g, '#6b5a45', x + 3, y + 4, W - 6, 1);
      const k = Math.floor(t * 2) % 3;
      [x + 3, m, x + W - 4].forEach((nx, i) => {
        px(g, '#6b5a45', nx, y + 4, 1, 2);
        px(g, i === k ? '#ffd8a8' : '#ffa94d', nx - 1, y + 6, 2, 2);
      });
      break;
    }
    case 'planning': {
      bg('#f4f1e8');
      const done = Math.floor(t / 1.2) % 4;
      for (let i = 0; i < 3; i++) {
        px(g, i < done ? '#3fa34d' : '#7a7a72', x + 1, y + 1 + i * 3, 2, 2);
        px(g, '#b0aea4', x + 4, y + 2 + i * 3, 6 + ((seed + i) % (W - 9)), 1);
      }
      break;
    }
    case 'thinking': {
      bg('#1e1f2e');
      const k = Math.floor(t * 3) % 4;
      for (let i = 0; i < 3; i++) px(g, i < k ? '#d6c2ff' : '#5c4a85', x + Math.floor(W / 2) - 4 + i * 3, y + Math.floor(H / 2) - 1, 2, 2);
      break;
    }
    case 'waiting': {
      bg('#2a1f1f');
      px(g, '#ffd166', x + 2, y + 1, W - 4, H - 2);
      px(g, '#2a1f1f', x + Math.floor(W / 2) - 1, y + 2, 2, H - 6);
      px(g, '#2a1f1f', x + Math.floor(W / 2) - 1, y + H - 3, 2, 1);
      break;
    }
    case 'done': {
      bg('#14281a');
      g.fillStyle = '#8bd17c';
      const m = x + Math.floor(W / 2);
      line(g, m - 3, y + 4, m - 1, y + 6);
      line(g, m - 1, y + 6, m + 3, y + 2);
      break;
    }
    case 'away':
    case 'idle': {
      bg('#10131c');
      const pxx = Math.abs(((t * 4 + seed) % ((W - 2) * 2)) - (W - 2));
      const pyy = Math.abs(((t * 3 + seed) % ((H - 2) * 2)) - (H - 2));
      px(g, ['#ff7ad9', '#5aa9ff', '#8bd17c', '#ffd166'][Math.floor(t / 2 + seed) % 4], x + Math.round(pxx), y + Math.round(pyy), 2, 2);
      break;
    }
    case 'dash': {
      bg('#141a29');
      for (let i = 0; i < 4; i++) px(g, ['#5aa9ff', '#8bd17c', '#ffd166', '#ff7ad9'][i], x + 1 + i * 3, y + H - 2 - ((seed + i * 3) % (H - 2)), 2, (seed + i * 3) % (H - 2) + 1);
      break;
    }
    default:
      bg('#1a1d26');
      px(g, '#262a3c', x + 1, y + 1, 3, 1);
  }
}

// -------------------------------------------------------------------- desks

/**
 * @param occ  character assigned to the desk (or undefined)
 * @param seated  whether that character is sitting at it right now
 */
function drawArt(g, rows, colors, left, top) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x]];
      if (c) px(g, c, left + x, top + y, 1, 1);
    }
  });
}
const artWidth = (rows) => Math.max(0, ...rows.map((r) => r.length));

/** a theme's desk: bottom-centred on the desk tile, with the agent's status screen where the theme says */
function drawThemeDesk(g, s, desk, state, waiting, now) {
  const cx = (s.x0 + 2) * T;
  const bottom = (s.y0 + 1) * T;
  const left = cx - Math.floor(artWidth(desk.pixels) / 2);
  const top = bottom - desk.pixels.length;
  px(g, 'rgba(0,0,0,0.18)', left + 2, bottom - 3, artWidth(desk.pixels) - 4, 3);
  drawArt(g, desk.pixels, desk.colors, left, top);
  const sc = desk.screen;
  if (!sc) return;
  drawScreen(g, left + sc.x, top + sc.y, sc.w, sc.h, state, now / 1000, s.seed);
  if (waiting && Math.floor(now / 400) % 2) {
    px(g, '#ff5c5c', left + sc.x - 2, top + sc.y - 2, sc.w + 4, 1);
    px(g, '#ff5c5c', left + sc.x - 2, top + sc.y + sc.h + 1, sc.w + 4, 1);
    px(g, '#ff5c5c', left + sc.x - 2, top + sc.y - 2, 1, sc.h + 4);
    px(g, '#ff5c5c', left + sc.x + sc.w + 1, top + sc.y - 2, 1, sc.h + 4);
  }
}

export function drawDesk(g, s, occ, seated, now, night, ws = null) {
  const cx = (s.x0 + 2) * T;
  const dy = s.y0 * T;
  const v = s.seed % 4;
  const state = occ && seated ? occ.agent.state : occ ? 'away' : 'off';
  const active = occ && seated && !['done', 'idle', 'waiting'].includes(occ.agent.state);
  const t = now / 1000;
  if (ws?.desk) return drawThemeDesk(g, s, ws.desk, state, occ?.agent.state === 'waiting', now);

  // cubicle partition behind the desk
  const fab = FABRIC[(s.r * 3 + s.c) % FABRIC.length];
  px(g, shade(fab, 0.78), cx - 28, dy - 13, 56, 17);
  px(g, fab, cx - 27, dy - 12, 54, 15);
  for (let k = 0; k < 5; k++) px(g, shade(fab, 0.92), cx - 27, dy - 10 + k * 3, 54, 1);
  px(g, '#d9dbe3', cx - 28, dy - 14, 56, 2);
  px(g, '#b9bcc8', cx - 28, dy - 13, 2, 17);
  px(g, '#b9bcc8', cx + 26, dy - 13, 2, 17);
  px(g, '#ffe066', cx - 24, dy - 10, 4, 4);
  if (s.seed % 2) px(g, '#ff9ecf', cx - 19, dy - 8, 4, 4);
  if (s.seed % 3 === 0) {
    px(g, '#ffffff', cx + 18, dy - 11, 6, 5);
    px(g, ['#5aa9e6', '#6bbf59', '#e0a43a'][s.seed % 3], cx + 19, dy - 10, 4, 3);
  } else px(g, '#9fd3ff', cx + 20, dy - 10, 4, 4);

  // shadow, legs, drawer pedestal
  px(g, 'rgba(0,0,0,0.22)', cx - 25, dy + 13, 51, 4);
  px(g, '#6e5038', cx - 24, dy + 10, 2, 6);
  px(g, '#a27c56', cx + 11, dy + 9, 13, 7);
  px(g, '#8b6648', cx + 11, dy + 12, 13, 1);
  px(g, '#e3cfae', cx + 16, dy + 10, 3, 1);
  px(g, '#e3cfae', cx + 16, dy + 13, 3, 1);
  // PC tower under the desk
  if (v !== 1) {
    px(g, '#2b2d3a', cx - 21, dy + 8, 7, 8);
    px(g, '#3a3d4e', cx - 21, dy + 8, 7, 1);
    px(g, active && Math.floor(t * 4) % 2 ? '#59f08a' : occ ? '#2f8f55' : '#3a3d4e', cx - 19, dy + 10, 1, 1);
  }
  // desktop surface
  px(g, '#caa47c', cx - 26, dy + 1, 52, 9);
  px(g, '#dcb990', cx - 26, dy + 1, 52, 1);
  px(g, '#a17a52', cx - 26, dy + 10, 52, 2);
  px(g, '#8d6a46', cx - 26, dy + 12, 52, 1);

  // keyboard, mousepad, mouse
  px(g, '#3a3f58', cx + 8, dy + 4, 8, 5);
  px(g, '#e3e3ea', cx - 7, dy + 5, 14, 3);
  for (let k = 0; k < 6; k++) px(g, '#c4c4cf', cx - 6 + k * 2, dy + 6, 1, 1);
  px(g, '#e3e3ea', cx + 10, dy + 5, 3, 3);
  if (state === 'typing' && Math.floor(t * 8) % 2) px(g, '#b8b8c4', cx - 5 + (Math.floor(t * 13) % 10), dy + 6, 2, 1);

  // main monitor
  px(g, '#4b4f63', cx - 1, dy + 1, 2, 3);
  px(g, '#4b4f63', cx - 4, dy + 3, 8, 1);
  px(g, '#24262f', cx - 10, dy - 11, 20, 13);
  px(g, '#3a3d4a', cx - 10, dy - 11, 20, 1);
  drawScreen(g, cx - 9, dy - 10, 18, 10, state, t, s.seed);
  if (s.seed % 2 === 0) px(g, '#ffe066', cx + 6, dy - 12, 3, 3);
  if (occ && occ.agent.state === 'waiting' && Math.floor(now / 400) % 2) {
    px(g, '#ff5c5c', cx - 11, dy - 12, 22, 1);
    px(g, '#ff5c5c', cx - 11, dy + 2, 22, 1);
    px(g, '#ff5c5c', cx - 11, dy - 12, 1, 15);
    px(g, '#ff5c5c', cx + 10, dy - 12, 1, 15);
  }

  // per-desk personality
  if (v === 0) {
    // second monitor
    px(g, '#4b4f63', cx + 17, dy + 1, 2, 3);
    px(g, '#24262f', cx + 12, dy - 8, 12, 10);
    drawScreen(g, cx + 13, dy - 7, 10, 7, occ && seated ? 'dash' : 'off', t, s.seed);
  } else if (v === 1) {
    // laptop
    px(g, '#b8bcc8', cx - 24, dy + 5, 12, 3);
    px(g, '#2b2d3a', cx - 23, dy - 2, 10, 7);
    px(g, occ && seated ? '#3d6fb8' : '#1a1d26', cx - 22, dy - 1, 8, 5);
    if (occ && seated) px(g, '#9fc4f0', cx - 21, dy, 4, 1);
  } else if (v === 2) {
    // desk lamp
    px(g, '#3a3a46', cx - 23, dy + 6, 6, 2);
    g.fillStyle = '#4b4b58';
    line(g, cx - 20, dy + 6, cx - 22, dy - 1);
    line(g, cx - 22, dy - 1, cx - 17, dy - 6);
    px(g, '#e0a43a', cx - 19, dy - 8, 6, 3);
    if (night || (occ && seated)) px(g, '#fff3b0', cx - 18, dy - 5, 4, 1);
  } else {
    // books + cactus
    px(g, '#d65151', cx - 24, dy + 4, 9, 2);
    px(g, '#5aa9e6', cx - 23, dy + 2, 8, 2);
    px(g, '#e0a43a', cx - 24, dy, 9, 2);
    px(g, '#b5651d', cx - 14, dy + 3, 3, 3);
    px(g, '#4caf50', cx - 14, dy - 1, 3, 4);
  }
  // mug (steams while the agent is busy)
  const mx = v === 0 ? cx - 18 : cx + 17;
  const mug = MUGS[s.seed % MUGS.length];
  px(g, mug, mx, dy + 3, 4, 4);
  px(g, shade(mug, 0.75), mx + 4, dy + 4, 1, 2);
  px(g, '#5a3a22', mx + 1, dy + 3, 2, 1);
  if (active) {
    const k = Math.floor(t * 3) % 3;
    px(g, 'rgba(255,255,255,0.55)', mx + 1 + (k % 2), dy - k - 1, 1, 2);
  }
  // waste bin
  if (s.seed % 3 === 0) {
    px(g, '#7d8590', cx + 25, dy + 11, 5, 5);
    px(g, '#959daa', cx + 25, dy + 11, 5, 1);
  }
}

/**
 * @param occupied  false: empty chair · true: the part in front of a seated agent · 'under': the part behind it
 * @param ws        the theme's workstation: its own chair art (and `front` rows over the sitter), or noChair
 */
export function drawChair(g, s, occupied, ws = null) {
  const cx = (s.x0 + 2) * T;
  const by = (s.y0 + 1) * T;
  if (ws?.noChair) return;
  if (ws?.chair) {
    const ch = ws.chair;
    const left = cx - Math.floor(artWidth(ch.pixels) / 2);
    const top = by + 16 - ch.pixels.length;
    if (occupied === true) {
      if (ch.front) drawArt(g, ch.front, ch.colors, left, top);
    } else drawArt(g, ch.pixels, ch.colors, left, top);
    return;
  }
  if (occupied === 'under') return; // the office chair is all drawn in front
  const col = CHAIRS[s.seed % CHAIRS.length];
  px(g, 'rgba(0,0,0,0.2)', cx - 7, by + 14, 14, 2);
  px(g, '#26262e', cx - 6, by + 13, 12, 1);
  px(g, '#26262e', cx - 1, by + 10, 2, 4);
  px(g, '#1b1b22', cx - 7, by + 14, 2, 2);
  px(g, '#1b1b22', cx + 5, by + 14, 2, 2);
  px(g, '#1b1b22', cx - 1, by + 15, 2, 1);
  px(g, shade(col, 0.8), cx - 7, by + 8, 14, 3);
  px(g, col, cx - 7, by + 8, 14, 1);
  if (occupied) {
    // only the back rest, in front of the sitting character
    px(g, col, cx - 6, by + 4, 12, 6);
    px(g, shade(col, 1.25), cx - 6, by + 4, 12, 1);
    px(g, shade(col, 0.8), cx - 8, by + 5, 2, 4);
    px(g, shade(col, 0.8), cx + 6, by + 5, 2, 4);
  } else {
    px(g, col, cx - 6, by - 3, 12, 11);
    px(g, shade(col, 1.25), cx - 6, by - 3, 12, 1);
    px(g, shade(col, 0.85), cx - 5, by + 2, 10, 1);
    px(g, shade(col, 0.8), cx - 8, by + 4, 2, 4);
    px(g, shade(col, 0.8), cx + 6, by + 4, 2, 4);
  }
}

// ---------------------------------------------------------------- furniture

export function drawRack(g, r, name, m, now, flash) {
  const x = r.x * T + 1;
  const y = r.y * T - 12;
  if (!name) {
    px(g, 'rgba(255,255,255,0.06)', x, r.y * T + 2, 14, 12);
    px(g, 'rgba(255,255,255,0.1)', x, r.y * T + 2, 14, 1);
    return;
  }
  px(g, 'rgba(0,0,0,0.3)', x - 1, r.y * T + 14, 17, 3);
  px(g, '#ffd166', x + 6, y - 3, 2, 3); // cable up to the tray
  px(g, flash ? '#ff7ad9' : '#15171e', x - 1, y - 1, 16, 30);
  px(g, '#2b2f3a', x, y, 14, 28);
  px(g, '#3a3f4e', x, y, 14, 1);
  for (let i = 0; i < 6; i++) {
    px(g, '#3c4252', x + 1, y + 2 + i * 4, 12, 3);
    const on = (Math.floor(now / (170 + i * 41)) + i + name.length * 3) % 3 !== 0;
    px(g, flash ? '#ffffff' : !m?.live && !m?.calls ? '#4b5163' : on ? (i % 3 === 2 ? '#ffbf47' : '#59f08a') : '#28513a', x + 2, y + 3 + i * 4, 2, 1);
    px(g, flash ? '#ffd6f4' : '#566078', x + 6, y + 3 + i * 4, 6, 1);
  }
  px(g, m?.live ? '#59f08a' : '#8a8f98', x + 11, y + 1, 2, 1);
}

export function drawFurniture(g, f, now) {
  const x = f.x * T;
  const y = f.y * T;
  const t = now / 1000;
  switch (f.kind) {
    case 'plant':
      px(g, 'rgba(0,0,0,0.2)', x + 3, y + 14, 10, 2);
      px(g, '#b5651d', x + 4, y + 8, 8, 7);
      px(g, '#c97a2f', x + 3, y + 7, 10, 2);
      px(g, '#9a5418', x + 4, y + 13, 8, 2);
      px(g, '#2f7d3a', x + 2, y - 4, 12, 11);
      px(g, '#3f9b48', x + 3, y - 6, 10, 9);
      px(g, '#3f9b48', x + 6, y - 10, 4, 5);
      px(g, '#5cc164', x + 4, y - 4, 3, 3);
      px(g, '#5cc164', x + 9, y - 1, 3, 3);
      px(g, '#5cc164', x + 7, y - 9, 2, 2);
      break;
    case 'printer':
      px(g, 'rgba(0,0,0,0.2)', x + 1, y + 13, 15, 3);
      px(g, '#7a7f8c', x + 2, y + 6, 13, 8);
      px(g, '#d9dce4', x + 1, y + 1, 14, 7);
      px(g, '#c4c8d2', x + 1, y + 6, 14, 2);
      px(g, '#ffffff', x + 4, y - 1, 8, 3);
      px(g, Math.floor(t) % 4 === 0 ? '#59f08a' : '#2f8f55', x + 12, y + 3, 1, 1);
      break;
    case 'crac':
      px(g, '#e8ebf2', x + 1, y - 10, 14, 25);
      px(g, '#c9cfdb', x + 1, y - 10, 14, 2);
      for (let k = 0; k < 6; k++) px(g, '#b5bccb', x + 3, y - 6 + k * 3, 10, 1);
      px(g, '#59f08a', x + 12, y - 8, 1, 1);
      px(g, 'rgba(160,215,255,0.35)', x + 2, y + 15, 12, 1);
      break;
    case 'coffee':
      px(g, 'rgba(0,0,0,0.2)', x + 2, y + 14, 12, 2);
      px(g, '#3a3a46', x + 2, y - 7, 12, 22);
      px(g, '#4b4b58', x + 2, y - 7, 12, 2);
      px(g, '#c0c0c8', x + 4, y - 3, 8, 4);
      px(g, Math.floor(now / 700) % 2 ? '#ff5c5c' : '#7a2a2a', x + 11, y - 5, 1, 1);
      px(g, '#1d1d24', x + 5, y + 4, 6, 6);
      px(g, '#ffffff', x + 6, y + 7, 4, 3);
      px(g, 'rgba(255,255,255,0.5)', x + 7 + (Math.floor(t * 2) % 2), y + 5, 1, 2);
      break;
    case 'cooler':
      px(g, 'rgba(0,0,0,0.2)', x + 3, y + 14, 10, 2);
      px(g, '#9fd3ff', x + 4, y - 8, 8, 9);
      px(g, '#d6efff', x + 5, y - 7, 2, 6);
      px(g, '#e8e8ef', x + 3, y + 1, 10, 14);
      px(g, '#c9c9d4', x + 3, y + 12, 10, 3);
      px(g, '#5aa9ff', x + 6, y + 5, 2, 2);
      px(g, '#ff5c5c', x + 9, y + 5, 2, 2);
      break;
    case 'vending':
      px(g, 'rgba(0,0,0,0.25)', x + 1, y + 14, 15, 3);
      px(g, '#b83c3c', x + 1, y - 11, 14, 26);
      px(g, '#d65151', x + 1, y - 11, 14, 2);
      px(g, '#1d2233', x + 3, y - 8, 8, 16);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) px(g, ['#ffd166', '#5aa9ff', '#8bd17c', '#ff9ecf'][(r + k) % 4], x + 4 + k * 2, y - 7 + r * 4, 1, 2);
      px(g, 'rgba(160,215,255,0.25)', x + 3, y - 8, 2, 16);
      px(g, '#2b2b33', x + 12, y - 5, 2, 6);
      px(g, '#1d1d24', x + 4, y + 10, 8, 3);
      break;
    case 'arcade': {
      px(g, 'rgba(0,0,0,0.25)', x + 1, y + 14, 15, 3);
      px(g, '#4a3d8f', x + 2, y - 12, 12, 27);
      px(g, '#ff7ad9', x + 2, y - 12, 12, 3);
      px(g, '#111', x + 4, y - 7, 8, 7);
      const k = Math.floor(t * 4);
      px(g, ['#59f08a', '#ffd166', '#5aa9ff'][k % 3], x + 5 + (k % 5), y - 5 + (k % 3), 2, 2);
      px(g, '#ff5c5c', x + 5, y + 4, 2, 2);
      px(g, '#ffd166', x + 9, y + 4, 2, 2);
      px(g, '#3a2f70', x + 2, y + 2, 12, 1);
      break;
    }
    case 'rug':
      px(g, '#a85f38', x - 4, y - 2, f.w * T + 8, 2 * T + 4);
      px(g, '#c9774a', x - 3, y - 1, f.w * T + 6, 2 * T + 2);
      for (let k = 0; k < f.w * 2; k++) px(g, '#d98f60', x + k * 8, y + 13, 4, 4);
      px(g, '#e3a37a', x - 1, y + 1, f.w * T + 2, 1);
      px(g, '#e3a37a', x - 1, y + 2 * T - 1, f.w * T + 2, 1);
      break;
    case 'sofa': {
      const w = f.w * T;
      px(g, 'rgba(0,0,0,0.22)', x, y + 12, w, 3);
      px(g, '#3f4fb3', x, y - 6, w, 9);
      px(g, '#4a5cc9', x + 2, y - 5, w - 4, 6);
      px(g, '#5b6ee1', x, y + 2, w, 10);
      px(g, '#6d80ef', x + 4, y + 2, w - 8, 1);
      px(g, '#4f62d4', x + T, y + 2, 1, 9);
      px(g, '#4f62d4', x + 2 * T, y + 2, 1, 9);
      px(g, '#3f4fb3', x, y - 2, 4, 14);
      px(g, '#3f4fb3', x + w - 4, y - 2, 4, 14);
      px(g, '#ffd166', x + 5, y - 3, 5, 4); // cushion
      px(g, '#2f3a85', x + 1, y + 12, 2, 2);
      px(g, '#2f3a85', x + w - 3, y + 12, 2, 2);
      break;
    }
    case 'table':
      px(g, 'rgba(0,0,0,0.2)', x + 1, y + 12, 14, 3);
      px(g, '#7a5a3e', x + 2, y + 9, 2, 5);
      px(g, '#7a5a3e', x + 12, y + 9, 2, 5);
      px(g, '#a47d57', x + 1, y + 4, 14, 6);
      px(g, '#b98f66', x + 1, y + 4, 14, 1);
      px(g, '#ffffff', x + 4, y + 5, 3, 2);
      px(g, '#e86a5a', x + 10, y + 5, 2, 2);
      break;
    case 'beanbag':
      px(g, 'rgba(0,0,0,0.2)', x + 1, y + 12, 14, 3);
      px(g, '#c9892d', x + 1, y + 4, 14, 10);
      px(g, '#e0a43a', x + 2, y + 2, 12, 9);
      px(g, '#f0bd5c', x + 4, y + 3, 5, 2);
      break;
    default:
  }
}

// ---------------------------------------------------------------- lighting

/** Night: dim the room, then add glow from monitors, lamps and racks. */
export function drawNight(g, L, glows) {
  g.fillStyle = 'rgba(14,18,48,0.38)';
  g.fillRect(0, 0, L.w * T, (L.h - 1) * T);
  g.fillStyle = 'rgba(14,18,48,0.25)';
  g.fillRect(0, (L.h - 1) * T, L.w * T, T);
  g.globalCompositeOperation = 'lighter';
  for (const gl of glows) {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = gl.color.replace('ALPHA', String(gl.a / (i + 1)));
      g.fillRect(gl.x - i * 4, gl.y - i * 3, gl.w + i * 8, gl.h + i * 6);
    }
  }
  g.globalCompositeOperation = 'source-over';
}

export function stateRgba(state) {
  const hex = (STATE[state] || STATE.idle).color;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},ALPHA)`;
}

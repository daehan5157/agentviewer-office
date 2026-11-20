// Office floor plan: desks on the left, MCP server room + lounge on the
// right, six entrance doors (one per channel) on the bottom wall.
import { DOORS } from './meta.js';

export const T = 16;
const TOP = 3; // tall back wall: windows, TV, posters
const SLOT_W = 4;
const SLOT_H = 4; // desk row, seat row, two aisle rows (room for name tags + bubbles)
const SIDE_W = 7;
const RACK_COLS = 3;

/**
 * floor legend: w wood · s server room · c carpet · W wall · D door · o outside
 * block: 0 free · 1 solid · 2 seat (only enterable as a destination)
 */
export function buildLayout(nSlots, nRacks) {
  const cols = Math.max(4, Math.min(7, Math.ceil(Math.sqrt(Math.max(1, nSlots) * 1.6))));
  const rows = Math.max(2, Math.ceil(nSlots / cols));
  const deskW = cols * SLOT_W;
  const rackRows = Math.max(1, Math.ceil(nRacks / RACK_COLS));
  const serverH = rackRows * 3;
  const loungeH = 5;
  const interiorH = Math.max(rows * SLOT_H + 1, serverH + loungeH);
  const w = 1 + deskW + 1 + SIDE_W + 1;
  const h = TOP + interiorH + 2; // + bottom wall + street
  const wallY = h - 2;
  const floor = [];
  const block = [];
  for (let y = 0; y < h; y++) {
    floor.push(new Array(w).fill('w'));
    block.push(new Uint8Array(w));
  }
  const solid = (x, y, v = 1) => {
    if (y >= 0 && y < h && x >= 0 && x < w) block[y][x] = v;
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < TOP; y++) {
      floor[y][x] = 'W';
      solid(x, y);
    }
    floor[wallY][x] = 'W';
    solid(x, wallY);
    floor[h - 1][x] = 'o';
    solid(x, h - 1); // street: only the spot in front of each door is walkable
  }
  for (let y = TOP; y < wallY; y++) {
    floor[y][0] = floor[y][w - 1] = 'W';
    solid(0, y);
    solid(w - 1, y);
  }

  // desks: a row of desks is a solid bench; the corridor on the right connects rows
  const slots = [];
  for (let i = 0; i < cols * rows; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x0 = 1 + c * SLOT_W;
    const y0 = TOP + 1 + r * SLOT_H;
    for (let k = 0; k < SLOT_W; k++) solid(x0 + k, y0);
    solid(x0 + 1, y0 + 1, 2);
    slots.push({ i, c, r, x0, y0, seat: { x: x0 + 1, y: y0 + 1 }, side: { x: x0 + 2, y: y0 + 1 }, seed: (i * 7919 + 13) % 97 });
  }

  // side zone: glass-walled server room on top, lounge below
  const sx = 2 + deskW;
  const ly = TOP + serverH;
  for (let y = TOP; y < wallY; y++) {
    for (let x = sx; x < w - 1; x++) {
      floor[y][x] = y < ly ? 's' : 'c';
      if (y < ly) solid(x, y);
    }
  }
  const racks = [];
  for (let k = 0; k < rackRows * RACK_COLS; k++) racks.push({ x: sx + 1 + (k % RACK_COLS) * 2, y: TOP + Math.floor(k / RACK_COLS) * 3 });

  const furniture = [];
  const put = (kind, x, y, wTiles = 1, blocking = 1) => {
    furniture.push({ kind, x, y, w: wTiles });
    for (let i = 0; i < wTiles; i++) if (blocking) solid(x + i, y, blocking);
  };
  put('crac', sx + 5 + 1, TOP, 1, 0);
  put('plant', sx, ly);
  put('vending', sx + 4, ly);
  put('coffee', sx + 5, ly);
  put('cooler', sx + 6, ly);
  put('rug', sx + 1, ly + 2, 3, 0);
  put('sofa', sx + 1, ly + 2, 3, 2);
  put('table', sx + 2, ly + 3);
  put('beanbag', sx + 5, ly + 2, 1, 2);
  put('arcade', sx + 6, ly + 3);
  put('plant', 1, TOP);
  put('printer', deskW, TOP);
  if (wallY - 1 > ly + 3) put('plant', sx, wallY - 1);

  const lounge = [
    { x: sx + 1, y: ly + 2, pose: 'sofa' },
    { x: sx + 3, y: ly + 2, pose: 'sofa' },
    { x: sx + 2, y: ly + 2, pose: 'sofa' },
    { x: sx + 5, y: ly + 2, pose: 'sofa' },
    { x: sx + 5, y: ly + 1, pose: 'stand', dir: 'up' },
    { x: sx + 6, y: ly + 4, pose: 'stand', dir: 'up' },
    { x: sx + 4, y: ly + 1, pose: 'stand', dir: 'up' },
    { x: sx + 6, y: ly + 1, pose: 'stand', dir: 'up' },
    { x: sx + 1, y: ly + 4, pose: 'stand', dir: 'right' },
    { x: sx + 3, y: ly + 4, pose: 'stand', dir: 'left' },
    { x: sx + 4, y: ly + 3, pose: 'stand', dir: 'left' },
  ].filter((p) => p.y < wallY && block[p.y][p.x] !== 1);

  // doors along the bottom wall, under the desk area
  const doors = {};
  const span = deskW + 1;
  DOORS.forEach((d, i) => {
    const x = Math.min(w - 2, Math.max(1, Math.round(1 + ((i + 0.5) * span) / DOORS.length)));
    floor[wallY][x] = 'D';
    block[wallY][x] = 0;
    block[h - 1][x] = 0;
    block[wallY - 1][x] = 0;
    doors[d] = { x, y: wallY, out: { x, y: h - 1 } };
  });

  return { w, h, top: TOP, cols, rows, deskW, sx, ly, wallY, serverH, floor, block, slots, racks, furniture, lounge, doors };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** BFS on the tile grid; seats are only enterable as the final step. */
export function findPath(L, sx, sy, gx, gy) {
  const { w, h, block } = L;
  sx = Math.max(0, Math.min(w - 1, sx));
  sy = Math.max(0, Math.min(h - 1, sy));
  if (sx === gx && sy === gy) return [];
  const start = sy * w + sx;
  const goal = gy * w + gx;
  const prev = new Int32Array(w * h).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      if (block[ny][nx] && ni !== goal) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % w, y: (c / w) | 0 });
  return path.reverse();
}

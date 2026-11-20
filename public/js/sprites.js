// Procedural pixel-art characters. Each frame is a 12×16 map that gets an
// automatic 1px outline, producing a 14×18 sprite.
import { hash } from './meta.js';

export const SW = 14;
export const SH = 18;

const HEAD_FRONT = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '.hhhhhhhhhh.',
  '.hhsssssshh.',
  '.hsessssesh.',
  '.hssssssssh.',
  '..ssssssss..',
  '....ssss....',
];
const HEAD_BACK = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '.hhhhhhhhhh.',
  '.hhhhhhhhhh.',
  '.hhhhhhhhhh.',
  '.hhhhhhhhhh.',
  '..hhhhhhhh..',
  '....ssss....',
];
const BODY = [
  '..tttttttt..',
  '.tttttttttt.',
  '.tttttttttt.',
  '.sTTTTTTTTs.',
  '..pppppppp..',
];
const LEGS = {
  stand: ['..ppp..ppp..', '..ppp..ppp..', '..bbb..bbb..'],
  a: ['..ppp..ppp..', '..ppp..bbb..', '..bbb.......'],
  b: ['..ppp..ppp..', '..bbb..ppp..', '.......bbb..'],
};
const SIDE = [
  '....hhhhh...',
  '...hhhhhhh..',
  '..hhhhhhhhh.',
  '..hhhhsssss.',
  '..hhhsssses.',
  '..hhssssss..',
  '...sssssss..',
  '.....ss.....',
  '....tttt....',
  '...tttttt...',
  '...tttttt...',
  '...TTTTTs...',
  '....pppp....',
];
const SIDE_LEGS = {
  stand: ['....pppp....', '....pppp....', '....bbbbb...'],
  a: ['...pp..pp...', '..pp....pp..', '.bb......bb.'],
  b: ['....pppp....', '....pppp....', '....bbbb....'],
};
const SIT_LEGS = ['..pppppppp..', '..pppppppp..', '..bb....bb..'];

const FRAMES = {
  front: [HEAD_FRONT.concat(BODY, LEGS.stand), HEAD_FRONT.concat(BODY, LEGS.a), HEAD_FRONT.concat(BODY, LEGS.b)],
  back: [HEAD_BACK.concat(BODY, LEGS.stand), HEAD_BACK.concat(BODY, LEGS.a), HEAD_BACK.concat(BODY, LEGS.b)],
  right: [SIDE.concat(SIDE_LEGS.stand), SIDE.concat(SIDE_LEGS.a), SIDE.concat(SIDE_LEGS.b)],
  // seated at a desk, seen from behind; elbows alternate while typing
  sitA: HEAD_BACK.concat(['..tttttttt..', 'stttttttttt.', '.tttttttttt.', '.TTTTTTTTTT.', '..pppppppp..'], SIT_LEGS),
  sitB: HEAD_BACK.concat(['..tttttttt..', '.tttttttttts', '.tttttttttt.', '.TTTTTTTTTT.', '..pppppppp..'], SIT_LEGS),
  // on the sofa, facing the viewer
  sofa: HEAD_FRONT.concat(BODY.slice(0, 4), SIT_LEGS, ['............']),
  sleep: HEAD_FRONT.map((r) => r.replace(/e/g, 'z')).concat(BODY.slice(0, 4), SIT_LEGS, ['............']),
};

// sanity check during development
for (const [k, f] of Object.entries(FRAMES)) {
  const list = Array.isArray(f[0]) ? f : [f];
  for (const rows of list) {
    if (rows.length !== 16 || rows.some((r) => r.length !== 12)) console.warn('bad sprite frame', k, rows);
  }
}

const SKIN = ['#f6d3b3', '#eac2a0', '#d9a47f', '#c48a62', '#8d5a3b', '#6b4430'];
const HAIR = ['#2b2b2b', '#4a3222', '#7a4b2a', '#c9893f', '#e8c46a', '#a33b3b', '#3b4fa3', '#d8d8d8', '#6b3fa0', '#1f4d3a'];
const PANTS = ['#2f3e5c', '#3a3a46', '#4b3b2f', '#24324a', '#3d4a3a', '#5a3d5c'];
const SHIRTS = {
  anthropic: ['#d97757', '#c15f3c', '#e39a74', '#b8573a'],
  openai: ['#10a37f', '#2f8f6f', '#4fbf96', '#1d7a5f'],
  google: ['#4285f4', '#7b61ff', '#34a0e0', '#5b6ee1'],
  other: ['#e05d9a', '#8a6dd8', '#e0a43a', '#5aa9e6', '#6bbf59', '#d65151', '#45b5aa'],
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

export function paletteFor(id, vendor = 'other', parentId = null) {
  const h = hash(id);
  const shirts = SHIRTS[vendor] || SHIRTS.other;
  const shirtSeed = parentId ? hash(parentId) : h >>> 3;
  const shirt = shirts[shirtSeed % shirts.length];
  const skin = SKIN[h % SKIN.length];
  return {
    h: HAIR[(h >>> 5) % HAIR.length],
    s: skin,
    z: shade(skin, 0.72),
    e: '#2a2238',
    t: parentId ? shade(shirt, 1.18) : shirt,
    T: shade(shirt, parentId ? 0.95 : 0.78),
    p: PANTS[(h >>> 9) % PANTS.length],
    b: '#2b2b33',
  };
}

/** The orchestrator dresses the part: royal-indigo coat, gold belt and boots, white hair. */
export function leadPalette(id) {
  const base = paletteFor(id, 'other');
  return { ...base, h: '#f4f1ff', t: '#5b3fd6', T: '#f2c14e', g: '#ffd75e', p: '#2a2050', b: '#8a5a1c' };
}

// ------------------------------------------------------------------ looks
// A look ({hair, skin, shirt, pants, accessory, accessoryColor}) from the 🎨 editor or a theme's outfit.

const ACC_COLORS = {
  cap: ['#d65151', '#a83c3c'],
  hardhat: ['#f2c230', '#c99a1c'],
  swimcap: ['#3b8fe0', '#2b6db0'],
  beanie: ['#6b3fa0', '#e8e0f0'],
  headphones: ['#2b2b33', '#e5484d'],
  glasses: ['#1b1726', '#1b1726'],
};

/** A palette with a look's colours applied (A/B are the accessory's colours). */
export function lookPalette(pal, look) {
  if (!look) return pal;
  const p = { ...pal };
  if (look.hair) p.h = look.hair;
  if (look.skin) {
    p.s = look.skin;
    p.z = shade(look.skin, 0.72);
  }
  if (look.shirt) {
    p.t = look.shirt;
    p.T = shade(look.shirt, 0.78);
  }
  if (look.pants) p.p = look.pants;
  const acc = ACC_COLORS[look.accessory];
  if (acc) {
    p.A = look.accessoryColor || acc[0];
    p.B = look.accessoryColor ? shade(look.accessoryColor, 0.78) : acc[1];
  }
  return p;
}

// accessory overlays on the 8 head rows: '.' keeps the pixel, A/B paint, '~' paints A over hair only
const OVERLAY = {
  cap: {
    front: ['...AAAAAA...', '..AAAAAAAA..', '..BBBBBBBB..'],
    back: ['...AAAAAA...', '..AAAAAAAA..', '.AAAAAAAAAA.'],
    side: ['....AAAAA...', '...AAAAAAA..', '..AAAAAABBBB'],
  },
  hardhat: {
    front: ['...AAAAAA...', '..AAAAAAAA..', 'BBBBBBBBBBBB'],
    back: ['...AAAAAA...', '..AAAAAAAA..', 'BBBBBBBBBBBB'],
    side: ['....AAAAA...', '...AAAAAAA..', '.BBBBBBBBBBB'],
  },
  swimcap: { front: ['~~~~~~~~~~~~', '~~~~~~~~~~~~', '~~~~~~~~~~~~', '~~~~~~~~~~~~'], back: Array(7).fill('~~~~~~~~~~~~'), side: Array(7).fill('~~~~~~~~~~~~') },
  beanie: {
    front: ['...AAAAAA...', '..AAAAAAAA..', '.BBBBBBBBBB.'],
    back: ['...AAAAAA...', '..AAAAAAAA..', '.BBBBBBBBBB.'],
    side: ['....AAAAA...', '...AAAAAAA..', '..BBBBBBBBB.'],
  },
  headphones: {
    front: ['...AAAAAA...', '..A......A..', '.A........A.', 'BB........BB', 'BB........BB'],
    back: ['...AAAAAA...', '..A......A..', '.A........A.', 'BB........BB', 'BB........BB'],
    side: ['....AAAAA...', '....A.......', '....A.......', '...BB.......', '...BB.......'],
  },
  glasses: { front: ['', '', '', '', '..B.BBBB.B..'], side: ['', '', '', '', '.....BBBB.B.'] },
};

function wear(rows, accessory, view) {
  const ov = OVERLAY[accessory]?.[view];
  if (!ov) return rows;
  return rows.map((r, y) => {
    const o = ov[y];
    if (!o || y > 7) return r;
    let out = '';
    for (let x = 0; x < r.length; x++) {
      const c = o[x];
      out += !c || c === '.' ? r[x] : c === '~' ? (r[x] === 'h' ? 'A' : r[x]) : c;
    }
    return out;
  });
}

// gold epaulettes on the shoulders (first coat row): '..tttttttt..' → '..gttttttg..'
const epaulettes = (rows) => rows.map((r, y) => (y === 8 ? r.replace(/t/, 'g').replace(/t(?=[^t]*$)/, 'g') : r));

function paint(rows, pal, outline, flip = false) {
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const g = c.getContext('2d');
  const filled = new Uint8Array(SW * SH);
  rows.forEach((row, y) => {
    for (let x = 0; x < 12; x++) {
      const ch = row[flip ? 11 - x : x];
      if (ch === '.' || !pal[ch]) continue;
      g.fillStyle = pal[ch];
      g.fillRect(x + 1, y + 1, 1, 1);
      filled[(y + 1) * SW + x + 1] = 1;
    }
  });
  g.fillStyle = outline;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      if (filled[y * SW + x]) continue;
      const n = (dx, dy) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < SW && ny < SH && filled[ny * SW + nx];
      };
      if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** All frames for one character, with a normal and a highlighted outline. */
export function makeSprites(pal, lead = false, accessory = null) {
  const acc = pal.A ? accessory : null; // an accessory needs its colours in the palette (lookPalette)
  const fx = lead ? epaulettes : (rows) => rows;
  const p = (rows, outline, flip, view) => paint(fx(acc ? wear(rows, acc, view) : rows), pal, outline, flip);
  const build = (outline) => ({
    front: FRAMES.front.map((f) => p(f, outline, false, 'front')),
    back: FRAMES.back.map((f) => p(f, outline, false, 'back')),
    right: FRAMES.right.map((f) => p(f, outline, false, 'side')),
    left: FRAMES.right.map((f) => p(f, outline, true, 'side')),
    sitA: p(FRAMES.sitA, outline, false, 'back'),
    sitB: p(FRAMES.sitB, outline, false, 'back'),
    sofa: p(FRAMES.sofa, outline, false, 'front'),
    sleep: p(FRAMES.sleep, outline, false, 'front'),
  });
  return { normal: build('#241c30'), hi: build('#ffe066') };
}

// a 6×4 gold crown with a ruby, drawn just above the head
const CROWN = ['G.GG.G', 'GGGGGG', 'GGRRGG', 'DDDDDD'];
const CROWN_COLORS = { G: '#ffd75e', R: '#e5484d', D: '#b8862b' };

/** Crown + gold aura + twinkles for the orchestrator (low-res pixels, drawn around the sprite). */
export function drawLeadFx(g, px, py, now, { sitting = false, side = false, layer = 'top' } = {}) {
  const t = now / 1000;
  // aura on the floor (under the sprite): a pulsing ring of gold pixels
  if (layer === 'floor') {
    if (sitting) {
      // seated (the chair hides the coat): a soft pulsing gold halo behind the whole figure
      const pulse = 0.18 + 0.12 * Math.sin(t * 3);
      g.fillStyle = `rgba(255,215,94,${pulse.toFixed(3)})`;
      g.fillRect(px - 2, py - 4, SW + 4, SH + 6);
      g.fillStyle = `rgba(255,215,94,${(pulse * 1.6).toFixed(3)})`;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        g.fillRect(Math.round(px + SW / 2 + Math.cos(a) * 10), Math.round(py + SH / 2 - 1 + Math.sin(a) * 12), 1, 1);
      }
      return;
    }
    const cx = px + SW / 2;
    const cy = py + SH - 1;
    const pulse = 0.35 + 0.25 * Math.sin(t * 3);
    g.fillStyle = `rgba(255,215,94,${pulse.toFixed(3)})`;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * 9), Math.round(cy + Math.sin(a) * 3), 1, 1);
    }
    return;
  }
  // crown, bobbing a pixel now and then
  const bob = Math.sin(t * 2.2) > 0.85 ? -1 : 0;
  const ox = px + (side ? 5 : 4);
  const oy = py - 3 + bob;
  CROWN.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = CROWN_COLORS[row[x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  });
  // two twinkles orbiting the crown
  for (let i = 0; i < 2; i++) {
    const a = t * 1.6 + i * Math.PI;
    const sx = Math.round(px + SW / 2 + Math.cos(a) * 9);
    const sy = Math.round(py + 1 + Math.sin(a) * 4);
    const on = (Math.sin(t * 5 + i * 2) + 1) / 2;
    g.fillStyle = `rgba(255,248,200,${(0.4 + 0.6 * on).toFixed(3)})`;
    g.fillRect(sx, sy, 1, 1);
    if (on > 0.6) {
      g.fillRect(sx - 1, sy, 1, 1);
      g.fillRect(sx + 1, sy, 1, 1);
      g.fillRect(sx, sy - 1, 1, 1);
      g.fillRect(sx, sy + 1, 1, 1);
    }
  }
}

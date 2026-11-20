// How the office looks on this PC: the chosen theme, the themes available (built-in ones in
// public/themes, and the user's own — often written by their AI agent — in ~/.agentviewer/themes),
// and per-character looks (keyed by agent name). Stored in ~/.agentviewer/look.json.
//
// Theme files are data, possibly written by an agent: everything is checked and anything
// unknown is dropped (colours must be #rrggbb, pixel art has size limits), and the page only
// ever paints them with fillRect.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOOK_DIR = path.join(os.homedir(), '.agentviewer');
export const BUILTIN_THEMES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'themes');
export const THEME_SPEC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'theme-spec.md');

export const PATTERNS = ['planks', 'tiles', 'checker', 'carpet', 'grass', 'water', 'dirt', 'concrete'];
export const ACCESSORIES = ['none', 'cap', 'hardhat', 'swimcap', 'beanie', 'headphones', 'glasses'];
const LAYERS = ['floor', 'wall', 'outside'];

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const hexList = (v, max) => (Array.isArray(v) ? v.map(hex).filter(Boolean).slice(0, max) : undefined);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : undefined);
const prune = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined || (typeof o[k] === 'object' && o[k] && !Array.isArray(o[k]) && !Object.keys(o[k]).length)) delete o[k];
  return o;
};
const colorsOf = (obj, keys) => (obj && typeof obj === 'object' ? prune(Object.fromEntries(keys.map((k) => [k, hex(obj[k])]))) : undefined);

export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** A checked copy of one character look ({hair, skin, shirt, pants, accessory, accessoryColor}). */
export function cleanLook(o) {
  if (!o || typeof o !== 'object') return null;
  const l = prune({
    hair: hex(o.hair), skin: hex(o.skin), shirt: hex(o.shirt), pants: hex(o.pants),
    accessory: ACCESSORIES.includes(o.accessory) ? o.accessory : undefined,
    accessoryColor: hex(o.accessoryColor),
  });
  return Object.keys(l).length ? l : null;
}

function cleanProp(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.pixels)) return null;
  const rows = p.pixels.filter((r) => typeof r === 'string').slice(0, 48).map((r) => r.slice(0, 48));
  if (!rows.length) return null;
  const colors = {};
  for (const [k, v] of Object.entries(p.colors || {})) if (/^[A-Za-z0-9]$/.test(k) && hex(v)) colors[k] = hex(v);
  if (!Object.keys(colors).length) return null;
  return prune({
    pixels: rows,
    colors,
    layer: LAYERS.includes(p.layer) ? p.layer : 'floor',
    x: num(p.x, 0, 1) ?? 0.5,
    y: num(p.y, 0, 1) ?? 0.5,
    scale: Math.round(num(p.scale, 1, 4) ?? 1),
    repeat: Math.round(num(p.repeat, 1, 30) ?? 1),
    gap: num(p.gap, 0, 1) ?? 0.1,
  });
}

// pixel art: rows of one-character cells, a colour per character ('.' and unknown = transparent)
function cleanArt(a, maxW, maxH) {
  if (!a || typeof a !== 'object' || !Array.isArray(a.pixels)) return null;
  const rows = a.pixels.filter((r) => typeof r === 'string').slice(0, maxH).map((r) => r.slice(0, maxW));
  const colors = {};
  for (const [k, v] of Object.entries(a.colors || {})) if (/^[A-Za-z0-9]$/.test(k) && hex(v)) colors[k] = hex(v);
  return rows.length && Object.keys(colors).length ? { pixels: rows, colors } : null;
}

const int = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : undefined);

/** the theme's own desk (with where the agent's status screen goes) and chair, instead of the office ones */
function cleanWorkstation(w) {
  if (!w || typeof w !== 'object') return undefined;
  const desk = cleanArt(w.desk, 64, 40);
  if (desk && w.desk.screen && typeof w.desk.screen === 'object') {
    const s = w.desk.screen;
    const sc = { x: int(s.x, 0, 63), y: int(s.y, 0, 39), w: int(s.w, 4, 40), h: int(s.h, 3, 30) };
    if (Object.values(sc).every((v) => v !== undefined)) desk.screen = sc;
  }
  const chair = cleanArt(w.chair, 24, 28);
  if (chair && Array.isArray(w.chair.front)) chair.front = w.chair.front.filter((r) => typeof r === 'string').slice(0, 28).map((r) => r.slice(0, 24));
  return prune({ desk: desk || undefined, chair: chair || undefined, noChair: w.chair === 'none' ? true : undefined });
}

/** A checked copy of a theme; unknown keys and bad values are dropped. */
export function cleanTheme(t, id) {
  if (!t || typeof t !== 'object') return null;
  const floor = t.floor && typeof t.floor === 'object'
    ? prune({ pattern: PATTERNS.includes(t.floor.pattern) ? t.floor.pattern : undefined, colors: hexList(t.floor.colors, 6), line: hex(t.floor.line) })
    : undefined;
  if (floor?.colors && !floor.colors.length) delete floor.colors;
  return prune({
    id,
    name: text(t.name, 30) || id,
    icon: text(t.icon, 4),
    description: text(t.description, 120),
    floor,
    wall: colorsOf(t.wall, ['paper', 'stripe', 'panel', 'panelLine', 'top', 'trim', 'base']),
    windows: t.windows && typeof t.windows === 'object'
      ? prune({ show: typeof t.windows.show === 'boolean' ? t.windows.show : undefined, frame: hex(t.windows.frame), sill: hex(t.windows.sill) })
      : undefined,
    lounge: hexList(t.lounge, 3),
    sideWall: hexList(t.sideWall, 3),
    bottomWall: hexList(t.bottomWall, 3),
    outside: colorsOf(t.outside, ['sidewalk', 'grass', 'grass2']),
    props: Array.isArray(t.props) ? t.props.slice(0, 80).map(cleanProp).filter(Boolean) : undefined,
    workstation: cleanWorkstation(t.workstation),
    outfit: cleanLook(t.outfit) || undefined,
  });
}

export class Look {
  constructor({ dir = LOOK_DIR, builtin = BUILTIN_THEMES } = {}) {
    this.dir = dir;
    this.builtin = builtin;
    this.themesDir = path.join(dir, 'themes');
    this.file = path.join(dir, 'look.json');
  }

  async state() {
    try {
      const j = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const chars = {};
      for (const [name, l] of Object.entries(j.chars || {})) {
        const c = cleanLook(l);
        if (c && name.length <= 80) chars[name] = c;
      }
      return { theme: typeof j.theme === 'string' ? j.theme : 'office', chars };
    } catch {
      return { theme: 'office', chars: {} };
    }
  }

  async save(st) {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(st, null, 2)}\n`);
    await fsp.rename(tmp, this.file);
  }

  /** [{ id, name, icon, description, mine }] — the user's own override built-ins of the same id */
  async themes() {
    const out = new Map();
    for (const [dir, mine] of [[this.builtin, false], [this.themesDir, true]]) {
      let files = [];
      try {
        files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).slice(0, 100);
      } catch {}
      for (const f of files) {
        const id = slugify(f.slice(0, -5));
        if (!id) continue;
        const t = await this.readTheme(path.join(dir, f), id);
        if (t) out.set(id, { id, name: t.name, icon: t.icon || '', description: t.description || '', mine });
      }
    }
    return [...out.values()];
  }

  async readTheme(file, id) {
    try {
      const st = await fsp.stat(file);
      if (st.size > 256 * 1024) return null;
      return cleanTheme(JSON.parse(await fsp.readFile(file, 'utf8')), id);
    } catch {
      return null;
    }
  }

  async theme(id) {
    const s = slugify(id);
    if (!s) return null;
    return (await this.readTheme(path.join(this.themesDir, `${s}.json`), s)) || this.readTheme(path.join(this.builtin, `${s}.json`), s);
  }

  /** A cheap fingerprint: changes when look.json or any theme file changes (pages poll it). */
  version() {
    let v = '';
    for (const p of [this.file, this.themesDir]) {
      try {
        v += `${fs.statSync(p).mtimeMs}:`;
      } catch {
        v += '0:';
      }
    }
    try {
      for (const f of fs.readdirSync(this.themesDir)) v += `${f}@${fs.statSync(path.join(this.themesDir, f)).mtimeMs};`;
    } catch {}
    let h = 0;
    for (let i = 0; i < v.length; i++) h = (h * 31 + v.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /** What to type to an agent so it makes a theme file for `idea` (e.g. "공사장"). */
  themePrompt(idea) {
    const id = slugify(idea) || 'my-theme';
    const out = path.join(this.themesDir, `${id}.json`);
    return [
      `Agentviewer 대시보드의 사무실 배경 테마를 하나 만들어 줘. 주제: "${idea}"`,
      `- 형식 설명서: ${THEME_SPEC}`,
      `- 참고 예시: ${path.join(this.builtin, 'construction.json')}, ${path.join(this.builtin, 'pool.json')}`,
      `- 결과는 JSON 파일 하나로 ${out} 에 저장해 줘 (폴더가 없으면 만들고, 다른 파일은 건드리지 마).`,
      `- 바닥·벽·창문 색과 바닥 무늬를 주제에 맞게 고르고, 주제를 살리는 픽셀 소품(props)을 5~15개 그려 줘.`,
      `- 사무실 책상·의자가 어색한 주제라면 workstation 으로 주제에 맞는 책상(상태 화면 자리 포함)과 의자 픽셀 그림도 그려 줘.`,
      `- 저장하면 대시보드의 꾸미기 > 테마 목록에 바로 나타나. 다 되면 파일 경로만 알려 줘.`,
    ].join(' '); // one line: a newline typed into an agent's terminal would submit early
  }
}

import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

/** Collapse whitespace and truncate to n characters. */
export function oneLine(s, n = 80) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Last path segment, works for / and \ separators. */
export function base(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export async function readdirSafe(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Turn a raw user message from a transcript into a readable task line.
 * Strips system reminders and wrapper tags; returns '' for messages that are
 * not real requests (command output, caveats, hook feedback, ...).
 */
export function cleanPrompt(text) {
  let t = String(text ?? '');
  const cmd = t.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/);
  if (cmd) {
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const name = cmd[1].startsWith('/') ? cmd[1] : `/${cmd[1]}`;
    return oneLine(`${name} ${args ? args[1] : ''}`, 400);
  }
  t = t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<\/?(command-message|user-prompt-submit-hook)[^>]*>/g, ' ')
    .trim();
  if (!t) return '';
  if (/^(<local-command-|<bash-(input|stdout|stderr)>|Caveat:|<task-notification>|<environment_context>|<user_instructions>)/.test(t)) {
    return '';
  }
  return oneLine(t, 400);
}

export function addUnique(arr, v) {
  if (v && !arr.includes(v)) arr.push(v);
  return arr;
}

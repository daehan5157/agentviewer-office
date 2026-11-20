// "How did this agent come in?"  Every agent gets a channel label and one of
// six office doors it walks in through.
export const DOORS = ['cli', 'ide', 'app', 'api', 'mcp', 'cloud'];

const ch = (channel, door) => ({ channel, door });

/** Claude Code transcript `entrypoint` field. */
export function claudeEntry(entrypoint) {
  const e = String(entrypoint || '').toLowerCase();
  if (!e || e === 'cli') return ch('CLI', 'cli');
  if (e.includes('jetbrains')) return ch('JetBrains', 'ide');
  if (e.includes('vscode') || e.includes('cursor') || e.includes('ide')) return ch('VS Code', 'ide');
  if (e.includes('remote') || e.includes('web') || e.includes('cloud')) return ch('클라우드', 'cloud');
  if (e.includes('desktop')) return ch('Desktop 앱', 'app');
  if (e.includes('action') || e.includes('github')) return ch('GitHub Actions', 'cloud');
  if (e.includes('mcp')) return ch('MCP', 'mcp');
  if (e.includes('sdk')) return ch(e.includes('py') ? 'SDK (Python)' : e.includes('ts') ? 'SDK (TS)' : 'SDK', 'api');
  return ch(entrypoint, 'cli');
}

/** Codex rollout `session_meta.source` / `originator`. */
export function codexSource(source, originator) {
  const s = typeof source === 'string' ? source.toLowerCase() : source && typeof source === 'object' ? Object.keys(source)[0]?.toLowerCase() : '';
  const o = String(originator || '').toLowerCase();
  if (s === 'vscode' || o.includes('vscode')) return ch('VS Code', 'ide');
  if (s === 'exec' || o.includes('exec')) return ch('exec (자동화)', 'api');
  if (s === 'mcp' || o.includes('mcp')) return ch('MCP', 'mcp');
  if (s === 'subagent') return ch('하위 에이전트', 'api');
  if (o.includes('cloud') || s === 'cloud') return ch('클라우드', 'cloud');
  return ch('CLI', 'cli');
}

/** Free-form channel text from the HTTP API / MCP bridge → door. */
export function doorFor(channel, fallback = 'api') {
  const c = String(channel || '').toLowerCase();
  if (!c) return fallback;
  if (DOORS.includes(c)) return c;
  if (/mcp/.test(c)) return 'mcp';
  if (/code|cursor|ide|jetbrains|windsurf|zed|vim|emacs/.test(c)) return 'ide';
  if (/desktop|app|앱/.test(c)) return 'app';
  if (/cloud|remote|action|ci|클라우드/.test(c)) return 'cloud';
  if (/cli|terminal|shell|tty/.test(c)) return 'cli';
  return fallback;
}

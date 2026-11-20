export const STATE = {
  thinking: { label: '생각 중', color: '#b48cff', icon: '💭' },
  typing: { label: '코드 작성', color: '#5aa9ff', icon: '✏️' },
  reading: { label: '읽는 중', color: '#3fd0c9', icon: '🔍' },
  running: { label: '명령 실행', color: '#6bdc6b', icon: '⌨️' },
  web: { label: '웹 검색', color: '#4fc3f7', icon: '🌐' },
  mcp: { label: 'MCP 호출', color: '#ff7ad9', icon: '🔌' },
  delegating: { label: '위임 중', color: '#ffa94d', icon: '👥' },
  planning: { label: '계획 중', color: '#ffd166', icon: '📋' },
  waiting: { label: '응답 대기', color: '#ff5c5c', icon: '❗' },
  done: { label: '완료·대기', color: '#8bd17c', icon: '✅' },
  idle: { label: '휴식', color: '#8a8f98', icon: '💤' },
  error: { label: '오류', color: '#ff5c5c', icon: '⚠️' },
};

export const DOORS = ['cli', 'ide', 'app', 'api', 'mcp', 'cloud'];
export const DOOR = {
  cli: { label: 'CLI', color: '#6bdc6b', desc: '터미널 CLI' },
  ide: { label: 'IDE', color: '#5aa9ff', desc: 'VS Code · JetBrains · Cursor' },
  app: { label: '앱', color: '#ffa94d', desc: '데스크톱 앱 · Orca 같은 오케스트레이터' },
  api: { label: 'SDK·API', color: '#b48cff', desc: 'SDK · HTTP API · 자동화' },
  mcp: { label: 'MCP', color: '#ff7ad9', desc: 'MCP 브리지로 접속' },
  cloud: { label: '클라우드', color: '#4fc3f7', desc: '원격 · 클라우드 세션' },
};

export const VIA = { transcript: '세션 기록', process: '프로세스', mcp: 'MCP 브리지', api: 'HTTP API', orca: 'Orca CLI', demo: '데모' };
export const VENDOR = { anthropic: '#d97757', openai: '#10a37f', google: '#4285f4', other: '#9aa0aa' };
export const ACTIVE = new Set(['thinking', 'typing', 'reading', 'running', 'web', 'mcp', 'delegating', 'planning', 'waiting']);
export const PRIORITY = { waiting: 0, typing: 1, running: 1, reading: 1, web: 1, mcp: 1, delegating: 1, planning: 1, thinking: 1, done: 2, idle: 3 };

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${s % 60}초`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

export function clock(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** "MCP › github › create_issue" → "github" */
export function mcpServerOf(path) {
  const p = String(path || '').split(' › ');
  return p[0] === 'MCP' && p[1] ? p[1] : null;
}

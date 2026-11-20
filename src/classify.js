// Maps a tool call from any agent (Claude Code, Codex, Gemini CLI, custom) to
// a visual state plus a "path" string that says HOW the work is being done:
//   도구 › Edit        built-in tool of the agent
//   CLI › npm test     shell / command line
//   MCP › github › …   an MCP server tool
//   Web › host         web fetch / search
//   하위 에이전트 › …   delegated to a sub-agent
import { oneLine, base } from './util.js';

export const STATES = [
  'thinking', 'typing', 'reading', 'running', 'web', 'mcp',
  'delegating', 'planning', 'waiting', 'done', 'idle',
];

const READ_BINS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'rg', 'grep', 'egrep', 'ag', 'ack', 'find', 'fd', 'ls', 'tree',
  'wc', 'bat', 'stat', 'file', 'nl', 'du', 'pwd', 'which', 'realpath', 'readlink', 'diff', 'jq',
]);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'branch', 'rev-parse', 'remote']);
const SUBCOMMAND_BINS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'bunx', 'git', 'cargo', 'go', 'uv', 'uvx', 'pip', 'pip3', 'docker',
  'kubectl', 'gh', 'make', 'poetry', 'deno', 'dotnet', 'mvn', 'gradle', 'terraform', 'brew', 'swift', 'xcodebuild', 'orca', 'orca-ide',
]);
const PREFIX_WORDS = new Set(['sudo', 'time', 'env', 'nice', 'command', 'exec', 'nohup', 'timeout']);

function firstSegment(cmd) {
  // Drop leading `cd dir &&` hops, keep the first real command of a pipeline.
  const segs = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  for (const s of segs) {
    if (/^cd\s/.test(s) || s === 'cd') continue;
    if (/^(set|export|source|\.)\s/.test(s)) continue;
    return s;
  }
  return segs[0] || cmd;
}

export function shellBin(cmd) {
  const seg = firstSegment(String(cmd || '').trim());
  const words = seg.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && (PREFIX_WORDS.has(words[i]) || /^[A-Z_][A-Z0-9_]*=/.test(words[i]) || (words[i - 1] === 'timeout' && /^\d/.test(words[i])))) i++;
  const bin = base(words[i] || '').replace(/^["']|["']$/g, '');
  if (!bin) return { bin: '', sub: '' };
  let sub = '';
  if (SUBCOMMAND_BINS.has(bin)) {
    const next = words.slice(i + 1).find((w) => !w.startsWith('-'));
    if (next) sub = base(next);
  } else if (/^python[\d.]*$/.test(bin) && words[i + 1] === '-m' && words[i + 2]) {
    sub = `-m ${words[i + 2]}`;
  }
  return { bin, sub };
}

export function classifyShell(command, tool = 'Bash') {
  let cmd = command;
  if (Array.isArray(cmd)) {
    cmd = cmd.length >= 3 && /(^|\/)(ba|z|da)?sh$/.test(cmd[0]) && /^-l?c$/.test(cmd[1]) ? cmd[2] : cmd.join(' ');
  }
  cmd = String(cmd ?? '');
  const { bin, sub } = shellBin(cmd);
  const writes = /(^|[^>])>{1,2}\s*[^&\s]/.test(cmd) || /\bsed\s+-i\b/.test(cmd) || /\btee\b/.test(cmd);
  let reading = !writes && (READ_BINS.has(bin) || (bin === 'git' && GIT_READ.has(sub)) || (bin === 'sed' && /\s-n\b/.test(cmd)));
  if (bin === 'find' && /-delete|-exec/.test(cmd)) reading = false;
  const label = sub ? `${bin} ${sub}` : bin || 'shell';
  return {
    state: reading ? 'reading' : 'running',
    kind: 'shell',
    tool,
    detail: `$ ${oneLine(cmd, 72)}`,
    path: `CLI › ${label}`,
  };
}

/** mcp__server__tool (Claude Code), server__tool (Codex/Gemini) */
export function parseMcpName(name, vendor = 'claude') {
  const n = String(name || '');
  let server;
  let tool;
  if (n.startsWith('mcp__')) {
    const parts = n.slice(5).split('__');
    server = parts[0];
    tool = parts.slice(1).join('__') || parts[0];
  } else if (vendor !== 'claude' && /^[\w.-]+__[\w.-]+/.test(n)) {
    const parts = n.split('__');
    server = parts[0];
    tool = parts.slice(1).join('__');
  } else {
    return null;
  }
  return { server: prettyServer(server), tool };
}

export function prettyServer(s) {
  const n = String(s || 'mcp');
  // plugin_<plugin>_<server> → <server>
  const m = n.match(/^plugin_[^_]+_(.+)$/);
  return m ? m[1] : n;
}

function argHint(input) {
  if (!input || typeof input !== 'object') return '';
  const v = input.query ?? input.q ?? input.title ?? input.name ?? input.path ?? input.url ?? input.repo ?? input.owner ?? input.raw;
  return typeof v === 'string' && v ? ` (${oneLine(v, 28)})` : '';
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return oneLine(url, 30);
  }
}

function patchFiles(text) {
  const files = [];
  const re = /\*\*\* (?:Update|Add|Delete) File: (.+)/g;
  let m;
  while ((m = re.exec(String(text || '')))) files.push(m[1].trim());
  return files;
}

const tool = (state, kind, name, detail, path) => ({ state, kind, tool: name, detail, path });

/**
 * @param {string} name   tool name as the agent reported it
 * @param {object|string} input  tool arguments (object or JSON string)
 * @param {'claude'|'codex'|'gemini'|string} vendor
 */
export function classifyTool(name = '', input = {}, vendor = 'claude') {
  if (typeof input === 'string') {
    const raw = input;
    try {
      input = JSON.parse(raw);
    } catch {
      input = null;
    }
    // previews such as Orca's toolInput ("src/app.ts", "npm test") are plain strings
    if (!input || typeof input !== 'object') input = { raw };
  }
  input = input && typeof input === 'object' ? input : {};
  const n = String(name || 'tool');

  const mcp = parseMcpName(n, vendor);
  if (mcp) {
    return {
      state: 'mcp', kind: 'mcp', tool: n, server: mcp.server,
      detail: `${mcp.server} › ${mcp.tool}${argHint(input)}`,
      path: `MCP › ${mcp.server} › ${mcp.tool}`,
    };
  }

  const raw = typeof input.raw === 'string' ? input.raw : '';
  const file = input.file_path ?? input.absolute_path ?? input.path ?? input.notebook_path ?? input.filename ?? (Array.isArray(input.paths) ? input.paths[0] : raw);
  const k = n.toLowerCase();
  switch (k) {
    case 'bash': case 'shell': case 'local_shell': case 'exec_command': case 'run_shell_command':
    case 'container.exec': case 'unified_exec': case 'powershell': case 'run_command': case 'terminal':
      return classifyShell(input.command ?? input.cmd ?? input.args ?? input.raw ?? '', n);
    case 'bashoutput': case 'monitor': case 'write_stdin': case 'read_output':
      return tool('running', 'shell', n, '실행 중인 명령 출력 확인', `CLI › ${n}`);
    case 'killshell': case 'killbash': case 'taskstop':
      return tool('running', 'shell', n, '실행 중인 명령 중지', `CLI › ${n}`);

    case 'read': case 'read_file': case 'notebookread': case 'view_image': case 'read_many_files': case 'view':
      return tool('reading', 'builtin', n, `Read ${base(file)}`.trim(), `도구 › ${n}`);
    case 'grep': case 'search_file_content': case 'grep_search': case 'codebase_search': case 'search':
      return tool('reading', 'builtin', n, `Grep "${oneLine(input.pattern ?? input.query ?? input.raw ?? '', 36)}"`, `도구 › ${n}`);
    case 'glob': case 'list_directory': case 'ls': case 'list_dir': case 'find_files':
      return tool('reading', 'builtin', n, `${n} ${oneLine(input.pattern ?? file ?? '', 36)}`.trim(), `도구 › ${n}`);
    case 'toolsearch': case 'listmcpresourcestool': case 'readmcpresourcetool':
      return tool('reading', 'builtin', n, `${n} ${oneLine(input.query ?? input.uri ?? '', 30)}`.trim(), `도구 › ${n}`);

    case 'edit': case 'multiedit': case 'notebookedit': case 'replace': case 'edit_file': case 'str_replace_based_edit_tool': case 'str_replace_editor':
      return tool('typing', 'builtin', n, `Edit ${base(file)}`.trim(), `도구 › ${n}`);
    case 'write': case 'write_file': case 'create_file':
      return tool('typing', 'builtin', n, `Write ${base(file)}`.trim(), `도구 › ${n}`);
    case 'apply_patch': {
      const files = patchFiles(input.input ?? input.patch ?? input.raw ?? '');
      const more = files.length > 1 ? ` 외 ${files.length - 1}개` : '';
      return tool('typing', 'builtin', n, `Patch ${base(files[0]) || '파일'}${more}`, `도구 › apply_patch`);
    }

    case 'webfetch': case 'web_fetch': case 'fetch': case 'browse':
      return tool('web', 'web', n, `Fetch ${hostOf(input.url ?? (raw || input.prompt) ?? '')}`, `Web › ${hostOf(input.url ?? raw) || 'fetch'}`);
    case 'websearch': case 'web_search': case 'google_web_search': case 'web_search_preview':
      return tool('web', 'web', n, `Search "${oneLine(input.query ?? input.raw ?? '', 40)}"`, 'Web › 검색');

    case 'task': case 'agent': case 'spawn_agent': case 'delegate': case 'dispatch_agent': {
      const type = input.subagent_type ?? input.agent_type ?? input.agent ?? 'general';
      const what = oneLine(input.description ?? input.prompt ?? raw, 48);
      return tool('delegating', 'agent', n, `Agent: ${type}${what ? ` · ${what}` : ''}`, `하위 에이전트 › ${type}`);
    }

    case 'todowrite': case 'update_plan': case 'write_todos': {
      const list = input.todos ?? input.plan ?? [];
      const todos = Array.isArray(list)
        ? list.map((t) => ({ content: oneLine(t.content ?? t.step ?? t.description ?? '', 90), status: t.status ?? 'pending', active: t.activeForm }))
        : null;
      const cur = todos?.find((t) => t.status === 'in_progress');
      const out = tool('planning', 'plan', n, cur ? `할 일: ${oneLine(cur.active || cur.content, 50)}` : '할 일 목록 갱신', `계획 › ${n}`);
      out.todos = todos;
      return out;
    }
    case 'taskcreate': case 'taskupdate': case 'tasklist': case 'taskget':
      return tool('planning', 'plan', n, `${n} ${oneLine(input.subject ?? input.status ?? '', 40)}`.trim(), `계획 › ${n}`);
    case 'exitplanmode': case 'enterplanmode':
      return tool('planning', 'plan', n, '계획 정리', `계획 › ${n}`);
    case 'save_memory': case 'memory':
      return tool('planning', 'plan', n, '메모리 저장', `도구 › ${n}`);
    case 'skill':
      return tool('planning', 'builtin', n, `Skill: ${oneLine(input.skill ?? input.name ?? '', 40)}`, `도구 › Skill`);

    case 'askuserquestion': case 'request_user_input': case 'ask_user': case 'ask_followup_question': {
      const q = input.questions?.[0]?.question ?? input.question ?? raw;
      return tool('waiting', 'ask', n, `질문: ${oneLine(q, 60) || '사용자 답변 대기'}`, '사용자 › 질문');
    }
    default:
      return tool('running', 'builtin', n, `${n}${argHint(input)}`, `도구 › ${n}`);
  }
}

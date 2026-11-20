// OpenAI Codex CLI / IDE: tails ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
import path from 'node:path';
import os from 'node:os';
import { Tailer } from '../tail.js';
import { Tracker } from '../tracker.js';
import { classifyTool } from '../classify.js';
import { codexSource } from '../channels.js';
import { base, cleanPrompt, readdirSafe, statSafe } from '../util.js';

const ITEM_TYPES = new Set([
  'message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output',
  'local_shell_call', 'local_shell_call_output', 'web_search_call',
]);
const CONTEXT_RE = /^\s*(<(environment_context|user_instructions|permissions|user_shell_command|turn_aborted|INSTRUCTIONS)\b|# AGENTS\.md)/i;

export class CodexScanner {
  constructor(store, opts = {}) {
    this.store = store;
    const home = opts.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.root = opts.root || path.join(home, 'sessions');
    this.windowMs = opts.windowMs ?? 60 * 60e3;
    this.extraRoots = opts.extraRoots || null; // async () => [sessions dirs] (e.g. Orca-managed CODEX_HOME)
    this.files = new Map();
    store.setScanner('codex', { name: 'Codex', root: this.root, files: 0, active: 0, lastScan: 0, error: null });
  }

  start() {
    (async () => {
      await this.discover();
      await this.poll();
    })();
    this.timers = [setInterval(() => this.discover(), 4000), setInterval(() => this.poll(), 800)];
  }

  stop() {
    for (const t of this.timers || []) clearInterval(t);
  }

  /** Rollouts live in date folders; only look at the last few days. */
  async listCandidates() {
    const out = [];
    const days = new Set();
    for (let i = 0; i < 3; i++) {
      const d = new Date(Date.now() - i * 86400e3);
      days.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
    }
    const roots = [this.root, ...((await this.extraRoots?.()) || [])];
    for (const root of roots) {
      for (const day of days) {
        const dir = path.join(root, ...day.split('/'));
        for (const e of await readdirSafe(dir)) if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(dir, e.name));
      }
      for (const e of await readdirSafe(root)) if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(root, e.name));
    }
    return out;
  }

  async discover() {
    if (this.discovering) return;
    this.discovering = true;
    try {
      const files = await this.listCandidates();
      for (const f of files) await this.consider(f);
      const exists = !!(await statSafe(this.root));
      this.store.setScanner('codex', { files: files.length, active: this.files.size, lastScan: Date.now(), error: exists ? null : '세션 폴더 없음 (Codex 미사용)' });
    } catch (err) {
      this.store.setScanner('codex', { error: err.message, lastScan: Date.now() });
    } finally {
      this.discovering = false;
    }
  }

  async consider(file) {
    if (this.files.has(file)) return;
    const st = await statSafe(file);
    if (!st || Date.now() - st.mtimeMs > this.windowMs) return;
    const m = base(file).match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
    const sid = m ? m[1] : base(file).replace(/\.jsonl$/, '');
    const id = `codex:${sid}`;
    const ctx = {
      file, id, sawEventUser: false, tailer: new Tailer(file),
      tracker: new Tracker(this.store, id, {
        name: 'codex', vendor: 'openai', client: 'Codex', via: 'transcript', channel: 'CLI', door: 'cli',
        sessionShort: sid.slice(0, 6), startedAt: st.birthtimeMs || st.mtimeMs,
      }),
    };
    this.files.set(file, ctx);
    ctx.tracker.lastEvent = st.mtimeMs;
    ctx.tracker.ensure();
    ctx.tracker.replaying = true;
    for (const line of await ctx.tailer.readInitial()) this.handle(ctx, line);
    ctx.tracker.replaying = false;
    ctx.tracker.tick();
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = Date.now();
      for (const ctx of [...this.files.values()]) {
        const lines = await ctx.tailer.readNew();
        if (lines === null) {
          this.files.delete(ctx.file);
          continue;
        }
        for (const line of lines) this.handle(ctx, line);
        ctx.tracker.tick(now);
        if (now - ctx.tailer.mtime > this.windowMs && !this.store.get(ctx.id)) this.files.delete(ctx.file);
      }
    } finally {
      this.polling = false;
    }
  }

  handle(ctx, raw) {
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      return;
    }
    if (!o || typeof o !== 'object') return;
    const tr = ctx.tracker;
    const ts = Date.parse(o.timestamp) || tr.lastEvent || Date.now();
    let type = o.type;
    let p = o.payload;
    if (!p && ITEM_TYPES.has(o.type)) {
      p = o; // legacy rollout format: bare response items
      type = 'response_item';
    } else if (!p && o.id && 'instructions' in o) {
      p = o;
      type = 'session_meta';
    }
    if (!p) return tr.touch(ts);
    switch (type) {
      case 'session_meta': {
        const cwd = p.cwd;
        tr.meta({
          ...codexSource(p.source, p.originator),
          cwd, project: base(cwd), name: base(cwd) || 'codex',
          branch: p.git?.branch, clientVersion: p.cli_version,
        });
        return tr.touch(ts);
      }
      case 'turn_context':
        if (p.model && p.model !== tr.base.model) tr.meta({ model: p.model });
        if (p.approval_policy) tr.mode = p.approval_policy === 'never' ? 'never' : p.approval_policy;
        return tr.touch(ts);
      case 'response_item':
        return this.onItem(ctx, p, ts);
      case 'event_msg':
        return this.onEvent(ctx, p, ts);
      default:
        return tr.touch(ts);
    }
  }

  onItem(ctx, p, ts) {
    const tr = ctx.tracker;
    switch (p.type) {
      case 'message': {
        const text = (Array.isArray(p.content) ? p.content : []).map((c) => c?.text || '').join('\n');
        if (p.role === 'user') {
          if (!ctx.sawEventUser && !CONTEXT_RE.test(text)) tr.prompt(cleanPrompt(text), ts);
          else tr.touch(ts);
        } else if (p.role === 'assistant') tr.say(text, ts);
        else tr.touch(ts);
        return;
      }
      case 'reasoning':
        return tr.thinking(ts);
      case 'function_call':
        return tr.toolStart(p.call_id || p.id, classifyTool(p.name, p.arguments, 'codex'), ts);
      case 'custom_tool_call':
        return tr.toolStart(p.call_id || p.id, classifyTool(p.name, p.input, 'codex'), ts);
      case 'local_shell_call':
        return tr.toolStart(p.call_id || p.id, classifyTool('local_shell', { command: p.action?.command }, 'codex'), ts);
      case 'web_search_call': {
        const id = p.id || `ws-${ts}`;
        tr.toolStart(id, classifyTool('web_search', { query: p.action?.query }, 'codex'), ts);
        tr.toolEnd(id, ts);
        return;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output':
        tr.toolEnd(p.call_id, ts);
        return;
      default:
        return tr.touch(ts);
    }
  }

  onEvent(ctx, p, ts) {
    const tr = ctx.tracker;
    switch (p.type) {
      case 'user_message': {
        ctx.sawEventUser = true;
        const t = cleanPrompt(p.message || '');
        if (t && !CONTEXT_RE.test(t)) tr.prompt(t, ts);
        else tr.touch(ts);
        return;
      }
      case 'agent_message':
        return tr.say(p.message, ts);
      case 'agent_reasoning':
      case 'agent_reasoning_raw_content':
        return tr.thinking(ts);
      case 'task_started':
        return tr.thinking(ts, '작업 시작');
      case 'task_complete':
        return tr.turnEnd(ts);
      case 'turn_aborted':
        return tr.turnEnd(ts, 'interrupted');
      case 'exec_approval_request':
      case 'apply_patch_approval_request':
        tr.set({ state: 'waiting', detail: '승인 대기', kind: 'ask' }, ts);
        tr.log(ts, '승인 요청', '사용자 › 승인', 'waiting');
        return;
      case 'mcp_tool_call_begin': {
        const inv = p.invocation || {};
        if (!tr.pending.has(p.call_id)) tr.toolStart(p.call_id, classifyTool(`mcp__${inv.server}__${inv.tool}`, inv.arguments, 'codex'), ts);
        return;
      }
      case 'exec_command_begin':
        if (!tr.pending.has(p.call_id)) tr.toolStart(p.call_id, classifyTool('shell', { command: p.command }, 'codex'), ts);
        return;
      case 'mcp_tool_call_end':
      case 'exec_command_end':
      case 'patch_apply_end':
        tr.toolEnd(p.call_id, ts);
        return;
      default:
        return tr.touch(ts);
    }
  }
}

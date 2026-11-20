// Turns a stream of transcript events (prompt, thinking, tool start/end,
// turn end) into agent state in the Store. Shared by the Claude Code and
// Codex scanners.
import { oneLine } from './util.js';

const TOOL_STATES = new Set(['typing', 'reading', 'running', 'web', 'mcp', 'delegating', 'planning', 'waiting']);
const AUTO_MODES = new Set(['bypassPermissions', 'auto', 'dontAsk', 'never']);

export class Tracker {
  constructor(store, id, base = {}) {
    this.store = store;
    this.id = id;
    this.base = base; // identity fields re-applied if the agent was evicted
    this.pending = new Map();
    this.lastEvent = 0;
    this.mode = null;
    this.replaying = false;
  }

  ensure() {
    if (!this.store.get(this.id)) {
      this.store.upsert(this.id, { ...this.base, lastActivity: this.lastEvent || Date.now() });
    }
  }

  meta(patch) {
    Object.assign(this.base, patch);
    this.ensure();
    this.store.upsert(this.id, patch);
  }

  set(patch, ts) {
    this.lastEvent = Math.max(this.lastEvent, ts || 0);
    this.ensure();
    this.store.upsert(this.id, { ...patch, lastActivity: ts, stateSince: ts });
  }

  log(ts, text, path = '', state = '') {
    this.ensure();
    this.store.activity(this.id, { t: ts, text, path, state });
  }

  touch(ts) {
    if (!ts) return;
    this.lastEvent = Math.max(this.lastEvent, ts);
    this.ensure();
    this.store.upsert(this.id, { lastActivity: ts });
  }

  prompt(text, ts, path = '사용자 › 요청') {
    if (!text) return this.touch(ts);
    this.pending.clear();
    this.set({ state: 'thinking', task: oneLine(text, 300), detail: '요청 분석 중', path, kind: 'prompt', finishedAt: null }, ts);
    this.log(ts, `요청: ${oneLine(text, 120)}`, path, 'thinking');
  }

  thinking(ts, detail = '생각 중') {
    if (this.pending.size) return this.touch(ts);
    this.set({ state: 'thinking', detail, path: '', kind: 'think' }, ts);
  }

  say(text, ts) {
    const t = oneLine(text, 80);
    if (this.pending.size || !t) return this.touch(ts);
    this.set({ state: 'thinking', detail: `답변 작성: ${t}`, path: '', kind: 'say', lastMessage: oneLine(text, 300) }, ts);
  }

  toolStart(callId, cls, ts) {
    this.pending.set(callId || `anon-${ts}-${this.pending.size}`, { cls, ts });
    this.set({ state: cls.state, detail: cls.detail, path: cls.path, kind: cls.kind }, ts);
    this.log(ts, cls.detail, cls.path, cls.state);
    if (cls.kind === 'mcp') this.store.pulse(this.id, cls.server, cls.tool, ts);
    if (cls.todos) this.store.upsert(this.id, { todos: cls.todos });
  }

  toolEnd(callId, ts, isError = false) {
    const p = this.pending.get(callId);
    if (p) this.pending.delete(callId);
    this.touch(ts);
    if (p && isError) this.log(ts, `실패: ${p.cls.detail}`, p.cls.path, 'error');
    return p;
  }

  turnEnd(ts, reason = 'done') {
    this.pending.clear();
    const detail = reason === 'interrupted' ? '중단됨 · 다음 요청 대기' : '완료 · 다음 요청 대기';
    const a = this.store.get(this.id);
    if (a && a.state === 'done' && a.detail === detail) return this.touch(ts);
    this.set({ state: 'done', detail, path: '', kind: 'done' }, ts);
    this.log(ts, reason === 'interrupted' ? '사용자가 중단함' : '턴 완료', '', 'done');
  }

  /** Heuristics that depend on silence: permission prompts, post-tool thinking. */
  tick(now = Date.now()) {
    const a = this.store.get(this.id);
    if (!a) return;
    const quietAll = now - this.lastEvent;
    a._busy = this.pending.size > 0 && a.alive !== false && quietAll < 30 * 60e3;
    if (this.pending.size) {
      let first = null;
      for (const p of this.pending.values()) if (!first || p.ts < first.ts) first = p;
      const k = first.cls.kind;
      const quiet = now - Math.max(this.lastEvent, first.ts);
      if (quiet > this.store.opts.staleMs) return;
      const auto = AUTO_MODES.has(this.mode) || (this.mode === 'acceptEdits' && first.cls.state === 'typing');
      let wait = null;
      if (k === 'ask') wait = first.cls.detail;
      else if (!auto && k !== 'agent') {
        const limit = k === 'shell' ? 12e3 : k === 'mcp' || k === 'web' ? 15e3 : 6e3;
        if (quiet > limit) wait = `승인 대기? ${first.cls.detail}`;
      }
      if (wait && (a.state !== 'waiting' || a.detail !== wait)) {
        this.store.upsert(this.id, { state: 'waiting', detail: wait, stateSince: now });
        if (!this.replaying) this.log(now, wait, first.cls.path, 'waiting');
      }
    } else if (TOOL_STATES.has(a.state) && quietAll > 2500 && quietAll < this.store.opts.staleMs) {
      this.store.upsert(this.id, { state: 'thinking', detail: '결과 확인 중', path: '', stateSince: now });
    }
  }
}

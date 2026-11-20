// Claude Code: tails ~/.claude/projects/<project>/<session>.jsonl and
// <session>/subagents/agent-<id>.jsonl for every session touched recently.
import path from 'node:path';
import os from 'node:os';
import { Tailer } from '../tail.js';
import { Tracker } from '../tracker.js';
import { classifyTool } from '../classify.js';
import { claudeEntry } from '../channels.js';
import { base, oneLine, cleanPrompt, readdirSafe, statSafe } from '../util.js';

const promptKey = (s) => oneLine(String(s || ''), 160);

export class ClaudeScanner {
  constructor(store, opts = {}) {
    this.store = store;
    const cfg = opts.claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    this.root = opts.root || path.join(cfg, 'projects');
    this.windowMs = opts.windowMs ?? 60 * 60e3;
    this.extraRoots = opts.extraRoots || null; // async () => [projects dirs] (e.g. Orca-managed accounts)
    this.files = new Map(); // file → ctx
    this.agentCalls = new Map(); // prompt key → Agent tool call info
    this.subByToolUse = new Map(); // tool_use id → sub-agent id
    this.busy = false;
    store.setScanner('claude', { name: 'Claude Code', root: this.root, files: 0, active: 0, lastScan: 0, error: null });
  }

  start() {
    const loop = async () => {
      await this.discover();
      await this.poll();
    };
    loop();
    this.timers = [setInterval(() => this.discover(), 4000), setInterval(() => this.poll(), 700)];
  }

  stop() {
    for (const t of this.timers || []) clearInterval(t);
  }

  async discover() {
    if (this.discovering) return;
    this.discovering = true;
    try {
      let seen = 0;
      const roots = [this.root, ...((await this.extraRoots?.()) || [])];
      let anyRoot = false;
      for (const root of roots) {
        const dirs = await readdirSafe(root);
        if (dirs.length) anyRoot = true;
        for (const d of dirs) {
          if (!d.isDirectory()) continue;
          const pdir = path.join(root, d.name);
          for (const e of await readdirSafe(pdir)) {
            if (e.isFile() && e.name.endsWith('.jsonl')) {
              seen++;
              await this.consider(path.join(pdir, e.name), { kind: 'main', sessionId: e.name.slice(0, -6), projDir: d.name });
            }
          }
        }
      }
      for (const ctx of [...this.files.values()]) {
        if (ctx.kind !== 'main') continue;
        const sdir = path.join(path.dirname(ctx.file), ctx.sessionId, 'subagents');
        for (const e of await readdirSafe(sdir)) {
          if (e.isFile() && e.name.endsWith('.jsonl')) {
            const subId = e.name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
            await this.consider(path.join(sdir, e.name), { kind: 'sub', sessionId: ctx.sessionId, subId, projDir: ctx.projDir, parent: ctx });
          }
        }
      }
      this.store.setScanner('claude', { files: seen, active: this.files.size, lastScan: Date.now(), error: anyRoot ? null : '세션 폴더 없음 (아직 Claude Code 기록 없음)' });
    } catch (err) {
      this.store.setScanner('claude', { error: err.message, lastScan: Date.now() });
    } finally {
      this.discovering = false;
    }
  }

  async consider(file, meta) {
    if (this.files.has(file)) return;
    const st = await statSafe(file);
    if (!st || Date.now() - st.mtimeMs > this.windowMs) return;
    const id = meta.kind === 'main' ? `claude:${meta.sessionId}` : `claude:${meta.sessionId}:${meta.subId}`;
    const parentId = meta.kind === 'sub' ? `claude:${meta.sessionId}` : null;
    const parentBase = meta.parent?.tracker.base || {};
    const baseInfo = {
      name: meta.kind === 'sub' ? 'subagent' : meta.projDir.split('-').filter(Boolean).pop() || 'claude',
      vendor: 'anthropic',
      client: 'Claude Code',
      via: 'transcript',
      parentId,
      channel: parentBase.channel || 'CLI',
      door: parentBase.door || 'cli',
      cwd: parentBase.cwd,
      project: parentBase.project,
      branch: parentBase.branch,
      sessionShort: (meta.subId || meta.sessionId).slice(0, 6),
      ttlMs: meta.kind === 'sub' ? 5 * 60e3 : undefined,
      startedAt: st.birthtimeMs || st.mtimeMs,
    };
    const ctx = { file, ...meta, id, tailer: new Tailer(file), tracker: new Tracker(this.store, id, baseInfo), linked: false };
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
        if (ctx.kind === 'sub' && !ctx.linked && ctx.pendingKey) this.link(ctx, ctx.pendingKey);
        ctx.tracker.tick(now);
        if (now - ctx.tailer.mtime > this.windowMs && !this.store.get(ctx.id)) this.files.delete(ctx.file);
      }
      for (const [k, v] of this.agentCalls) if (now - v.ts > 3600e3) this.agentCalls.delete(k);
    } finally {
      this.polling = false;
    }
  }

  sideCtx(ctx) {
    if (!ctx.side) {
      const id = `${ctx.id}:side`;
      ctx.side = {
        kind: 'sub', id, sessionId: ctx.sessionId, subId: 'side', linked: true, parent: ctx,
        tracker: new Tracker(this.store, id, { ...ctx.tracker.base, name: 'subagent', parentId: ctx.id, via: 'transcript', ttlMs: 5 * 60e3 }),
      };
    }
    return ctx.side;
  }

  handle(ctx, raw) {
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      return;
    }
    if (!o || typeof o !== 'object') return;
    if (o.isSidechain && ctx.kind === 'main') return this.handleObj(this.sideCtx(ctx), o);
    return this.handleObj(ctx, o);
  }

  handleObj(ctx, o) {
    const tr = ctx.tracker;
    const ts = Date.parse(o.timestamp) || tr.lastEvent || Date.now();
    const meta = {};
    if (o.cwd && o.cwd !== tr.base.cwd) {
      meta.cwd = o.cwd;
      meta.project = base(o.cwd);
      if (ctx.kind === 'main') meta.name = base(o.cwd) || tr.base.name;
    }
    if (o.gitBranch && o.gitBranch !== tr.base.branch) meta.branch = o.gitBranch;
    if (o.entrypoint && o.entrypoint !== tr.base.entrypoint) Object.assign(meta, { entrypoint: o.entrypoint }, claudeEntry(o.entrypoint));
    if (o.version && o.version !== tr.base.clientVersion) meta.clientVersion = o.version;
    if (Object.keys(meta).length) tr.meta(meta);
    if (o.permissionMode) tr.mode = o.permissionMode;

    switch (o.type) {
      case 'user':
        return this.onUser(ctx, o, ts);
      case 'assistant':
        return this.onAssistant(ctx, o, ts);
      case 'system':
        if ((o.subtype === 'stop_hook_summary' || o.subtype === 'turn_duration') && !tr.pending.size) return tr.turnEnd(ts);
        return tr.touch(ts);
      case 'summary':
        if (o.summary) tr.meta({ title: oneLine(o.summary, 80) });
        return;
      case 'custom-title':
      case 'ai-title': {
        const t = o.customTitle || o.aiTitle || o.title;
        if (t) tr.meta({ title: oneLine(t, 80) });
        return;
      }
      case 'last-prompt':
        if (o.lastPrompt && !this.store.get(ctx.id)?.task) tr.meta({ task: oneLine(cleanPrompt(o.lastPrompt), 300) });
        return;
      default:
        if (o.timestamp) tr.touch(ts);
    }
  }

  onUser(ctx, o, ts) {
    const tr = ctx.tracker;
    const c = o.message?.content;
    if (o.isMeta || o.isCompactSummary) return tr.touch(ts);
    if (typeof c === 'string') return this.onPrompt(ctx, c, ts);
    if (!Array.isArray(c)) return tr.touch(ts);
    let hadResult = false;
    const texts = [];
    for (const b of c) {
      if (b?.type === 'tool_result') {
        hadResult = true;
        const p = tr.toolEnd(b.tool_use_id, ts, !!b.is_error);
        if (p?.cls.kind === 'agent') this.onAgentDone(ctx, b.tool_use_id);
      } else if (b?.type === 'text') {
        texts.push(b.text);
      }
    }
    if (!hadResult && texts.length) this.onPrompt(ctx, texts.join('\n'), ts);
  }

  onPrompt(ctx, text, ts) {
    const tr = ctx.tracker;
    if (/^\s*\[Request interrupted/.test(text)) return tr.turnEnd(ts, 'interrupted');
    const clean = cleanPrompt(text);
    if (!clean) return tr.touch(ts);
    if (ctx.kind === 'sub' && !ctx.linked) this.link(ctx, text);
    tr.prompt(clean, ts, ctx.kind === 'sub' ? '상위 에이전트 › 위임' : '사용자 › 요청');
  }

  link(ctx, text) {
    const key = promptKey(text);
    const call = this.agentCalls.get(key);
    if (!call) {
      ctx.pendingKey = text;
      return;
    }
    ctx.linked = true;
    ctx.pendingKey = null;
    this.subByToolUse.set(call.toolUseId, ctx.id);
    ctx.tracker.meta({ name: call.type || 'subagent', title: call.description ? oneLine(call.description, 80) : undefined });
  }

  onAgentDone(ctx, toolUseId) {
    const subId = this.subByToolUse.get(toolUseId);
    if (subId) {
      this.subByToolUse.delete(toolUseId);
      this.store.finish(subId);
    } else if (ctx.side) {
      this.store.finish(ctx.side.id);
      ctx.side = null;
    }
  }

  onAssistant(ctx, o, ts) {
    const tr = ctx.tracker;
    const m = o.message || {};
    if (m.model && !m.model.startsWith('<') && m.model !== tr.base.model) tr.meta({ model: m.model });
    const content = Array.isArray(m.content) ? m.content : [];
    let usedTool = false;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'thinking' || b.type === 'redacted_thinking') tr.thinking(ts);
      else if (b.type === 'text') tr.say(b.text, ts);
      else if (b.type === 'tool_use' || b.type === 'server_tool_use' || b.type === 'mcp_tool_use') {
        usedTool = true;
        const cls = b.type === 'mcp_tool_use' ? classifyTool(`mcp__${b.server_name}__${b.name}`, b.input) : classifyTool(b.name, b.input, 'claude');
        tr.toolStart(b.id, cls, ts);
        if (cls.kind === 'agent' && b.input?.prompt) {
          this.agentCalls.set(promptKey(b.input.prompt), { parentId: ctx.id, toolUseId: b.id, description: b.input.description, type: b.input.subagent_type, ts });
        }
      } else if (typeof b.type === 'string' && b.type.endsWith('_tool_result')) {
        tr.toolEnd(b.tool_use_id, ts);
      }
    }
    const stop = m.stop_reason;
    if (!usedTool && stop && stop !== 'tool_use' && stop !== 'pause_turn' && !tr.pending.size) tr.turnEnd(ts);
  }
}

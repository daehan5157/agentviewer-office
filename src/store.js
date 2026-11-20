import { EventEmitter } from 'node:events';
import { addUnique } from './util.js';

export const ACTIVE = new Set(['thinking', 'typing', 'reading', 'running', 'web', 'mcp', 'delegating', 'planning', 'waiting']);
const MAX_LOG = 14;
const MAX_FEED = 300;

function blank(id, t) {
  return {
    id,
    name: id,
    title: '',
    vendor: 'other', // anthropic | openai | google | other
    client: 'Agent', // Claude Code, Codex, Gemini CLI, Cursor, ...
    channel: 'CLI', // CLI, VS Code, Desktop 앱, SDK, MCP, HTTP API, 클라우드 ...
    door: 'cli', // which office door: cli | ide | app | api | mcp | cloud
    via: 'api', // how Agentviewer found it: transcript | process | mcp | api | demo
    parentId: null,
    leadId: null, // orchestration lead (e.g. Orca coordinator) — drawn nearby, never auto-removed like a sub-agent
    orchestrator: null, // e.g. 'Orca' when the agent was started by an orchestrator app
    orca: null, // { worktree, worktreeStatus, paneKey, pr } for Orca-managed agents
    project: '',
    cwd: '',
    branch: '',
    model: '',
    state: 'idle',
    task: '',
    detail: '',
    path: '',
    kind: '',
    todos: null,
    stateSince: t,
    lastActivity: t,
    startedAt: t,
    alive: null, // true/false when a matching OS process is (not) running, null = unknown
    pid: null,
    log: [],
    finishedAt: null,
    ttlMs: null,
    sessionShort: '',
  };
}

/** Central registry of agents, MCP servers and the activity feed. */
export class Store extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.agents = new Map();
    this.mcp = new Map();
    this.feed = [];
    this.pulses = [];
    this.scanners = {};
    this.hints = { geminiProjects: {} };
    this.seq = 0;
    this.version = 0;
    this.opts = {
      staleMs: 10 * 60e3, // active state with no events → idle
      doneIdleMs: 15 * 60e3, // finished turn → idle (lounge)
      removeMs: 60 * 60e3, // no events at all → leaves the office
      ...opts,
    };
    this._pending = null;
  }

  get(id) {
    return this.agents.get(id);
  }

  upsert(id, patch = {}) {
    const t = Date.now();
    let a = this.agents.get(id);
    const isNew = !a;
    if (!a) {
      a = blank(id, t);
      this.agents.set(id, a);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === 'lastActivity') {
        if (isNew || v > a.lastActivity) a.lastActivity = v;
      } else if (k === 'state') {
        if (v !== a.state) {
          a.state = v;
          a.stateSince = patch.stateSince ?? patch.lastActivity ?? t;
        }
      } else if (k !== 'stateSince') {
        a[k] = v;
      }
    }
    if (isNew && patch.startedAt === undefined && patch.lastActivity) a.startedAt = patch.lastActivity;
    this.touch();
    return a;
  }

  activity(id, { t = Date.now(), text, path = '', state = '' }) {
    const a = this.agents.get(id);
    if (!a || !text) return;
    const last = a.log[0];
    if (last && last.text === text && Math.abs(last.t - t) < 2000) return;
    const entry = { t, text, path, state };
    a.log.unshift(entry);
    if (a.log.length > MAX_LOG) a.log.length = MAX_LOG;
    this.feed.push({ ...entry, id, name: a.name, door: a.door, client: a.client, vendor: a.vendor });
    if (this.feed.length > MAX_FEED + 100) {
      this.feed.sort((x, y) => x.t - y.t);
      this.feed = this.feed.slice(-MAX_FEED);
    }
    this.touch();
  }

  /** An agent called an MCP tool: animate a packet to that server's rack. */
  pulse(from, server, tool, t = Date.now()) {
    this.pulses.push({ id: ++this.seq, from, server, tool, t });
    if (this.pulses.length > 80) this.pulses.splice(0, this.pulses.length - 80);
    this.touchMcp(server, { user: from, t, tool });
  }

  touchMcp(name, info = {}) {
    if (!name) return;
    let m = this.mcp.get(name);
    if (!m) {
      m = { name, calls: 0, lastUsed: 0, users: {}, lastTool: '', pids: [], launchers: [], command: '', seenVia: [], procSeen: 0 };
      this.mcp.set(name, m);
    }
    if (info.user) {
      m.calls++;
      m.lastUsed = Math.max(m.lastUsed, info.t || Date.now());
      m.users[info.user] = info.t || Date.now();
      if (info.tool) m.lastTool = info.tool;
      addUnique(m.seenVia, '도구 호출');
    }
    if (info.proc) {
      m.procSeen = Date.now();
      m.pids = info.pids || m.pids;
      m.launchers = info.launchers || m.launchers;
      m.command = info.command || m.command;
      addUnique(m.seenVia, '프로세스');
    }
    if (info.via) addUnique(m.seenVia, info.via);
    this.touch();
  }

  finish(id) {
    const a = this.agents.get(id);
    if (!a || a.finishedAt) return;
    this.upsert(id, { finishedAt: Date.now(), state: 'done', detail: '작업 완료 · 결과 보고' });
  }

  remove(id) {
    if (this.agents.delete(id)) this.touch();
  }

  setScanner(key, info) {
    this.scanners[key] = { ...(this.scanners[key] || {}), ...info };
    this.touch();
  }

  /** Time-based transitions; called every second. */
  tick(now = Date.now()) {
    const { staleMs, doneIdleMs, removeMs } = this.opts;
    for (const a of [...this.agents.values()]) {
      const age = now - a.lastActivity;
      if (a.finishedAt) {
        if (now - a.finishedAt > 6000) this.remove(a.id);
        continue;
      }
      if (a.parentId && a.state === 'done' && age > 20e3) {
        this.finish(a.id);
        continue;
      }
      if (ACTIVE.has(a.state) && age > staleMs && !a._busy) {
        this.upsert(a.id, { state: 'idle', detail: '한동안 활동 없음' });
      } else if (a.state === 'done' && age > doneIdleMs) {
        this.upsert(a.id, { state: 'idle', detail: '휴식 중' });
      }
      const ttl = a.ttlMs ?? removeMs;
      if (age > ttl && a.alive !== true) this.remove(a.id);
      else if (a.alive === false && age > 3 * 60e3 && !ACTIVE.has(a.state)) this.remove(a.id);
    }
    for (const m of [...this.mcp.values()]) {
      const procGone = !m.procSeen || now - m.procSeen > 15e3;
      if (procGone && now - m.lastUsed > 2 * 3600e3) {
        this.mcp.delete(m.name);
        this.touch();
      }
    }
  }

  touch() {
    this.version++;
    if (this._pending) return;
    this._pending = setTimeout(() => {
      this._pending = null;
      this.emit('change');
    }, 150);
    this._pending.unref?.();
  }

  snapshot() {
    const now = Date.now();
    const agents = [...this.agents.values()].map((a) => {
      const o = {};
      for (const [k, v] of Object.entries(a)) if (!k.startsWith('_')) o[k] = v;
      return o;
    });
    const mcp = [...this.mcp.values()].map((m) => ({
      ...m,
      users: Object.keys(m.users),
      live: !!m.procSeen && now - m.procSeen < 15e3,
    }));
    const feed = this.feed.slice().sort((a, b) => b.t - a.t).slice(0, 150);
    const pulses = this.pulses.filter((p) => now - p.t < 15e3);
    return { now, version: this.version, agents, mcp, feed, pulses, scanners: this.scanners };
  }
}

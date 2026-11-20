// Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.json (whole JSON file
// rewritten as the chat grows). State is re-derived from the message list.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { classifyTool } from '../classify.js';
import { base, oneLine, cleanPrompt, readdirSafe, statSafe } from '../util.js';

const DONE = new Set(['success', 'error', 'cancelled', 'canceled']);

function text(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n');
  if (content && typeof content === 'object') return content.text || '';
  return '';
}

export class GeminiScanner {
  constructor(store, opts = {}) {
    this.store = store;
    const home = opts.geminiHome || process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
    this.root = opts.root || path.join(home, 'tmp');
    this.windowMs = opts.windowMs ?? 60 * 60e3;
    this.files = new Map(); // file → { mtime, size, seen:Set, id }
    store.setScanner('gemini', { name: 'Gemini CLI', root: this.root, files: 0, active: 0, lastScan: 0, error: null });
  }

  start() {
    this.scan();
    this.timers = [setInterval(() => this.scan(), 1500)];
  }

  stop() {
    for (const t of this.timers || []) clearInterval(t);
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      let count = 0;
      const dirs = await readdirSafe(this.root);
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const pdir = path.join(this.root, d.name);
        for (const e of await readdirSafe(path.join(pdir, 'chats'))) {
          if (!e.isFile() || !/^session-.*\.json$/.test(e.name)) continue;
          count++;
          await this.check(path.join(pdir, 'chats', e.name), d.name, pdir);
        }
      }
      this.store.setScanner('gemini', { files: count, active: this.files.size, lastScan: Date.now(), error: dirs.length ? null : '세션 폴더 없음 (Gemini CLI 미사용)' });
    } catch (err) {
      this.store.setScanner('gemini', { error: err.message, lastScan: Date.now() });
    } finally {
      this.scanning = false;
    }
  }

  async projectRoot(dirName, pdir) {
    try {
      const r = (await fsp.readFile(path.join(pdir, '.project_root'), 'utf8')).trim();
      if (r) return r;
    } catch {}
    return this.store.hints.geminiProjects[dirName] || '';
  }

  async check(file, dirName, pdir) {
    const st = await statSafe(file);
    if (!st || Date.now() - st.mtimeMs > this.windowMs) {
      this.files.delete(file);
      return;
    }
    let f = this.files.get(file);
    if (f && f.mtime === st.mtimeMs && f.size === st.size) return;
    let data;
    try {
      data = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {
      return; // mid-write; try again next scan
    }
    const sid = data.sessionId || base(file).replace(/\.json$/, '');
    if (!f) {
      f = { id: `gemini:${sid}`, seen: new Set(), first: true };
      this.files.set(file, f);
    }
    f.mtime = st.mtimeMs;
    f.size = st.size;
    const cwd = await this.projectRoot(dirName, pdir);
    this.apply(f, data, { cwd, dirName, mtime: st.mtimeMs });
    f.first = false;
  }

  /** Exposed for tests. */
  apply(f, data, { cwd = '', dirName = '', mtime = Date.now() } = {}) {
    const s = this.store;
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    const name = cwd ? base(cwd) : /^[0-9a-f]{64}$/.test(dirName) ? `gemini-${dirName.slice(0, 6)}` : dirName || 'gemini';
    const startedAt = Date.parse(data.startTime) || mtime;
    const last = msgs[msgs.length - 1];
    const lastTs = Date.parse(data.lastUpdated) || Date.parse(last?.timestamp) || mtime;
    const model = [...msgs].reverse().find((m) => m.model)?.model;
    s.upsert(f.id, {
      name, vendor: 'google', client: 'Gemini CLI', via: 'transcript', channel: 'CLI', door: 'cli',
      cwd, project: name, model, startedAt, sessionShort: f.id.slice(7, 13), lastActivity: lastTs,
    });

    // activity log for new messages / tool calls
    for (const m of msgs) {
      const mt = Date.parse(m.timestamp) || lastTs;
      const key = m.id || `${m.type}-${m.timestamp}`;
      if (m.type === 'user' && !f.seen.has(key)) {
        f.seen.add(key);
        const t = cleanPrompt(text(m.content));
        if (t) s.activity(f.id, { t: mt, text: `요청: ${oneLine(t, 120)}`, path: '사용자 › 요청', state: 'thinking' });
      }
      for (const c of m.toolCalls || []) {
        const ck = `tc:${c.id || c.name + c.timestamp}`;
        if (f.seen.has(ck)) continue;
        f.seen.add(ck);
        const cls = classifyTool(c.name, c.args, 'gemini');
        s.activity(f.id, { t: Date.parse(c.timestamp) || mt, text: cls.detail, path: cls.path, state: cls.state });
        if (cls.kind === 'mcp' && (!f.first || Date.now() - mt < 15e3)) s.pulse(f.id, cls.server, cls.tool, Date.parse(c.timestamp) || mt);
        else if (cls.kind === 'mcp') s.touchMcp(cls.server, { user: f.id, t: mt, tool: cls.tool });
      }
    }

    const lastUser = [...msgs].reverse().find((m) => m.type === 'user');
    const task = lastUser ? oneLine(cleanPrompt(text(lastUser.content)), 300) : '';
    let patch;
    if (!last) patch = { state: 'done', detail: '세션 시작 · 입력 대기' };
    else if (last.type === 'user') patch = { state: 'thinking', detail: '요청 분석 중', path: '사용자 › 요청' };
    else if (last.type === 'gemini' || last.type === 'model') {
      const calls = last.toolCalls || [];
      const open = calls.filter((c) => !DONE.has(String(c.status || '').toLowerCase()));
      const awaiting = open.find((c) => /approv|confirm/i.test(c.status || ''));
      if (awaiting) {
        const cls = classifyTool(awaiting.name, awaiting.args, 'gemini');
        patch = { state: 'waiting', detail: `승인 대기: ${cls.detail}`, path: cls.path };
      } else if (open.length) {
        const cls = classifyTool(open[0].name, open[0].args, 'gemini');
        patch = { state: cls.state, detail: cls.detail, path: cls.path, kind: cls.kind };
      } else if (calls.length && !text(last.content).trim()) {
        patch = { state: 'thinking', detail: '결과 확인 중', path: '' };
      } else {
        patch = { state: 'done', detail: '완료 · 다음 요청 대기', path: '' };
      }
    } else patch = { state: 'done', detail: oneLine(text(last.content), 60) || '대기', path: '' };
    s.upsert(f.id, { ...patch, task, stateSince: lastTs });
  }
}

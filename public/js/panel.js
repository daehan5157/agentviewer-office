import { STATE, DOOR, DOORS, VIA, VENDOR, PRIORITY, esc, dur, ago, clock } from './meta.js';

const pill = (state) => {
  const s = STATE[state] || STATE.idle;
  return `<span class="pill" style="--c:${s.color}">${s.icon} ${s.label}</span>`;
};
const doorChip = (a) => `<span class="chip door" style="--c:${DOOR[a.door]?.color || '#9aa0aa'}">${esc(DOOR[a.door]?.label || a.door)}</span>`;

function sortAgents(list) {
  return list.sort((a, b) => (PRIORITY[a.state] ?? 4) - (PRIORITY[b.state] ?? 4) || b.lastActivity - a.lastActivity);
}

export class Panel {
  constructor(root, { onSelect }) {
    this.root = root;
    this.onSelect = onSelect;
    this.tab = 'agents';
    this.filter = '';
    this.selected = null;
    this.snap = null;
    root.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
        root.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === `tab-${this.tab}`));
        this.render();
      }),
    );
    root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-agent]');
      if (card && !e.target.closest('a,button,input')) this.onSelect(card.dataset.agent === this.selected ? null : card.dataset.agent, true);
    });
    const search = root.querySelector('#filter');
    search?.addEventListener('input', () => {
      this.filter = search.value.trim().toLowerCase();
      this.render();
    });
  }

  update(snap) {
    this.snap = snap;
    this.render();
  }

  select(id) {
    this.selected = id;
    this.render();
    if (id) {
      const el = this.root.querySelector(`[data-agent="${CSS.escape(id)}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  now() {
    return this.snap ? Date.now() - (this.snap._offset || 0) : Date.now();
  }

  render() {
    if (!this.snap) return;
    if (this.tab === 'agents') this.renderAgents();
    else if (this.tab === 'feed') this.renderFeed();
    else this.renderPaths();
  }

  matches(a) {
    if (!this.filter) return true;
    return [a.name, a.client, a.channel, a.task, a.detail, a.path, a.project].join(' ').toLowerCase().includes(this.filter);
  }

  card(a, child = false) {
    child = child || !!a.leadId;
    const now = this.now();
    const sel = a.id === this.selected;
    const alive = a.alive === true ? '<span class="chip ok">실행 중</span>' : a.alive === false ? '<span class="chip off">종료됨</span>' : '';
    const meta = [
      `⏱ ${dur(now - a.stateSince)}`,
      a.model && `🧠 ${esc(a.model.replace(/^claude-/, ''))}`,
      a.branch && `⎇ ${esc(a.branch)}`,
      a.cwd && `📁 ${esc(a.cwd.replace(/^\/(Users|home)\/[^/]+/, '~'))}`,
    ].filter(Boolean);
    let extra = '';
    if (sel) {
      const todos = Array.isArray(a.todos) && a.todos.length
        ? `<div class="todos">${a.todos.map((t) => `<div class="todo ${esc(t.status)}">${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'} ${esc(t.content)}</div>`).join('')}</div>`
        : '';
      const log = a.log.length
        ? `<ol class="log">${a.log.map((l) => `<li><time>${clock(l.t)}</time>${l.path ? `<code>${esc(l.path)}</code>` : ''}<span>${esc(l.text)}</span></li>`).join('')}</ol>`
        : '<div class="muted">아직 기록된 활동이 없어요</div>';
      extra = `<div class="more">
        <div class="kv"><span>클라이언트</span><b>${esc(a.client)}${a.clientVersion ? ` ${esc(a.clientVersion)}` : ''}</b></div>
        <div class="kv"><span>유입 경로</span><b>${esc(DOOR[a.door]?.label || a.door)} 출입문 · ${esc(a.channel)}</b></div>
        <div class="kv"><span>감지 방식</span><b>${esc(VIA[a.via] || a.via)}${a.pid ? ` · PID ${a.pid}` : ''}</b></div>
        ${a.orchestrator ? `<div class="kv"><span>오케스트레이터</span><b>${esc(a.orchestrator)}${a.orca?.worktree ? ` · 워크트리 ${esc(a.orca.worktree)}` : ''}${a.orca?.pr ? ` · PR #${a.orca.pr}` : ''}${a.leadId ? ` · 리드: ${esc(this.snap.agents.find((x) => x.id === a.leadId)?.name || a.leadId)}` : ''}</b></div>` : ''}
        <div class="kv"><span>시작</span><b>${ago(now - a.startedAt)}</b></div>
        ${Array.isArray(a.links) && a.links.length ? `<div class="links">${a.links.map((l) => `<a href="${esc(String(l.url).replace('{host}', location.hostname))}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>` : ''}
        ${a.title ? `<div class="kv"><span>세션 제목</span><b>${esc(a.title)}</b></div>` : ''}
        ${todos}
        <div class="sub">최근 활동</div>${log}
      </div>`;
    }
    return `<article class="card${sel ? ' sel' : ''}${child ? ' child' : ''} st-${esc(a.state)}" data-agent="${esc(a.id)}">
      <div class="r1"><span class="dot" style="background:${VENDOR[a.vendor] || VENDOR.other}"></span><b class="nm">${a.orca?.lead ? '👑 ' : child ? '↳ ' : ''}${esc(a.name)}</b>${a.orca?.lead ? '<span class="chip lead">오케스트레이터</span>' : ''}<span class="sid">#${esc(a.sessionShort || '')}</span>${pill(a.state)}</div>
      <div class="r2">${doorChip(a)}<span class="chip">${esc(a.client)}</span><span class="chip ghost">${esc(a.channel)}</span><span class="chip ghost">${esc(VIA[a.via] || a.via)}</span>${a.orchestrator ? `<span class="chip orca">🐋 ${esc(a.orchestrator)}${a.orca?.worktree ? ` · ${esc(a.orca.worktree)}` : ''}</span>` : ''}${alive}</div>
      ${a.task ? `<div class="task" title="${esc(a.task)}">📌 ${esc(a.task)}</div>` : ''}
      <div class="now">${a.path ? `<code>${esc(a.path)}</code>` : ''}<span>${esc(a.detail || '')}</span></div>
      <div class="meta">${meta.join(' · ')}</div>
      ${extra}
    </article>`;
  }

  renderAgents() {
    const el = this.root.querySelector('#tab-agents .list');
    const agents = this.snap.agents.filter((a) => this.matches(a));
    const byParent = new Map();
    const ids = new Set(agents.map((a) => a.id));
    const up = (a) => (a.parentId && ids.has(a.parentId) ? a.parentId : a.leadId && ids.has(a.leadId) ? a.leadId : null);
    for (const a of agents) {
      const p = up(a);
      if (p) (byParent.get(p) || byParent.set(p, []).get(p)).push(a);
    }
    const roots = sortAgents(agents.filter((a) => !up(a)));
    if (!roots.length) {
      el.innerHTML = `<div class="empty-panel">${this.filter ? '검색 결과가 없어요' : '아직 감지된 에이전트가 없어요.<br>Claude Code · Codex · Gemini CLI를 실행하거나<br><code>agentviewer --demo</code> 로 데모를 볼 수 있어요.'}</div>`;
      return;
    }
    const scroll = el.scrollTop;
    el.innerHTML = roots.map((a) => this.card(a) + sortAgents(byParent.get(a.id) || []).map((c) => this.card(c, true)).join('')).join('');
    el.scrollTop = scroll;
  }

  renderFeed() {
    const el = this.root.querySelector('#tab-feed');
    const rows = this.snap.feed.filter((f) => !this.filter || `${f.name} ${f.text} ${f.path}`.toLowerCase().includes(this.filter));
    el.innerHTML = rows.length
      ? `<ol class="feed">${rows
          .map((f) => {
            const s = STATE[f.state] || { color: '#8a8f98' };
            return `<li data-agent="${esc(f.id)}"><time>${clock(f.t)}</time><span class="fd" style="background:${s.color}"></span><b>${esc(f.name)}</b>${f.path ? `<code style="--c:${DOOR[f.door]?.color || '#9aa0aa'}">${esc(f.path)}</code>` : ''}<span class="tx">${esc(f.text)}</span></li>`;
          })
          .join('')}</ol>`
      : '<div class="empty-panel">아직 활동이 없어요</div>';
  }

  renderPaths() {
    const el = this.root.querySelector('#tab-paths');
    const now = this.now();
    const agents = this.snap.agents;
    const doors = DOORS.map((d) => {
      const list = agents.filter((a) => a.door === d);
      return `<div class="door-row"><span class="chip door" style="--c:${DOOR[d].color}">${DOOR[d].label}</span><span class="dd">${DOOR[d].desc}</span><b>${list.length}</b>
        <div class="names">${list.map((a) => `<span data-agent="${esc(a.id)}">${esc(a.name)} <small>${esc(a.client)}·${esc(a.channel)}</small></span>`).join('') || '<small class="muted">없음</small>'}</div></div>`;
    }).join('');
    const nameOf = (id) => agents.find((a) => a.id === id)?.name || id;
    const mcp = this.snap.mcp.length
      ? this.snap.mcp
          .slice()
          .sort((a, b) => b.lastUsed - a.lastUsed)
          .map((m) => `<div class="mcp-row"><div class="r1"><span class="led ${m.live ? 'on' : ''}"></span><b>${esc(m.name)}</b><span class="muted">${m.calls}회 호출${m.lastUsed ? ` · ${ago(now - m.lastUsed)}` : ''}</span></div>
            ${m.launchers?.length ? `<div class="r2">실행한 쪽: ${m.launchers.map(esc).join(', ')}</div>` : ''}
            ${m.users?.length ? `<div class="r2">사용한 에이전트: ${m.users.map((u) => esc(nameOf(u))).join(', ')}</div>` : ''}
            ${m.lastTool ? `<div class="r2">마지막 도구: <code>${esc(m.lastTool)}</code></div>` : ''}
            ${m.command ? `<div class="r2 cmd" title="${esc(m.command)}"><code>${esc(m.command)}</code></div>` : ''}
            <div class="r2 muted">감지: ${(m.seenVia || []).map(esc).join(', ')}</div></div>`)
          .join('')
      : '<div class="muted">아직 MCP 서버가 없어요</div>';
    const scanners = Object.entries(this.snap.scanners)
      .map(([k, s]) => {
        const ok = !s.error && s.enabled !== false;
        const stats = [s.files !== undefined && `파일 ${s.files}`, s.active !== undefined && `추적 ${s.active}`, s.procs !== undefined && `프로세스 ${s.procs}`, s.worktrees !== undefined && `워크트리 ${s.worktrees}`, s.agents !== undefined && `에이전트 ${s.agents}`, s.mcp !== undefined && `MCP ${s.mcp}`, s.custom !== undefined && `사용자 정의 ${s.custom}`].filter(Boolean).join(' · ');
        return `<div class="scan-row"><span class="led ${ok ? 'on' : ''}"></span><b>${esc(s.name || k)}</b><span class="muted">${s.lastScan ? ago(now - s.lastScan) : '-'}</span>
          <div class="r2"><code>${esc(s.root || '')}</code></div>${stats ? `<div class="r2">${stats}</div>` : ''}${s.error ? `<div class="r2 warn">${esc(s.error)}</div>` : ''}</div>`;
      })
      .join('');
    el.innerHTML = `
      <section><h3>유입 경로 · 출입문</h3>${doors}</section>
      <section><h3>MCP 서버실</h3>${mcp}</section>
      <section><h3>상시 스캐너</h3>${scanners}</section>
      <section><h3>다른 경로 연결하기</h3>
        <div class="howto"><b>MCP 클라이언트</b> (Claude 앱, Cursor 등) 설정에 추가:
<pre>{ "mcpServers": { "agentviewer": {
  "command": "node",
  "args": ["/경로/agentviewer/bin/agentviewer.js", "mcp"] } } }</pre>
        <b>HTTP</b> (직접 만든 에이전트, LangGraph 등):
<pre>curl -X POST localhost:4747/api/report \\
 -H 'content-type: application/json' \\
 -d '{"name":"MyApp","client":"Orca","state":"running","task":"…","detail":"…"}'</pre>
        <b>프로세스 자동 감지</b>: <code>~/.agentviewer/config.json</code>
<pre>{ "processes": [ { "name": "MyApp", "match": "orca.*myapp", "client": "Orca" } ] }</pre></div>
      </section>`;
  }
}

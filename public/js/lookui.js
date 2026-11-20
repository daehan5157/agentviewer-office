// 🎨 꾸미기: pick the office theme, ask an agent to make a new one, and dress each character.
// Saved on the PC running Agentviewer (~/.agentviewer); only that PC can change it, everyone sees it.
import { esc } from './meta.js';
import { makeSprites, paletteFor, lookPalette } from './sprites.js';

const ACCESSORIES = [
  ['none', '없음'], ['cap', '야구모자'], ['hardhat', '안전모'], ['swimcap', '수영모'],
  ['beanie', '비니'], ['headphones', '헤드폰'], ['glasses', '안경'],
];
const COLORS = [['hair', '머리'], ['skin', '피부'], ['shirt', '상의'], ['pants', '하의']];
const CONTROL = { 'content-type': 'application/json', 'x-agentviewer-control': '1' };

export class LookUI {
  /**
   * @param q       auth query suffix for API urls ('' or '?t=…')
   * @param onLook  called with the look state whenever it changes (→ world.setLook)
   * @param agents  () => current agents (to pick one to dress)
   */
  constructor({ q = '', onLook, agents }) {
    this.q = q;
    this.onLook = onLook;
    this.agents = agents;
    this.state = null;
    this.version = '';
    this.dlg = document.createElement('dialog');
    this.dlg.className = 'lookui';
    document.body.append(this.dlg);
    this.dlg.addEventListener('click', (e) => {
      if (e.target === this.dlg) this.dlg.close(); // click outside the box
    });
    this.load();
    setInterval(() => this.poll(), 5000);
  }

  api(path) {
    return `api/${path}${this.q}`;
  }

  async load() {
    try {
      const r = await fetch(this.api('look'), { cache: 'no-store' });
      if (!r.ok) return;
      this.state = await r.json();
      this.version = this.state.version;
      this.onLook({ theme: this.state.themeData, chars: this.state.chars, version: this.version });
      if (this.dlg.open) this.render();
    } catch {}
  }

  async poll() {
    try {
      const r = await fetch(this.api('look/version'), { cache: 'no-store' });
      if (!r.ok) return;
      const { version } = await r.json();
      if (version !== this.version) await this.load();
    } catch {}
  }

  open() {
    if (!this.state) return;
    this.pick = this.pick || null;
    this.render();
    this.dlg.showModal();
  }

  async put(body) {
    const r = await fetch(this.api('look'), { method: 'PUT', headers: CONTROL, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `오류 ${r.status}`);
    await this.load();
  }

  people() {
    const seen = new Set();
    return (this.agents() || []).filter((a) => !a.orca?.lead && !seen.has(a.name) && seen.add(a.name)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  render() {
    const s = this.state;
    const edit = s.canEdit;
    const themes = s.themes
      .map((t) => `<button type="button" class="lk-theme ${t.id === s.theme ? 'on' : ''}" data-theme="${esc(t.id)}" ${edit ? '' : 'disabled'}>
          <span class="lk-ic">${esc(t.icon || '🖼️')}</span><b>${esc(t.name)}</b>${t.mine ? '<span class="lk-mine">내 테마</span>' : ''}
          <small>${esc(t.description || '')}</small></button>`)
      .join('');
    const people = this.people();
    if (!this.pick || !people.some((a) => a.name === this.pick)) this.pick = people[0]?.name || null;
    const who = people.find((a) => a.name === this.pick);
    const own = (this.pick && s.chars[this.pick]) || {};
    const outfit = s.themeData?.outfit || {};
    this.dlg.innerHTML = `
      <form method="dialog" class="lk">
        <header><h2>🎨 꾸미기</h2><button value="close" class="lk-x" aria-label="닫기">✕</button></header>
        ${edit ? '' : '<p class="lk-note">꾸미기는 Agentviewer가 설치된 PC에서만 바꿀 수 있어요. 지금 화면은 보기만 돼요.</p>'}
        <section>
          <h3>배경 테마</h3>
          <div class="lk-themes">${themes}</div>
          ${s.canRequest ? `
          <div class="lk-ask">
            <label for="lk-idea">🤖 에이전트에게 새 테마 만들어달라기</label>
            <div class="lk-row"><input id="lk-idea" maxlength="60" placeholder="예: 우주정거장, 한옥, 도서관">
              <select class="lk-engine" aria-label="만들 에이전트">${(s.engines || []).map((e) => `<option value="${esc(e.id)}" ${e.id === this.engine ? 'selected' : ''}>${esc(e.name)} (따로 실행)</option>`).join('')}<option value="copy" ${this.engine === 'copy' ? 'selected' : ''}>요청문 복사해서 직접 붙여넣기</option></select>
              <button type="button" class="lk-req">부탁하기</button></div>
            <p class="lk-hint">지금 일하고 있는 에이전트에게는 끼어들지 않아요. 테마만 만드는 에이전트를 따로 잠깐 실행하고, 다 되면 아래 목록에 나타나요.</p>
            <div class="lk-req-out" role="status"></div>
          </div>` : ''}
        </section>
        <section>
          <h3>캐릭터 꾸미기</h3>
          ${people.length ? `
          <div class="lk-char">
            <canvas class="lk-prev" width="84" height="108" aria-label="미리보기"></canvas>
            <div class="lk-fields">
              <label>에이전트 <select class="lk-who" ${edit ? '' : 'disabled'}>${people.map((a) => `<option ${a.name === this.pick ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
              ${COLORS.map(([k, label]) => `<label>${label} <input type="color" data-k="${k}" value="${own[k] || outfit[k] || '#000000'}" ${own[k] || outfit[k] ? '' : 'data-unset="1"'} ${edit ? '' : 'disabled'}></label>`).join('')}
              <label>소품 <select class="lk-acc" ${edit ? '' : 'disabled'}>${ACCESSORIES.map(([k, l]) => `<option value="${k}" ${(own.accessory || outfit.accessory || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label>소품 색 <input type="color" data-k="accessoryColor" value="${own.accessoryColor || '#f2c230'}" ${own.accessoryColor ? '' : 'data-unset="1"'} ${edit ? '' : 'disabled'}></label>
            </div>
          </div>
          ${edit ? '<div class="lk-row lk-btns"><button type="button" class="lk-save">저장</button><button type="button" class="lk-reset">기본으로</button><span class="lk-status" role="status"></span></div>' : ''}
          <p class="lk-hint">색을 안 바꾼 칸은 자동(에이전트마다 다른 색)이에요. 이름 기준으로 기억해요.</p>` : '<p class="lk-hint">지금 보이는 에이전트가 없어요.</p>'}
        </section>
      </form>`;
    const $ = (sel) => this.dlg.querySelector(sel);
    this.dlg.querySelectorAll('.lk-theme').forEach((b) => b.addEventListener('click', () => this.put({ theme: b.dataset.theme }).catch((e) => alert(e.message))));
    $('.lk-req')?.addEventListener('click', () => this.request());
    $('.lk-engine')?.addEventListener('change', (e) => {
      this.engine = e.target.value;
    });
    this.showJob();
    $('#lk-idea')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.request();
      }
    });
    $('.lk-who')?.addEventListener('change', (e) => {
      this.pick = e.target.value;
      this.render();
    });
    this.dlg.querySelectorAll('.lk-fields input[type=color]').forEach((i) => i.addEventListener('input', () => {
      delete i.dataset.unset;
      this.preview(who);
    }));
    $('.lk-acc')?.addEventListener('change', () => this.preview(who));
    $('.lk-save')?.addEventListener('click', () => this.saveChar());
    $('.lk-reset')?.addEventListener('click', () => this.put({ chars: { [this.pick]: null } }).catch((e) => alert(e.message)));
    if (who) this.preview(who);
  }

  /** what the editor currently says ({…} with only the fields that were set) */
  draft() {
    const l = {};
    this.dlg.querySelectorAll('.lk-fields input[type=color]').forEach((i) => {
      if (!i.dataset.unset) l[i.dataset.k] = i.value;
    });
    const acc = this.dlg.querySelector('.lk-acc')?.value;
    if (acc && acc !== 'none') l.accessory = acc;
    else if (acc === 'none' && this.state.themeData?.outfit?.accessory) l.accessory = 'none';
    return l;
  }

  preview(agent) {
    const cv = this.dlg.querySelector('.lk-prev');
    if (!cv || !agent) return;
    const look = { ...(this.state.themeData?.outfit || {}), ...this.draft() };
    const sp = makeSprites(lookPalette(paletteFor(agent.id, agent.vendor, agent.parentId), look), false, look.accessory);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(sp.normal.front[0], 0, 0, cv.width, cv.height);
  }

  async saveChar() {
    const st = this.dlg.querySelector('.lk-status');
    try {
      await this.put({ chars: { [this.pick]: this.draft() } });
      if (st) st.textContent = '저장했어요';
    } catch (e) {
      if (st) st.textContent = e.message;
    }
  }

  /** the background theme job's progress, in the request box (polled while it runs) */
  showJob() {
    const job = this.state?.job;
    const out = this.dlg.querySelector('.lk-req-out');
    if (!job || !out || out.dataset.copy) return;
    const secs = Math.round(((job.ended || Date.now()) - job.started) / 1000);
    if (job.state === 'running') out.innerHTML = `⏳ ${esc(job.engineName)}가 <b>${esc(job.idea)}</b> 테마를 그리는 중… (${secs}초, 보통 1~3분)`;
    else if (job.state === 'done') out.innerHTML = `✅ <b>${esc(job.idea)}</b> 테마가 생겼어요. 위 목록에서 눌러 적용하세요.`;
    else out.innerHTML = `⚠️ <b>${esc(job.idea)}</b> 테마를 못 만들었어요: ${esc(job.error || '')}`;
    clearTimeout(this.jobTimer);
    if (job.state === 'running') this.jobTimer = setTimeout(() => this.pollJob(), 3000);
  }

  async pollJob() {
    try {
      const r = await fetch(this.api('look/job'), { cache: 'no-store' });
      if (!r.ok) return;
      const { job } = await r.json();
      const was = this.state.job?.state;
      this.state.job = job;
      if (job?.state !== 'running' && was === 'running') await this.load(); // new theme in the list
      if (this.dlg.open) this.showJob();
    } catch {}
  }

  async request() {
    const idea = this.dlg.querySelector('#lk-idea')?.value.trim();
    const out = this.dlg.querySelector('.lk-req-out');
    const engine = this.dlg.querySelector('.lk-engine')?.value || 'copy';
    if (!idea || !out) return;
    delete out.dataset.copy;
    out.textContent = '시작하는 중…';
    try {
      const r = await fetch(this.api('look/request'), { method: 'POST', headers: CONTROL, body: JSON.stringify({ idea, engine }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `오류 ${r.status}`);
      if (j.started) {
        this.state.job = j.job;
        this.showJob();
      } else {
        out.dataset.copy = '1';
        out.innerHTML = `아래 내용을 원하는 에이전트(Claude Code, Codex 등)에게 붙여 넣으세요. 바쁘지 않은 창에 넣는 게 좋아요.
          <textarea readonly rows="5">${esc(j.prompt)}</textarea><button type="button" class="lk-copy">복사</button>`;
        out.querySelector('.lk-copy').addEventListener('click', async () => {
          await navigator.clipboard.writeText(j.prompt).catch(() => {});
          out.querySelector('.lk-copy').textContent = '복사했어요';
        });
      }
    } catch (e) {
      out.textContent = e.message;
    }
  }
}

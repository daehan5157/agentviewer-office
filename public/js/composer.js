// The orchestrator's box: what it last answered, what it is asking, its live terminal screen,
// and an input to hand it work (typed into its Orca terminal; it splits the work among its
// workers). Lives outside the cards (they are re-rendered every second, which would wipe what
// you type or have scrolled to).
import { esc } from './meta.js';

export const canPrompt = (a) => !!(a?.orca?.paneKey && a.orca.lead);

const SCREEN_POLL_MS = 3000;

export class Composer {
  /**
   * @param doc  the document to build in (the page, or the PiP window)
   * @param api  { send(agent, text), screen(agent), key(agent, key) } → { ok, error, … }
   */
  constructor(doc, api) {
    this.api = api;
    this.agent = null;
    this.busy = false;
    this.reply = null;
    this.screenOpen = false;
    this.timer = null;
    this.win = doc.defaultView;
    this.el = doc.createElement('form');
    this.el.className = 'composer';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="c-ask" hidden></div>
      <details class="c-reply" hidden><summary>마지막 답변 <span class="c-when"></span></summary><div class="c-reply-body"></div></details>
      <div class="c-screen-wrap" hidden>
        <div class="c-choices"></div>
        <pre class="c-screen"></pre>
      </div>
      <div class="c-head"><span class="c-to"></span><button type="button" class="c-toggle">화면 보기</button></div>
      <textarea rows="2" maxlength="4000" placeholder="업무를 지시하거나 질문에 답해 주세요 (Ctrl+Enter 보내기)"></textarea>
      <div class="c-foot"><span class="c-status" role="status"></span><button type="submit" class="c-send">보내기</button></div>`;
    const q = (s) => this.el.querySelector(s);
    this.input = q('textarea');
    this.status = q('.c-status');
    this.button = q('.c-send');
    this.askEl = q('.c-ask');
    this.replyEl = q('.c-reply');
    this.screenWrap = q('.c-screen-wrap');
    this.screenEl = q('.c-screen');
    this.choicesEl = q('.c-choices');
    this.toggle = q('.c-toggle');
    this.canScreen = true;
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submit();
      }
      e.stopPropagation(); // Esc etc. belong to the text box while typing
    });
    this.toggle.addEventListener('click', () => this.showScreen(!this.screenOpen));
    this.choicesEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-key]');
      if (b) this.press(b.dataset.key, b.textContent);
    });
  }

  /** at this PC: the orchestrator's screen and answers too */
  setRole({ canScreen }) {
    this.canScreen = !!canScreen;
    this.toggle.hidden = !this.canScreen;
    if (!this.canScreen) this.showScreen(false);
    this.input.placeholder = '업무를 지시하거나 질문에 답해 주세요 (Ctrl+Enter 보내기)';
  }

  /** Show the box for this agent (or hide it). Keeps the draft while the same agent stays selected. */
  update(agent) {
    if (!canPrompt(agent)) {
      this.el.hidden = true;
      this.agent = null;
      this.showScreen(false);
      return;
    }
    const changed = this.agent?.id !== agent.id;
    if (changed) {
      this.input.value = '';
      this.setStatus('');
      this.reply = null;
      this.showScreen(false);
    }
    const wasAsking = !!this.agent?.orca?.asking;
    this.agent = agent;
    this.el.hidden = false;
    this.el.querySelector('.c-to').innerHTML = `👑 <b>${esc(agent.name)}</b>`;
    // what it is waiting on: open its screen so the question / choices are right there
    const asking = agent.orca.asking || '';
    this.askEl.hidden = !asking;
    this.askEl.textContent = asking ? `❗ 확인 필요 · ${asking}${this.canScreen ? '' : ' (서버 PC에서 확인해야 해요)'}` : '';
    if (asking && !wasAsking && this.canScreen) this.showScreen(true);
    // last answer: only touch the DOM when it changes (keeps it open / scrolled)
    const reply = agent.orca.reply || '';
    if (reply !== this.reply) {
      this.reply = reply;
      this.replyEl.hidden = !reply;
      this.replyEl.querySelector('.c-reply-body').textContent = reply;
      this.replyEl.querySelector('.c-when').textContent = reply ? `· ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신` : '';
    }
  }

  setStatus(text, kind = '') {
    this.status.textContent = text;
    this.status.className = `c-status ${kind}`;
  }

  showScreen(open) {
    this.screenOpen = open;
    this.screenWrap.hidden = !open;
    this.toggle.textContent = open ? '화면 닫기' : '화면 보기';
    try {
      this.win.clearTimeout(this.timer); // the PiP window may already be gone
    } catch {}
    if (open) this.pollScreen();
  }

  async pollScreen() {
    if (!this.screenOpen || !this.agent || !this.canScreen) return;
    try {
      const r = await this.api.screen(this.agent);
      if (!this.screenOpen) return;
      if (!r.ok) this.screenEl.textContent = r.error || '화면을 읽지 못했어요';
      else {
        const atBottom = this.screenEl.scrollHeight - this.screenEl.scrollTop - this.screenEl.clientHeight < 30;
        this.screenEl.textContent = (r.lines || []).join('\n') || '(빈 화면)';
        if (atBottom) this.screenEl.scrollTop = this.screenEl.scrollHeight;
        // only choices the screen itself spells out, pressing exactly that key
        this.choicesEl.innerHTML = (r.choices || [])
          .map((c) => `<button type="button" data-key="${esc(c.key)}">${c.n}. ${esc(c.label)} <kbd>${c.key === 'esc' ? 'Esc' : esc(c.key)}</kbd></button>`)
          .join('');
      }
    } catch (err) {
      this.screenEl.textContent = err.message;
    }
    this.timer = this.win.setTimeout(() => this.pollScreen(), SCREEN_POLL_MS);
  }

  async press(key, label) {
    if (!this.agent || this.busy) return;
    this.busy = true;
    this.setStatus(`보내는 중… ${label}`);
    try {
      const r = await this.api.key(this.agent, key);
      this.setStatus(r.ok ? `골랐어요 · ${label}` : r.error || '보내지 못했어요', r.ok ? 'ok' : 'err');
      this.choicesEl.innerHTML = '';
      this.win.clearTimeout(this.timer);
      this.timer = this.win.setTimeout(() => this.pollScreen(), 800);
    } finally {
      this.busy = false;
    }
  }

  async submit() {
    const text = this.input.value.trim();
    if (!text || !this.agent || this.busy) return;
    this.busy = true;
    this.button.disabled = true;
    this.setStatus('보내는 중… (에이전트가 받을 때까지 최대 15초)');
    try {
      const r = await this.api.send(this.agent, text);
      if (r.ok) {
        this.input.value = '';
        this.setStatus(r.started === false ? '입력은 들어갔어요 · 아직 시작 확인 전' : '보냈어요 · 작업을 시작했어요', 'ok');
      } else this.setStatus(r.error || '보내지 못했어요', 'err');
    } catch (err) {
      this.setStatus(err.message || '보내지 못했어요', 'err');
    } finally {
      this.busy = false;
      this.button.disabled = false;
    }
  }
}

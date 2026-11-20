// Makes a new office theme with a separate, one-off headless agent (Claude Code `claude -p` or
// `codex exec`) instead of typing into an agent that is busy with other work.
//
// The worker gets no tools: it only answers with the theme JSON. Agentviewer checks the JSON
// (cleanTheme) and writes the file itself, so the worker never touches the disk.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanTheme, slugify, THEME_SPEC } from './look.js';

const TIMEOUT_MS = 6 * 60 * 1000;

export const ENGINES = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    args: () => ['-p', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence', '--output-format', 'text'],
  },
  codex: {
    name: 'Codex',
    bin: 'codex',
    args: (outFile) => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '-o', outFile, '-'],
  },
};

/** full path of an installed CLI (PATH, then ~/.local/bin), or null */
export function findBin(name, env = process.env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const dirs = [...String(env.PATH || env.Path || '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')].filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const f = path.join(d, name + e);
      try {
        if (fs.statSync(f).isFile()) return f;
      } catch {}
    }
  }
  return null;
}

/** the first {...} block in an answer that parses as JSON (agents sometimes wrap it in ```json) */
export function extractJson(s) {
  const str = String(s || '');
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const cand of [fence?.[1], str]) {
    if (!cand) continue;
    const a = cand.indexOf('{');
    const b = cand.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    try {
      return JSON.parse(cand.slice(a, b + 1));
    } catch {}
  }
  return null;
}

export class ThemeWorker {
  /**
   * @param look   the Look store (themesDir, builtin)
   * @param bins   optional { claude: path, codex: path } overrides (tests)
   * @param run    optional runner (tests): (bin, args, stdin, cwd) => Promise<stdout>
   */
  constructor({ look, bins, run, log = () => {} }) {
    this.look = look;
    this.bins = bins || Object.fromEntries(Object.entries(ENGINES).map(([id, e]) => [id, findBin(e.bin)]));
    this.run = run || runProcess;
    this.log = log;
    this.job = null;
  }

  /** [{ id, name }] engines installed on this PC */
  engines() {
    return Object.entries(ENGINES).filter(([id]) => this.bins[id]).map(([id, e]) => ({ id, name: e.name }));
  }

  status() {
    return this.job ? { ...this.job } : null;
  }

  async prompt(idea) {
    const spec = await fsp.readFile(THEME_SPEC, 'utf8').catch(() => '');
    const example = await fsp.readFile(path.join(this.look.builtin, 'pool.json'), 'utf8').catch(() => '');
    return [
      `Agentviewer 대시보드(픽셀아트 사무실)의 배경 테마 JSON을 하나 만들어 줘. 주제: "${idea}"`,
      '',
      '규칙:',
      '- 답에는 JSON 객체 하나만 써. 설명, 코드블록 표시, 다른 글은 쓰지 마.',
      '- 파일을 만들거나 명령을 실행하지 마. 답으로 JSON만 주면 Agentviewer가 저장해.',
      '- 바닥·벽·창문 색과 바닥 무늬를 주제에 맞게 고르고, 주제를 살리는 픽셀 소품(props)을 5~15개 그려.',
      '- 사무실 책상·의자가 어색한 주제라면 workstation 으로 주제에 맞는 책상(상태 화면 자리 포함)과 의자도 그려.',
      '- pixels 의 각 줄은 같은 길이로 맞춰.',
      '',
      '=== 형식 설명서 ===',
      spec,
      '',
      '=== 예시 (수영장 테마) ===',
      example,
    ].join('\n');
  }

  /** start making a theme in the background; returns the job (only one at a time) */
  start(idea, engine) {
    if (this.job?.state === 'running') throw new Error(`이미 "${this.job.idea}" 테마를 만드는 중이에요`);
    if (!ENGINES[engine] || !this.bins[engine]) throw new Error('이 PC에 없는 에이전트예요');
    const job = { state: 'running', idea, engine, engineName: ENGINES[engine].name, started: Date.now() };
    this.job = job;
    this.make(job).then(
      (themeId) => Object.assign(job, { state: 'done', themeId, ended: Date.now() }),
      (err) => Object.assign(job, { state: 'error', error: String(err.message || err).slice(0, 200), ended: Date.now() }),
    ).finally(() => this.log(`theme "${idea}" by ${engine}: ${job.state}${job.error ? ` (${job.error})` : ''}`));
    return { ...job };
  }

  async make(job) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agentviewer-theme-'));
    try {
      const outFile = path.join(tmp, 'answer.txt');
      const stdout = await this.run(this.bins[job.engine], ENGINES[job.engine].args(outFile), await this.prompt(job.idea), tmp);
      const answer = (await fsp.readFile(outFile, 'utf8').catch(() => '')) || stdout;
      const raw = extractJson(answer);
      if (!raw) throw new Error('에이전트가 테마 JSON을 돌려주지 않았어요');
      const base = slugify(job.idea) || 'my-theme';
      let id = base;
      for (let i = 2; fs.existsSync(path.join(this.look.themesDir, `${id}.json`)) || fs.existsSync(path.join(this.look.builtin, `${id}.json`)); i++) id = `${base}-${i}`;
      const t = cleanTheme(raw, id);
      if (!t || !(t.floor || t.wall || t.props?.length)) throw new Error('쓸 수 있는 테마 내용이 없었어요');
      delete t.id;
      if (!raw.name) t.name = job.idea.slice(0, 30);
      await fsp.mkdir(this.look.themesDir, { recursive: true });
      await fsp.writeFile(path.join(this.look.themesDir, `${id}.json`), `${JSON.stringify(t, null, 2)}\n`);
      return id;
    } finally {
      fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function runProcess(bin, args, stdin, cwd) {
  return new Promise((resolve, reject) => {
    const shell = /\.cmd$/i.test(bin);
    const child = spawn(bin, args, { cwd, windowsHide: true, shell, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('시간이 너무 오래 걸려서 멈췄어요'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      if (out.length < 2e6) out += d;
    });
    child.stderr.on('data', (d) => {
      if (err.length < 4000) err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`에이전트가 실패했어요 (${code}): ${err.trim().split('\n').pop() || ''}`));
    });
    child.stdin.end(stdin);
  });
}

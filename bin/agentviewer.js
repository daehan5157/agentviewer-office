#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { Store } from '../src/store.js';
import { createServer } from '../src/server.js';
import { Look } from '../src/look.js';
import { ThemeWorker } from '../src/themeworker.js';
import { createScanners } from '../src/scanners/index.js';
import { runMcpBridge } from '../src/mcp.js';
import { loadConfig } from '../src/config.js';
import { runScan } from '../src/scan-cli.js';

const HELP = `Agentviewer — 내 컴퓨터의 모든 AI 에이전트를 픽셀 오피스로 보여줍니다.

사용법
  agentviewer [serve] [옵션]     서버 실행 + 상시 스캔 (기본)
  agentviewer scan [옵션]         브라우저 없이 터미널에서 지금 감지되는 것 확인
  agentviewer mcp [--url URL]     MCP 클라이언트용 stdio 브리지
  agentviewer report [옵션]       셸/스크립트에서 상태 보고

scan 옵션
  --watch             2초마다 갱신
  --grep <패턴>       명령줄이 패턴과 맞는 프로세스와 부모·폴더 표시 (설정 예시 포함)
  --json              전체 스냅샷을 JSON으로 출력

serve 옵션
  --port <n>          포트 (기본 4747). 항상 이 PC(127.0.0.1)에서만 열립니다
  --config <file>     설정 파일 (기본 ~/.agentviewer/config.json)
  --demo              시뮬레이션 에이전트 추가
  --window <분>       최근 몇 분 내 활동한 세션을 표시할지 (기본 60)
  --no-claude --no-codex --no-gemini --no-proc --no-orca   개별 스캐너 끄기
  --orca-bin <경로>   Orca CLI 경로 (기본: 자동 탐색)
  --open              브라우저 열기

report 옵션
  --name <이름> --state <thinking|typing|reading|running|web|mcp|delegating|planning|waiting|done|idle>
  --task <작업> --detail <지금 하는 일> --client <클라이언트> --channel <경로> --parent <부모 id>
  --id <고정 id> --url <서버 주소> --finished
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--no-')) args[a.slice(5)] = false;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, argv, () => {});
}

async function serve(args) {
  const port = Number(args.port || process.env.PORT || 4747);
  const host = '127.0.0.1'; // this PC only: prompts and file paths are on screen
  const windowMs = Number(args.window || 60) * 60e3;
  const config = await loadConfig(args.config);
  const store = new Store({ removeMs: windowMs });
  const created = createScanners(store, args, config);
  const scanners = created.list;
  // handing tasks to agents: only the Orca orchestrator (it splits the work among its workers)
  const control = created.orca
    ? {
        canPrompt: (a) => !!(a.orca?.paneKey && a.orca.lead),
        sendPrompt: (a, text) => created.orca.sendPrompt(a.orca.paneKey, text),
        readScreen: (a) => created.orca.readScreen(a.orca.paneKey),
        sendKey: (a, key) => created.orca.sendKey(a.orca.paneKey, key),
      }
    : null;
  store.setScanner('config', { name: '설정', root: config.path, enabled: config.loaded, lastScan: Date.now(), custom: config.processes.length, error: null });
  for (const s of scanners) s.start();
  setInterval(() => store.tick(), 1000);

  const look = new Look();
  const themeWorker = new ThemeWorker({ look, log: (m) => console.error(m) });
  const server = createServer(store, { control, look, themeWorker, log: (m) => console.error(m) });
  server.listen(port, host, async () => {
    const url = `http://localhost:${port}/`;
    console.log(`Agentviewer 실행 중 → ${url}  (이 PC에서만 열림)`);
    console.log(`스캔: ${scanners.map((s) => s.constructor.name.replace('Scanner', '')).join(', ')}${config.loaded ? ` · 설정 ${config.path} (사용자 정의 ${config.processes.length}개)` : ''}`);
    if (args.open) openBrowser(url);
  });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `포트 ${port}가 이미 사용 중입니다. --port 로 바꿔보세요.` : err.message);
    process.exit(1);
  });
  const shutdown = () => {
    for (const s of scanners) s.stop?.();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function report(args) {
  const url = args.url || process.env.AGENTVIEWER_URL || 'http://127.0.0.1:4747';
  const body = {
    id: args.id, name: args.name || process.env.USER || 'agent', state: args.state, task: args.task, detail: args.detail,
    client: args.client || 'CLI', channel: args.channel || 'CLI', parent: args.parent, tool: args.tool, mcp_server: args.mcp,
    finished: !!args.finished, ttl_seconds: args.ttl ? Number(args.ttl) : undefined,
  };
  const r = await fetch(`${url}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error(`보고 실패: ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  console.log((await r.json()).ids.join('\n'));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'serve';
if (args.help || cmd === 'help') console.log(HELP);
else if (cmd === 'serve') serve(args);
else if (cmd === 'demo') serve({ ...args, demo: true });
else if (cmd === 'scan' || cmd === 'doctor') runScan(args).catch((e) => {
  console.error(`스캔 실패: ${e.message}`);
  process.exit(1);
});
else if (cmd === 'mcp') runMcpBridge({ url: args.url || process.env.AGENTVIEWER_URL, name: args.name }).then(() => process.exit(0));
else if (cmd === 'report') report(args).catch((e) => {
  console.error(`보고 실패: ${e.message}`);
  process.exit(1);
});
else {
  console.error(`알 수 없는 명령: ${cmd}\n`);
  console.log(HELP);
  process.exit(1);
}

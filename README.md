# Agentviewer

내 컴퓨터에서 돌아가는 **모든 AI 에이전트를 픽셀 오피스로** 보여주는 대시보드입니다.
설치한 PC의 Claude Code, Codex, Gemini CLI, Orca, MCP로 붙은 앱, 직접 만든 에이전트까지 **상시 스캔**해서,
각 에이전트가 **어떤 경로로 들어왔고 지금 무슨 일을 하는지** 실시간으로 보여줍니다.

- **출입문 = 유입 경로**: `CLI` · `IDE` · `앱` · `SDK·API` · `MCP` · `클라우드` 6개 문 중 자기 경로의 문으로 걸어 들어옵니다.
- **책상 모니터 = 지금 하는 일**: 코드 작성, 파일 읽기, 명령 실행, 웹 검색, MCP 호출, 위임, 계획, 승인 대기가 화면에 다르게 표시됩니다.
- **말풍선 = 구체적인 작업**: 예) `CLI › npm test`, `MCP › github › create_pull_request`, `도구 › Edit app.ts`.
- **MCP 서버실**: 실행 중인 MCP 서버가 랙으로 보이고, 에이전트가 MCP 도구를 호출하면 데이터 패킷이 날아갑니다.
- **하위 에이전트**: 부모 책상 옆자리에 나타났다가, 일을 마치면 부모에게 보고하고 사라집니다.
- **🎨 꾸미기**: 사무실 테마(카페·공사장·수영장…)와 캐릭터 옷·소품을 바꾸고, 내 AI 에이전트에게 새 테마를 그려 달라고 할 수 있습니다.

모든 데이터는 **설치한 PC 안에서만** 읽고 보여줍니다. 어디로도 보내지 않습니다.
외부 의존성 없이 Node.js 18 이상만 있으면 됩니다.

## 빠르게 시작

```bash
git clone https://github.com/daehan5157/agentviewer-office.git
cd agentviewer-office
node bin/agentviewer.js --open
```

브라우저에서 <http://localhost:4747> 이 열립니다. 아직 에이전트가 없다면 데모로 미리 볼 수 있어요.

```bash
node bin/agentviewer.js --demo
```

### Windows 설치 프로그램

Node 설치 없이 쓰려면 설치 zip을 만들어 배포할 수 있습니다 (Node 런타임 포함).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build.ps1
```

`dist\Agentviewer-<버전>-windows-x64.zip`을 받은 사람은 압축을 풀고 `Install.cmd`를 실행하면 됩니다.
`%LOCALAPPDATA%\Agentviewer`에 설치되고, 로그온 때 자동 실행되며, 바탕화면·시작 메뉴에 바로가기가 생깁니다.
기본은 **그 PC에서만** 열립니다. 지우려면 설치 폴더의 `Uninstall.cmd`.

## 내 컴퓨터에서 확인하기

브라우저 없이 터미널에서 바로, 지금 무엇이 감지되는지 볼 수 있습니다.

```bash
node bin/agentviewer.js scan            # 한 번 스캔해서 보고
node bin/agentviewer.js scan --watch    # 2초마다 갱신
node bin/agentviewer.js scan --grep orca  # "orca"가 들어간 프로세스 + 부모·폴더 + 설정 예시
node bin/agentviewer.js scan --json     # 원시 데이터
```

감지가 안 되는 프로그램이 있으면 `scan --grep <이름>`으로 프로세스를 찾고, 마지막 줄에 나오는 설정 예시를 `~/.agentviewer/config.json`에 넣으면 됩니다.

## 무엇을 어떻게 스캔하나

| 대상 | 방법 | 보여주는 정보 |
| --- | --- | --- |
| **Claude Code** (CLI · VS Code · JetBrains · Desktop · SDK) | `~/.claude/projects/**/*.jsonl` 세션 기록을 실시간으로 읽음 (하위 에이전트 포함) | 요청, 사용 중인 도구, MCP 호출, 할 일 목록, 모델, 브랜치, 승인 대기 추정 |
| **Codex** (CLI · VS Code · exec) | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | 요청, 셸 명령, 패치, MCP 호출, 턴 종료 |
| **Gemini CLI** | `~/.gemini/tmp/*/chats/session-*.json` | 요청, 도구 호출과 승인 상태 |
| **실행 중인 프로세스** | macOS·Linux `ps`, Windows `Get-CimInstance` | Aider, OpenCode, Goose, Cursor Agent, Amp, Copilot CLI, Ollama 등 CLI 에이전트와 Claude · ChatGPT · Cursor · Windsurf · LM Studio 앱 |
| **MCP 서버** | 프로세스 스캔 + 도구 호출 기록 | 서버 이름, 그 서버를 띄운 에이전트/앱, 호출 수 |
| **MCP 클라이언트** | `agentviewer mcp` 브리지 | 브리지를 추가한 앱이 스스로 작업을 보고 |
| **Orca** (에이전트 오케스트레이터) | `orca worktree ps --json` (Orca 실행 중일 때) + `~/orca/workspaces` | 워크트리별 에이전트, 정확한 승인 대기 상태, 코디네이터 → 워커 관계 |
| **직접 만든 시스템** | `clients/` 보고 클라이언트, `POST /api/report`, `agentviewer report`, 설정 파일 | 원하는 이름·경로·상태·작업 |

"승인 대기"는 추정입니다. 도구 호출 뒤 기록이 몇 초간 멈추면 권한 확인 창이 떠 있을 가능성이 높다고 보고 빨간 느낌표로 표시합니다.

## Orca 연결

[Orca](https://github.com/stablyai/orca)로 띄운 에이전트는 따로 설정할 것 없이 **앱 출입문**으로 들어오고, 이름 앞에 🐋가 붙습니다.

- Orca가 실행 중이면 공식 CLI `orca worktree ps --json`으로 상태를 읽습니다. Orca가 꺼져 있을 때는 CLI를 부르지 않습니다.
- 코디네이터가 띄운 **워커는 코디네이터 옆자리**에 앉습니다.
- 오케스트레이터(👑)에게는 대시보드에서 **작업 지시**를 보내고, 터미널 화면을 보고, 화면에 뜬 **승인 선택지에 답할** 수 있습니다.

Orca CLI는 자동으로 찾습니다. 다른 위치라면 `--orca-bin <경로>`를 쓰거나 설정 파일에 `{ "orca": { "bin": "/경로/orca" } }`.

## 🎨 꾸미기 (테마 · 캐릭터)

대시보드 오른쪽 위 **🎨 꾸미기**에서:

- **배경 테마**: 기본 사무실, 카페, 공사장, 수영장 중에서 고릅니다. 테마는 바닥·벽·소품뿐 아니라 **책상과 의자**도 바꿀 수 있어요 (수영장은 물에 뜬 테이블과 튜브, 공사장은 각목 작업대와 양동이). 에이전트 상태 화면은 그대로 보입니다.
- **🤖 새 테마 만들어 달라기**: 주제(예: "우주정거장")를 적으면 이 PC에 설치된 Claude Code(`claude -p`)나 Codex(`codex exec`)를 **따로 한 번 실행**해서 테마를 그립니다. 지금 일하고 있는 에이전트에게는 끼어들지 않습니다. 이 일꾼은 도구(파일 쓰기·명령 실행)가 꺼진 채로 JSON만 답하고, Agentviewer가 검사해서 저장합니다.
- **캐릭터 꾸미기**: 에이전트마다 머리·피부·옷 색과 소품(야구모자, 안전모, 수영모, 비니, 헤드폰, 안경)을 정합니다.

설정은 그 PC의 `~/.agentviewer`에만 저장됩니다.

### AI 에이전트가 JSON 파일로 테마 바꾸기

대시보드 버튼 없이, 쓰고 있는 AI 에이전트에게 직접 시켜도 됩니다. 에이전트에게 이렇게 말하세요.

> Agentviewer 테마를 "도서관"으로 만들어서 적용해 줘. 방법은 저장소의 AGENTS.md를 봐.

에이전트가 할 일은 두 가지뿐입니다 ([AGENTS.md](AGENTS.md), 형식은 [docs/theme-spec.md](docs/theme-spec.md)).

1. 테마 파일을 `~/.agentviewer/themes/<이름>.json`에 저장합니다.
2. 적용하려면 `~/.agentviewer/look.json`의 `"theme"` 값을 그 이름으로 바꿉니다 (다른 값은 그대로).

열려 있는 대시보드는 5초 안에 알아서 바뀝니다. 서버를 다시 켤 필요가 없습니다.
테마 파일은 데이터일 뿐이라, 서버가 알 수 없는 키·잘못된 색·너무 큰 그림을 걸러 내고 화면은 색칠만 합니다.

## 다른 경로 연결하기

### 1. MCP 클라이언트 (Claude 앱, Cursor, Windsurf, VS Code 등)

```json
{
  "mcpServers": {
    "agentviewer": {
      "command": "node",
      "args": ["/절대경로/agentviewer/bin/agentviewer.js", "mcp"]
    }
  }
}
```

그 앱이 **MCP 출입문**으로 들어와 `agentviewer_report` 도구로 지금 하는 일을 보고합니다.

### 2. HTTP API (LangGraph, CrewAI, 직접 만든 오케스트레이터 등)

```bash
curl -X POST http://127.0.0.1:4747/api/report \
  -H 'content-type: application/json' \
  -d '{ "id": "nightly", "name": "야간 배치", "client": "cron", "state": "running", "task": "DB 백업", "detail": "$ pg_dump", "path": "CLI › pg_dump" }'
```

| 필드 | 설명 |
| --- | --- |
| `id` | 고정 ID. 같은 ID로 보내면 같은 캐릭터가 갱신됨 |
| `name`, `client`, `channel` | 표시 이름, 클라이언트, 유입 경로 |
| `door` | 출입문 직접 지정: `cli` `ide` `app` `api` `mcp` `cloud` |
| `state` | `thinking` `typing` `reading` `running` `web` `mcp` `delegating` `planning` `waiting` `done` `idle` |
| `task`, `detail`, `path` | 전체 작업, 지금 하는 일, 작업 경로 |
| `parent` | 부모 에이전트 ID → 하위 에이전트로 표시 |
| `mcp_server`, `tool` | MCP 서버를 통해 일하는 중이면 서버실로 패킷이 날아감 |
| `ttl_seconds` | 이 시간 동안 보고가 없으면 퇴근 (기본 600초) |
| `finished` | `true`면 작업을 마치고 퇴장 |

보고 API는 이 PC(localhost)에서 오는 요청만 받습니다.

### 3. 보고 클라이언트 (Python · Node, 의존성 없음)

```python
from agentviewer_reporter import Reporter   # clients/python/agentviewer_reporter.py

av = Reporter("MyApp", client="내 파이프라인")
av.update("web", "피드 확인 중", task="피드 감시")
with av.step("typing", "요약 생성"):
    summary = summarize(item)
av.done("완료")
```

Node는 `clients/node/agentviewer-reporter.mjs`. Agentviewer가 꺼져 있어도 보고만 조용히 버려집니다.

### 4. 프로세스 이름으로 자동 감지

`~/.agentviewer/config.json`:

```json
{ "processes": [ { "name": "MyApp", "match": "python.*myapp", "client": "MyApp", "door": "cli" } ] }
```

## 옵션

```text
node bin/agentviewer.js [옵션]
  --port <n>        포트 (기본 4747). 항상 이 PC(127.0.0.1)에서만 열립니다
  --config <file>   설정 파일 (기본 ~/.agentviewer/config.json)
  --window <분>     최근 몇 분 안에 활동한 세션을 보여줄지 (기본 60)
  --demo            시뮬레이션 에이전트 추가
  --no-claude --no-codex --no-gemini --no-proc --no-orca   스캐너 개별 끄기
  --orca-bin <경로> Orca CLI 경로
  --open            브라우저 열기
```

## 보안

화면에는 **프롬프트 내용과 파일 경로가 그대로 보입니다.** 그래서 Agentviewer는 **설치한 PC 안에서만** 동작합니다.

- 서버는 항상 `127.0.0.1`에만 열립니다. 다른 PC·휴대폰·인터넷에서 접속하는 기능은 없습니다.
- 들어오는 요청도 연결 주소와 Host가 모두 이 PC여야 받습니다. 다른 사이트가 DNS 리바인딩으로 `localhost`를 읽으려 하면 거절합니다.
- 에이전트를 움직이는 일(작업 지시, 승인 답하기, 꾸미기 변경, 테마 만들기)은 **이 PC에서 연 Agentviewer 페이지**만 할 수 있습니다. Origin도 이 PC여야 하고, 다른 사이트는 붙일 수 없는 전용 헤더가 필요합니다.
- 모든 응답에 다른 사이트의 프레임 안에 들어가지 못하게 하는 헤더(클릭재킹 방지)와 nosniff, no-referrer를 붙입니다.
- 세션 기록과 프로세스 목록은 읽기만 하고, 어디로도 보내지 않습니다. 새 테마를 그리는 일꾼(`claude`/`codex`)만 테마 주제와 형식 설명서를 해당 AI 서비스로 보냅니다.

보안 문제를 발견하면 공개 이슈 대신 GitHub의 **Security › Report a vulnerability**로 비공개로 알려 주세요.

## 라이선스

[MIT](LICENSE)

## 한계

- Codex와 Gemini CLI의 기록 형식은 버전에 따라 달라질 수 있어, 알 수 없는 항목은 건너뜁니다.
- Windows에서는 프로세스의 작업 폴더를 알 수 없어서, 세션과 프로세스를 시작 시각으로 짝짓습니다. 보안 프로그램이 주기적인 PowerShell 실행을 문제 삼으면 `--no-proc`으로 끌 수 있습니다.
- 클라우드에서 도는 세션(예: claude.ai/code)은 내 컴퓨터에 기록이 없어서 자동으로는 보이지 않습니다. HTTP API로 보고하게 하세요.

## 개발

```bash
npm test
```

```text
bin/agentviewer.js        CLI (serve · scan · mcp · report)
src/scanners/             claude · codex · gemini · processes · orca · demo 스캐너
src/server.js             HTTP · SSE · 보고 API · 접근 제어
src/look.js               테마·캐릭터 꾸미기 (검사 · 저장)
src/themeworker.js        새 테마를 그리는 일회용 에이전트
src/mcp.js                stdio MCP 브리지
clients/                  직접 만든 시스템용 보고 클라이언트 (Python · Node)
public/                   픽셀 오피스 화면, 기본 테마 (public/themes)
packaging/windows/        Windows 설치 zip 만들기
docs/theme-spec.md        테마 JSON 형식
```

# AI 에이전트용 안내: Agentviewer 테마 바꾸기

사용자가 "Agentviewer 테마를 ○○로 바꿔 줘 / 만들어 줘"라고 하면 아래만 하세요.
서버를 다시 켜거나 저장소 코드를 고칠 필요는 없습니다.

## 1. 테마 파일 만들기

- 형식: [docs/theme-spec.md](docs/theme-spec.md)
- 예시: [public/themes/pool.json](public/themes/pool.json), [public/themes/construction.json](public/themes/construction.json)
- 저장 위치: `~/.agentviewer/themes/<이름>.json`
  - Windows: `%USERPROFILE%\.agentviewer\themes\<이름>.json`
  - `<이름>`은 영문 소문자·숫자·한글·`-`만 (예: `library`, `우주정거장`)
  - 폴더가 없으면 만드세요. 같은 이름의 파일이 이미 있으면 덮어쓰지 말고 다른 이름을 쓰세요.
- 파일은 UTF-8 JSON 하나. 최대 256KB.
- 바닥·벽·창문 색과 바닥 무늬를 주제에 맞게, 주제를 살리는 픽셀 소품(`props`) 5~15개.
- 사무실 책상·의자가 어색한 주제라면 `workstation`으로 책상(상태 화면 자리 `screen` 포함)과 의자도 그리세요.
- `pixels`의 각 줄은 같은 길이로, 색은 `#rrggbb`만.

## 2. 적용하기

`~/.agentviewer/look.json`의 `"theme"` 값만 테마 이름으로 바꾸고, 나머지(`chars` 등)는 그대로 두세요.
파일이 없으면 이렇게 만드세요.

```json
{ "theme": "library", "chars": {} }
```

열려 있는 대시보드는 5초 안에 바뀝니다.

## 3. 캐릭터 차림 바꾸기 (선택)

`look.json`의 `chars`에 에이전트 이름별로 넣습니다.

```json
{ "theme": "library", "chars": { "Codex": { "shirt": "#2b6db0", "accessory": "glasses" } } }
```

`accessory`: `none` `cap` `hardhat` `swimcap` `beanie` `headphones` `glasses`.
색 키: `hair` `skin` `shirt` `pants` `accessoryColor` (`#rrggbb`).

## 하지 말 것

- `~/.agentviewer/themes/`의 새 테마 파일과 `look.json` 말고는 건드리지 마세요.

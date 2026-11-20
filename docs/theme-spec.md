# Agentviewer 테마 파일 형식 (v1)

사무실 배경을 바꾸는 JSON 파일입니다. 사람이나 AI 에이전트가 만들어
`%USERPROFILE%\.agentviewer\themes\<영문-id>.json` (mac/linux: `~/.agentviewer/themes/`)에 저장하면
대시보드의 **🎨 꾸미기 > 테마** 목록에 바로 나타납니다. 파일 이름(확장자 뺀 것)이 테마 id입니다.

규칙
- 색은 모두 `#rrggbb` (예: `#f2c230`). 그 밖의 형식은 무시됩니다.
- 모르는 키는 무시됩니다. 빠진 항목은 기본 사무실 색을 씁니다.
- 파일 크기 256KB 이하, 소품 80개 이하, 소품 그림 48×48 칸 이하.

```jsonc
{
  "name": "공사장",                 // 목록에 보일 이름 (30자)
  "icon": "🚧",                     // 이모지 하나
  "description": "안전모 쓰고 일하는 현장",   // 한 줄 설명 (120자)

  "floor": {
    "pattern": "concrete",          // planks | tiles | checker | carpet | grass | water | dirt | concrete
    "colors": ["#9a958c", "#8f8a80", "#a5a096"],  // 1~6색: 첫 색이 바탕, 나머지는 무늬
    "line": "#7d786f"               // 줄눈·이음매 색
  },
  "wall": {                         // 뒷벽 (위에서 아래 순)
    "top": "#c9bca5",               // 천장 몰딩
    "paper": "#efe6d6",             // 벽지
    "stripe": "#e7dbc6",            // 벽지 줄무늬
    "trim": "#7d5f43",              // 벽지와 징두리판 사이 띠
    "panel": "#a98663",             // 징두리판 (벽 아래쪽 판)
    "panelLine": "#977452",         // 징두리판 세로줄
    "base": "#6b4f38"               // 걸레받이
  },
  "windows": { "show": true, "frame": "#8b6d4f", "sill": "#e3d5bd" },   // show:false 면 창문 없음
  "lounge": ["#5f4b73", "#69547f", "#57446a"],   // 오른쪽 아래 휴게실 바닥 (바탕, 무늬, 테두리)
  "sideWall": ["#5a4e66", "#6d6080", "#504560"], // 좌우 벽
  "bottomWall": ["#4a3f55", "#55496a", "#6d6080"], // 아래 벽돌 벽 (바탕, 줄눈, 윗단)
  "outside": { "sidewalk": "#9a9ea8", "grass": "#4f8a3a", "grass2": "#5fa046" }, // 건물 밖

  // 픽셀 소품: 문자열 한 줄이 한 줄의 픽셀, 한 글자가 한 칸(1px).
  // '.' 이나 colors 에 없는 글자는 투명. colors 의 키는 영문자/숫자 한 글자.
  "props": [
    {
      "layer": "floor",             // floor (사무실 바닥) | wall (뒷벽) | outside (건물 밖 길)
      "x": 0.05, "y": 0.9,          // 그 영역 안의 위치 (0~1, 소품의 왼쪽 위 기준)
      "scale": 2,                   // 1~4배 크기
      "repeat": 3, "gap": 0.3,      // 오른쪽으로 반복 (gap: 영역 너비 대비 간격)
      "pixels": [
        "...o...",
        "..oWo..",
        "..ooo..",
        ".oWWWo.",
        "ooooooo"
      ],
      "colors": { "o": "#f07a1a", "W": "#ffffff" }
    }
  ],

  // 모든 캐릭터의 기본 차림 (사람마다 꾸민 것이 있으면 그게 우선)
  "outfit": { "accessory": "hardhat", "shirt": "#f2a33a" }
  // accessory: none | cap | hardhat | swimcap | beanie | headphones | glasses
  // 그 밖에 hair, skin, shirt, pants, accessoryColor 색 지정 가능

  // 책상·의자를 주제에 맞는 물건으로 바꾸기 (없으면 기본 사무실 책상)
  "workstation": {
    "desk": {
      "pixels": [ "....KKKKKK....", "..." ],   // 최대 가로 64 × 세로 40
      "colors": { "K": "#2b2b2b" },
      // 에이전트 상태 화면이 그려질 자리 (그림 안 좌표, 가로 4~40 · 세로 3~30)
      "screen": { "x": 5, "y": 1, "w": 18, "h": 10 }
    },
    "chair": {
      "pixels": [ "..." ],                      // 최대 가로 24 × 세로 28
      "front": [ "..." ],                       // (선택) 앉은 사람 위에 덧그릴 줄 (튜브 앞쪽 등)
      "colors": { "r": "#e5484d" }
    }
    // 의자가 필요 없으면 "chair": "none"
  }
}
```

참고
- 사무실은 가로 약 400~700px, 바닥 높이 약 150~250px 입니다 (책상 수에 따라 달라짐).
  소품은 8~24px 정도가 잘 어울립니다. 책상은 바닥 소품 위에 그려집니다.
- workstation 책상 그림은 책상 자리의 가운데 아래에 맞춰 그려지고, 의자 그림은 앉는 자리의
  가운데 아래에 맞춰집니다. 책상 그림은 가로 40~56, 세로 24~30 정도가 알맞습니다.
  screen 자리에는 작업 중/대기/승인 대기 화면이 자동으로 그려지니 그 부분은 테두리만 그려 두세요.
  (예: 수영장은 튜브 의자 + 물에 뜬 테이블, 공사장은 각목 작업대 + 엎어 놓은 양동이)
- 예시: `public/themes/construction.json` (공사장), `public/themes/pool.json` (수영장).

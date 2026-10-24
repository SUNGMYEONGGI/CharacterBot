<p align="center">
  <img src="build/icon.png" width="128" alt="CharacterBot">
</p>

<h1 align="center">CharacterBot</h1>

<p align="center">
  <b>내 구독으로 돌아가는, 내 Mac 위의 AI Bot 팀</b><br>
  Claude·ChatGPT 구독만 있으면 API 키 없이 여러 Bot을 동료처럼 부리는 데스크톱 앱
</p>

<p align="center">
  <a href="https://github.com/SUNGMYEONGGI/CharacterBot/releases">다운로드</a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#구조">구조</a> ·
  <a href="#보안-모델">보안 모델</a> ·
  <a href="#빌드와-배포">빌드와 배포</a>
</p>

> **알파 버전.** 개인용 프로토타입입니다. 실제 업무에 쓰기 전에 [보안 모델](#보안-모델)과 [한계](#한계)를 먼저 읽어 주세요.

---

## CharacterBot이란

CharacterBot은 Bot마다 이름, 성격(시스템 프롬프트), 모델, 기억, 작업 폴더를 따로 주고 메신저처럼 대화하는 데스크톱 앱입니다. Bot끼리 일을 나눠 맡고, 스레드에서 서로 대화하고, 정해진 시간이나 이벤트에 맞춰 스스로 일합니다.

- **구독 기반.** Claude Bot은 [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview)로, ChatGPT Bot과 이미지 생성은 [Codex SDK](https://github.com/openai/codex)로 실행합니다. 이 컴퓨터의 Claude Code·Codex 로그인을 그대로 쓰므로 API 키가 필요 없습니다.
- **앱 하나.** 서버, DB, Docker 없이 Electron 앱 하나로 돌아갑니다. 데이터는 전부 내 Mac에 남습니다.
- **Bot 팀.** 메인 Bot(★)이 요청을 받아 다른 Bot에게 나눠 맡기고 결과를 모아 보고합니다.

## 기능

| 영역 | 기능 |
|---|---|
| **대화** | DM, 그룹 채팅, 스레드, 리액션, 작업 중 표시("A, B 작업 중…"), 대화 압축(긴 대화 자동 요약) |
| **Bot 팀** | 메인 Bot 오케스트레이션, `message_bot`으로 Bot 간 위임, 스레드에서 `@이름`으로 다른 Bot 호출 |
| **Bot마다** | 시스템 프롬프트, 모델, 스킬, MCP 서버, 기억(편집 가능), 전용 작업 폴더, 프로필 아이콘 |
| **루틴** | 매일·주기 실행, 웹훅(`POST /hook/<key>`), 폴더 변경 감지, GitHub PR 변경 감지 |
| **앱 연결** | 원격·로컬 MCP 서버, OAuth 로그인, 비밀값은 OS 암호화 저장소(safeStorage)에 보관 |
| **승인** | 질문 카드, 초안 편집 후 승인 카드, 자동 검토 규칙, 활동 기록 |
| **음성** | 기기 안 음성 인식(macOS Speech)으로 음성 메모와 음성 채팅 |
| **결과물** | 마크다운, Mermaid, KaTeX, CSV 표, HTML 미리보기, ChatGPT 이미지 생성 |
| **편의** | 명령 팔레트, 단축키, 사이드바 섹션·고정·숨기기, 알림과 Dock 배지, 백그라운드 작업 패널 |
| **가져오기** | Bot 템플릿, CSV로 Bot 일괄 생성, 다른 AI의 기억 가져오기 |

## 빠른 시작

### 요구 사항

- macOS (Apple Silicon)
- Node.js 22 이상
- [Claude Code](https://docs.claude.com/en/docs/claude-code) 로그인 (`claude` 실행 후 로그인)
- ChatGPT Bot·이미지 생성을 쓰려면 Codex 로그인 (앱 설정에서 진행)
- 음성 기능을 쓰려면 Xcode Command Line Tools (`xcode-select --install`)

### 개발 모드로 실행

```bash
git clone https://github.com/SUNGMYEONGGI/CharacterBot.git
cd CharacterBot
npm install
npm start
```

### 앱으로 설치

[Releases](https://github.com/SUNGMYEONGGI/CharacterBot/releases)에서 `CharacterBot-<버전>-arm64.dmg`를 받아 응용 프로그램 폴더로 옮깁니다.

> Developer ID로 서명하지 않은 빌드는 처음 열 때 Gatekeeper가 막습니다. Finder에서 앱을 **우클릭 › 열기**로 한 번 열거나 `xattr -dr com.apple.quarantine /Applications/CharacterBot.app`을 실행하세요.

## 구조

```
┌──────────────────────── Electron main (main.cjs) ────────────────────────┐
│                                                                           │
│  상태 저장 (store.cjs)        게이트웨이 (gateway.cjs)   루틴·트리거       │
│  state.json + secrets.bin ── 모든 도구 호출 판정 ───── routines.cjs       │
│                                  ▲                     triggers.cjs      │
│                                  │                                        │
│  Claude Bot ── agent.cjs ── Claude Agent SDK ── PreToolUse hook          │
│  ChatGPT Bot ─ imagegen.cjs ─ Codex SDK ─────── 앱 도구 MCP (HTTP)        │
│                                  │                                        │
│                 앱 도구 MCP 서버 (tools.cjs)                               │
│                 ask_user · remember · message_bot · schedule_routine ...  │
└──────────────────────────────▲────────────────────────────────────────────┘
                               │ preload.cjs (window.desktop: init / act / onState)
┌──────────────────────────────┴──── Renderer ──────────────────────────────┐
│  app.js (채팅·사이드바) · settings.js · apps.js · rich.js · ui.js           │
└───────────────────────────────────────────────────────────────────────────┘
```

| 파일 | 역할 |
|---|---|
| `main.cjs` | 앱 상태, 액션, Bot 실행, 위임, 알림 |
| `agent.cjs` | Claude Agent SDK 실행, 요약 |
| `imagegen.cjs` | Codex SDK 실행 (ChatGPT Bot, 이미지) |
| `tools.cjs` | Bot이 쓰는 앱 도구 (in-process MCP + 로컬 HTTP MCP) |
| `gateway.cjs` | 허용·확인·거부 규칙, 계정 쓰기 차단 |
| `routines.cjs`, `triggers.cjs` | 일정·이벤트 루틴 |
| `mcp.cjs`, `oauth.cjs` | 외부 MCP 연결과 OAuth |
| `transcript.cjs` | 대화 기록을 프롬프트로 변환 |
| `stt.swift` | 기기 안 음성 인식 |

## 보안 모델

- **게이트웨이.** Bot의 모든 도구 호출은 `PreToolUse` 훅 하나를 거칩니다. 규칙에 따라 허용, 사용자 확인, 거부 중 하나로 결정하고 활동 기록에 남깁니다. 판정되지 않은 호출은 거부합니다.
- **계정 쓰기 차단 (`blockAccountWrites`, 기본 켜짐).** Slack, Gmail처럼 내 계정과 연결된 앱에 쓰는 도구 호출은 규칙과 상관없이 거부합니다.
- **ChatGPT Bot 격리.** Codex는 앱 전용 `CODEX_HOME`에서 돌고, apps·plugins·computer use·browser를 끈 채 앱 도구만 씁니다.
- **비밀값.** OS 암호화 저장소에 저장하고 화면과 Bot에는 가린 값만 보여 줍니다.
- **Bot 설정 격리.** 사용자의 `~/.claude` 훅, CLAUDE.md, 플러그인은 Bot에 들어가지 않습니다.

> **주의.** 계정 쓰기 차단은 MCP 앱 도구에만 적용됩니다. Bot이 셸이나 HTTP로 외부 API(예: 증권사·거래소)를 직접 호출하는 것은 막지 않습니다. Bot은 기본적으로 내 Mac에서 전체 권한으로 실행되므로, 돈이 오가는 계정의 키를 Bot 작업 폴더에 두지 마세요.

## 빌드와 배포

빌드는 [electron-builder](https://www.electron.build)로 합니다. 설정은 `package.json`의 `build` 항목에 있습니다.

```bash
npm test        # 단위 테스트
npm run dist    # dist/에 .dmg, .zip 생성 (Apple Silicon)
```

| 항목 | 내용 |
|---|---|
| 앱 ID | `com.sungmyeonggi.characterbot` |
| 아이콘 | `build/icon.svg`에서 만든 `build/icon.icns` (OctoBot) |
| 서명 | Developer ID가 없으면 `build/adhoc-sign.cjs`가 ad-hoc 서명 |
| 실행 파일 | Claude Code·Codex 바이너리와 `stt.swift`는 `app.asar.unpacked`에 풀어 둠 |

### 릴리스

`v*` 태그를 푸시하면 GitHub Actions(`.github/workflows/release.yml`)가 macOS에서 빌드해 GitHub Release 초안에 올립니다.

```bash
npm version patch          # 0.1.0 → 0.1.1, 태그 v0.1.1 생성
git push --follow-tags
```

정식 서명과 공증을 하려면 저장소 Secrets에 다음을 넣습니다.

| Secret | 값 |
|---|---|
| `CSC_LINK` | Developer ID Application 인증서(.p12)의 base64 |
| `CSC_KEY_PASSWORD` | 인증서 비밀번호 |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | 공증용 Apple 계정 |

### 아이콘 다시 만들기

```bash
cd build && mkdir icon.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s icon.svg -o icon.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) icon.svg -o icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns icon.iconset -o icon.icns && rm -r icon.iconset
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
```

## 한계

- macOS Apple Silicon만 지원합니다.
- 사용자는 한 명입니다. 로그인, 팀, 관리자 기능은 없습니다.
- Bot은 내 Mac에서 직접 실행됩니다. Bot별 VM·컨테이너 격리와 Bot 전용 브라우저는 아직 없습니다.
- 이메일·모바일 연동, 결제 기능은 없습니다.

## 로드맵

- [ ] Bot별 격리 실행 환경 (로컬 VM·컨테이너, 이후 클라우드)
- [ ] Bot 전용 브라우저와 사람이 대신 조작하기
- [ ] 주문·결제 API 차단 규칙
- [ ] 실제 업무 기준 평가 세트

## 참고

- UI와 사용 흐름은 [Grok Bot](https://grok.com) 데스크톱 앱을 참고했습니다. CharacterBot은 xAI, Anthropic, OpenAI와 관계없는 개인 프로젝트입니다.
- 루틴 제한(최소 15분 간격, 최대 20개, 10회 연속 실패 시 중지)과 게이트웨이 개념은 [CopilotKit OpenBot](https://github.com/CopilotKit/OpenBot)을 참고했습니다.
- 앱 연결 화면의 서비스 로고는 각 서비스가 공개한 아이콘이며, 해당 서비스를 식별하는 용도로만 씁니다.

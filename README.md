<div align="center">

<img src="build/icon.png" width="128" alt="PixelBot icon">

# PixelBot

**A team of AI coworkers that lives on your Mac and runs on the subscriptions you already pay for.** Give each Bot a name, a personality, a model, a memory and a folder of its own, then talk to them the way you talk to people: in DMs, in groups and in threads.

Claude Bots run on the Claude Agent SDK with your Claude login. ChatGPT Bots and image generation run on the Codex SDK with your ChatGPT login. No API keys, no server, no database: one desktop app, and everything stays on your machine.

[**Website**](https://sungmyeonggi.github.io/PixelBot/) · [**Download**](https://github.com/SUNGMYEONGGI/PixelBot/releases/latest/download/PixelBot-arm64.dmg) · [**Quick start**](#quick-start) · [**Features**](#features) · [**Architecture**](#architecture) · [**Security model**](#security-model) · [**Build and release**](#build-and-release)

[![Release](https://github.com/SUNGMYEONGGI/PixelBot/actions/workflows/release.yml/badge.svg)](https://github.com/SUNGMYEONGGI/PixelBot/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/SUNGMYEONGGI/PixelBot)](https://github.com/SUNGMYEONGGI/PixelBot/releases/latest)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
![Platform: macOS arm64](https://img.shields.io/badge/platform-macOS%20arm64-lightgrey.svg)
![Alpha](https://img.shields.io/badge/status-alpha-orange.svg)

</div>

> **Alpha, and a personal project.** PixelBot is early. It has been exercised by hand, not evaluated on real workloads. Expect rough edges, and read [Security model](#security-model) and [Limitations](#limitations) before you point it at anything that matters.

> **Your subscriptions, your machine.** PixelBot signs in through the Claude Code and Codex logins on this computer. It never asks for your password, never ships an OAuth client of its own for those logins, and keeps every conversation, memory and file under `~/Library/Application Support`.

> **The UI is in Korean.** Labels and the Bots' default instructions are written in Korean. The Bots answer in whatever language you write to them.

## What it is

A desktop chat app in which every contact is an agent. A fresh install starts with one Bot, **Octo**, which is also the **main Bot** (★): the first one you talk to, and the one that hands work to the others. Add more from `⌘N`, from a template, or from a CSV file.

Each Bot is configuration, not code:

- a **name, label, color and avatar** (shapes, or a profile icon generated with ChatGPT),
- a **system prompt** that sets its role and personality,
- a **model**: any Claude model your subscription offers, or a ChatGPT model through Codex,
- **skills** it can load on demand and **MCP servers** it may use,
- a **memory**: a list of facts about you that it reads every turn and you can edit,
- a **workspace**: its own folder, which is "its computer". Files it saves there show up in the library panel.

Bots work together. The main Bot gets a list of the team and their roles in its system prompt, and delegates with `message_bot`. Independent tasks go to several Bots at once. In a thread, anybody, human or Bot, can pull another Bot in with `@name`, and the Bots carry the conversation between themselves while you watch or step in.

Everything a Bot does to your computer or to a connected app passes through one gateway that decides first and records afterwards. See [Security model](#security-model).

## Built on two agent SDKs

| Engine | Used for | Authenticates with |
| --- | --- | --- |
| [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) (`@anthropic-ai/claude-agent-sdk`) | Claude Bots, conversation summaries | The Claude Code login on this Mac (subscription), or an Anthropic API key, or any Anthropic-compatible endpoint |
| [Codex SDK](https://github.com/openai/codex) (`@openai/codex-sdk`) | ChatGPT Bots, image generation, profile icons | The Codex (ChatGPT) login, kept in an app-private `CODEX_HOME` |

Both engines see the same app tools (`ask_user`, `remember`, `message_bot`, ...). Claude Bots get them from an in-process MCP server; Codex Bots get them from a loopback streamable-HTTP MCP server that opens for one turn, on a random port, behind a per-turn bearer token.

## Requirements

- macOS on Apple Silicon (arm64)
- Node.js 22 or later (to run from source)
- A Claude subscription, signed in with [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`, then log in). An Anthropic API key also works.
- Optional: a ChatGPT subscription for ChatGPT Bots and image generation (sign in from 설정 › 일반)
- Optional: Xcode Command Line Tools (`xcode-select --install`) for on-device speech recognition
- Optional: the GitHub CLI (`gh auth login`) for GitHub pull request triggers

## Quick start

### From a release

The quickest way installs the latest release into Applications and opens it:

```sh
curl -fsSL https://sungmyeonggi.github.io/PixelBot/install.sh | sh
```

Files downloaded with `curl` carry no quarantine flag, so macOS doesn't show the "Apple could not verify PixelBot" warning. The script is [`site/install.sh`](site/install.sh).

To install by hand instead:

1. Download [`PixelBot-arm64.dmg`](https://github.com/SUNGMYEONGGI/PixelBot/releases/latest/download/PixelBot-arm64.dmg), the latest release (or pick one from [Releases](https://github.com/SUNGMYEONGGI/PixelBot/releases)).
2. Drag **PixelBot** to Applications.
3. Builds without a Developer ID signature are ad-hoc signed, so Gatekeeper stops the first launch. Open System Settings › **Privacy & Security** and click **Open Anyway**, or run:

   ```sh
   xattr -dr com.apple.quarantine /Applications/PixelBot.app
   ```

### From source

```sh
git clone https://github.com/SUNGMYEONGGI/PixelBot.git
cd PixelBot
npm install
npm start      # builds into out/ and launches Electron
```

The app picks up your Claude Code login on first launch. If it does not, open 설정 (`⌘,`) › 일반 and sign in to Claude there.

## Try it

- Say hello to **Octo**, then ask it to create two Bots with different roles (or press `⌘N`).
- Ask the main Bot something that needs both of them. Watch the activity row ("A, B 작업 중…") and open the background tasks panel.
- Reply in a thread and write `@<Bot name>` to bring another Bot in; tell them to discuss and come back with one answer.
- Ask a Bot to `remember` something about you, then open its settings and edit the memory.
- Ask a Bot to check something every morning at 9, or whenever a file lands in `~/Downloads`. It creates a routine.
- Use the mic button for a voice memo, or start voice chat (wave button) and talk back and forth.
- Add a ChatGPT Bot and ask it to draw something.

## Main surfaces

| Surface | Purpose |
| --- | --- |
| Sidebar | Bots, groups and sections. Pinned first, unread dots, ★ on the main Bot. Right-click for pin, move to section, mark unread, rename, set as main Bot, hide, delete. |
| Chat | DMs and group chats with streaming replies, reactions, attachments, rich rendering, question cards and approval cards. |
| Threads | Side conversations under any message. `@name` pulls in any Bot; Bots reply to each other there. |
| Right panel | The Bot's profile, memory, skills, MCP servers, and its workspace library (files it made, viewable in-app). |
| Tasks panel | Running and recent background runs, with who is working on what. |
| `+` menu | New Bot, new group, templates, import Bots from CSV, import memory from another assistant. |
| 앱 연결 (`⇧⌘M`) | A catalog of 51 MCP apps (Google Workspace, Notion, Linear, GitHub, Figma, ...), custom MCP servers, `mcp.json` import, plugins. |
| 설정 (`⌘,`) | Four tabs: **일반** (account, providers, models, appearance, notifications), **컴퓨터** (what Bots may do on this Mac, review rules), **사용량 및 청구** (subscription usage), **업데이트**. |
| Skills (`⇧⌘W`), Routines, Activity log | Opened from the command palette (`⌘K`), Bot settings and the support menu. |

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` | Go to / run a command |
| `⌘N` | New Bot |
| `⌘,` | Settings |
| `⇧⌘M` | Connect apps |
| `⇧⌘W` | Skills |
| `⇧⌘F` | Find a Bot |
| `⌘I` | Focus the composer |
| `⌘B` | Toggle the sidebar |
| `⌥↑` / `⌥↓` | Previous / next chat |
| `⌘[` / `⌘]` | Back / forward |

## Features

- **Subscription first**: Claude Bots use the Claude Code OAuth login; ChatGPT Bots use the Codex login. API keys are optional, for those who want them, and are stored encrypted.
- **A main Bot that orchestrates**: one Bot is ★ main. Its system prompt lists the team with each role and tells it to delegate through `message_bot`, collect results, and report. Independent tasks are sent in parallel. The main Bot cannot be deleted until another takes its place.
- **Bot-to-Bot delegation**: `message_bot` drops a message in the target Bot's DM and returns its answer. If the target is busy, the call waits up to 10 minutes rather than fail.
- **Threads where Bots talk to each other**: mentions in a thread reach any Bot; without a mention the thread's participants answer. Replies hand off from Bot to Bot inside the thread.
- **Who is doing what**: pulsing dots in the Bot's color while it works, an activity row naming every Bot at work, and a tasks panel with the last 30 runs.
- **Memory you can edit**: Bots save facts with `remember` and drop them with `forget`. Edit any entry inline, or import up to 200 at once from another assistant with a copy-paste prompt.
- **Long conversations stay usable**: when a new session would replay more than 40,000 characters of history, older messages are summarized with Haiku and the last 20 are kept verbatim. The summary is cached and refreshed after 40 more messages. 대화 압축 does it on demand.
- **Routines on a clock**: daily at `HH:MM`, or every N minutes with a 15-minute floor. At most 20 enabled, and 10 failures in a row switch a routine off.
- **Routines on events**:
  - **Webhook**: `POST http://127.0.0.1:47819/hook/<key>` with any body (up to 64 KB). Loopback only; the key is 24 random hex characters.
  - **Folder**: any change under a folder, recursively, debounced by 5 seconds.
  - **GitHub**: a pull request opened or updated in `owner/name`, polled every 5 minutes through `gh`. The first poll is a baseline.

  Events that arrive while the chat is busy, or within 60 seconds of the last run, queue (up to 5) instead of being dropped.
- **Cards instead of guesses**: `ask_user` shows a choice card and the Bot waits. A draft to an outside app arrives as an editable approval card, and what you edit is what is sent.
- **Voice, on the device**: voice memos and turn-based voice chat use macOS Speech through a small Swift helper compiled on first use. Nothing leaves the machine for transcription. Voice chat replies are spoken with the system voice.
- **Rich answers**: Markdown, Mermaid diagrams, KaTeX math, CSV as tables, HTML files previewed in-app, generated images inline.
- **Skills**: instructions a Bot loads by name with `use_skill`. A Bot can propose one with `propose_skill`, and it is saved only when you press the button on the card.
- **Apps over MCP**: remote (URL, OAuth) and local (stdio) MCP servers, a catalog of 51, `mcp.json` import, and per-Bot grants. Google apps take a Google OAuth client you register once.
- **Notifications**: a system notification and a Dock badge for every approval or question waiting on you.
- **Import and export**: Bots export to `<name>.characterbot.json` templates and import back; Bots import in bulk from CSV (up to 50).

## Bot tools

The tools every Bot gets from the app, on top of the file, shell and web tools of its engine:

| Tool | What it does |
| --- | --- |
| `ask_user` | Shows a question card with options; the Bot ends its turn and waits for the answer. |
| `remember` / `forget` | Adds or removes an entry in the Bot's memory. |
| `message_bot` | Sends another Bot a DM and returns its reply. |
| `schedule_routine` | Creates a routine in this chat: `every_minutes`, `daily_time`, `webhook`, `watch_path` or `github_repo`. |
| `cancel_routine` | Switches a routine off. |
| `use_skill` | Loads a skill's full instructions. |
| `propose_skill` | Proposes a new skill as a card; saved on your click. |
| `set_status` | Shows what the Bot is doing under its avatar, e.g. "학회 정보 검색 중". |
| `list_models` | Lists the models a new Bot can run on. |
| `create_bot` / `update_bot` | Creates a Bot with a name, role, instructions and model, or changes them. |
| `create_team` / `add_to_team` | Creates a team chat with the given Bots, or adds members. |
| `message_team` | Posts to a team chat and returns the members' replies. |
| `request_meeting_approval` | Asks whether to accept a meeting invite you did not request; your answer grants one calendar reply. |

## Security model

- **One gateway**: every tool call, including those of subagents, passes a single `PreToolUse` hook. The decision is `allow`, `ask` or `deny`; anything the hook does not approve is refused by the SDK's permission callback.
- **Rules, deny first**: your rules match on tool name (glob), Bot, and a regular expression over the arguments. `deny` is evaluated before `allow`, then `ask`. A broken pattern never widens access.
- **Natural-language review rules**: "ask me before anything that sends email" and the like, judged per call; when rules disagree, asking wins.
- **Outside apps ask before writing**: a connected app's tool that is not a read (`list`, `get`, `search`, `read`, ...) asks first by default.
- **Account writes are blocked** (`blockAccountWrites`, on by default): writes to apps tied to your own accounts (claude.ai connectors and remote OAuth MCP servers, such as Slack or Gmail) are refused outright, whatever the rules say.
- **Nobody watching means no**: in a scheduled run, `ask` fails closed.
- **Codex Bots are fenced in**: an app-private `CODEX_HOME`, with apps, plugins, computer use and the browser switched off. Only the app's own tools are mounted.
- **Your Claude setup stays out**: Bots run with `settingSources: []`, so your `~/.claude` hooks, `CLAUDE.md` and plugins never reach them.
- **Secrets encrypted at rest**: OAuth tokens, API keys and MCP secrets live in `secrets.bin`, encrypted with Electron `safeStorage` (the macOS Keychain), and show only masked in the UI.
- **Loopback only**: the webhook server and the per-turn MCP endpoint bind to `127.0.0.1`.
- **A readable trail**: the activity log keeps the last 1,000 decisions with the rule that caused each.

> **What it does not stop.** The account-write block covers MCP tools. A Bot runs on your Mac with full permissions by default, so it can still reach an outside API through the shell or HTTP, for example a brokerage or exchange. Do not keep keys to accounts that move money in a Bot's workspace, set 설정 › 컴퓨터 › 이 컴퓨터에서 실행 to 먼저 묻기, and add `deny` rules for such hosts.

## Configuration

Everything is set in the app; there is no `.env`. What is stored where:

| Path (under `~/Library/Application Support/PixelBot/`) | Contents |
| --- | --- |
| `state.json` | Settings, Bots, chats, memories, skills, routines, rules, activity log, usage. |
| `secrets.bin` | Tokens and keys, encrypted with `safeStorage`. |
| `workspaces/<botId>/` | Each Bot's folder, its working directory. |
| `codex/` | The app-private `CODEX_HOME` for ChatGPT Bots. |
| `icons/`, `codex-inbox/` | Generated images and their inputs. |
| `bin/stt` | The compiled speech recognition helper. |

Settings worth knowing:

| Setting | Where | Default |
| --- | --- | --- |
| Provider and model | 설정 › 일반 | Claude subscription, default model |
| 이 컴퓨터에서 실행 | 설정 › 컴퓨터 | 항상 허용 (`allow`) |
| Full access | 설정 › 컴퓨터 | On |
| Automatic review | 설정 › 컴퓨터 | On |
| `blockAccountWrites` | `state.json` › `settings` | `true` |
| Notifications, theme, accent, spellcheck, time zone, hardware acceleration | 설정 › 일반 | On, system, Bot color, on, auto, on |

## Architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│                                                                                │
│  main.ts ── actions, Bot turns, delegation, notifications, broadcast           │
│     │                                                                          │
│     ├── store.ts ......... state.json (+ secrets.bin via safeStorage)          │
│     ├── gateway.ts ....... allow / ask / deny, account-write block, audit      │
│     ├── routines.ts ...... schedules and limits                                │
│     ├── triggers.ts ...... webhook server :47819, folder watch, gh polling     │
│     ├── transcript.ts .... chat history to prompt                              │
│     │                                                                          │
│     ├── agent.ts ───── Claude Agent SDK ──── PreToolUse hook ──▶ gateway       │
│     │                       └── in-process MCP: tools.ts                       │
│     ├── imagegen.ts ─── Codex SDK ─────── loopback HTTP MCP: tools.ts          │
│     │                                                                          │
│     └── mcp.ts, oauth.ts, plugins.ts ... outside apps                          │
│                                                                                │
└──────────────────────────────────────▲─────────────────────────────────────────┘
                                       │ preload.ts: window.desktop
                                       │ init() · act(name, ...args) · onState · onStream
┌──────────────────────────────────────┴───────── Renderer ──────────────────────┐
│  app.ts (sidebar, chat, threads, panels) · settings.ts · apps.ts               │
│  rich.ts (Markdown, Mermaid, KaTeX, CSV) · ui.ts (elements, icons, popovers)   │
└────────────────────────────────────────────────────────────────────────────────┘
```

The code is TypeScript in strict mode. `tsc` only type-checks; [esbuild](https://esbuild.github.io) bundles each process into `out/` (`scripts/build.mjs`).

| Path | Purpose |
| --- | --- |
| `src/main/main.ts` | App state and every renderer action (`Actions`), Bot turns, delegation, summaries, routines, notifications. |
| `src/main/agent.ts` | One Claude turn on the Agent SDK; Haiku summaries; plan usage and model list. |
| `src/main/imagegen.ts` | One Codex turn; image and profile icon generation; Codex login status and usage. |
| `src/main/tools.ts` | The app's tools as an in-process MCP server and as a per-turn loopback HTTP MCP server. |
| `src/main/gateway.ts` | Rule matching, default effects, the account-write check. |
| `src/main/routines.ts` | Schedule validation, next run, limits. |
| `src/main/triggers.ts` | Webhook, folder and GitHub triggers. |
| `src/main/providers.ts` | Claude login, API key and custom endpoint providers. |
| `src/main/mcp.ts`, `oauth.ts`, `plugins.ts` | Outside MCP servers, their OAuth sign-in, plugins. |
| `src/main/transcript.ts` | Turns a chat (DM, group, thread) into the next prompt. |
| `src/main/store.ts` | Default state and migrations. |
| `src/main/stt.swift` | On-device speech recognition. |
| `src/preload/preload.ts` | The bridge: `init`, `act`, `onState`, `onStream`. |
| `src/renderer/` | The UI: `app.ts`, `settings.ts`, `apps.ts`, `rich.ts`, `ui.ts`, `index.html`, `styles.css`. |
| `src/shared/types.ts` | Types both processes share: `Bot`, `Conv`, `Message`, `Settings`, `Broadcast`, `DesktopApi`. |
| `test/main.test.ts` | Unit tests for the gateway, routines, store, tools, transcript, providers, MCP config and plugins. |
| `site/` | The landing page at [sungmyeonggi.github.io/PixelBot](https://sungmyeonggi.github.io/PixelBot/). |

The bridge is typed end to end: `act` takes an action name from `Actions` (`typeof actions` in `main.ts`), checks its arguments against that action's parameters and resolves to its return type, so a renamed action or a changed signature fails `npm run typecheck` in the renderer.

The renderer never touches Node. It calls `act(name, ...args)`; the main process runs the action and broadcasts the new state, and streams tokens over `onStream`.

## Build and release

Builds use [electron-builder](https://www.electron.build); the configuration is the `build` field in `package.json`.

```sh
npm run typecheck  # tsc, no output files
npm test           # unit tests (tsx)
npm run build      # esbuild: out/main.cjs, out/preload.cjs, out/renderer/
npm run dist       # build, then dist/PixelBot-arm64.dmg and PixelBot-<version>-arm64-mac.zip
```

| Item | Value |
| --- | --- |
| App ID | `com.sungmyeonggi.characterbot` |
| Targets | `dmg`, `zip`, arm64 |
| Icon | `build/icon.icns`, made from `build/source.png` |
| Packaged files | `out/**` (without source maps) and `package.json`; Node dependencies of the main process from `node_modules` |
| Unpacked from asar | the Claude Code binary, the Codex binary, `out/stt.swift`, so they can run |
| Signing | Developer ID when `CSC_LINK` is set; otherwise `build/adhoc-sign.cjs` signs ad hoc so Apple Silicon will run it |
| Entitlements | `build/entitlements.mac.plist`: JIT, unsigned executable memory, library validation off, microphone |

### Releasing

Releases are continuous. Every push to `main` that changes the app runs `.github/workflows/release.yml` on `macos-14`:

1. type-check, test and build,
2. set the version to `<major>.<minor>.<run number>` from `package.json` (for example `0.1.7`), so you never bump it by hand,
3. package the `.dmg` and `.zip`,
4. publish them as GitHub Release `v<version>` with notes generated from the commits, marked latest.

The download button on the website and in this README links to `releases/latest/download/PixelBot-arm64.dmg`, so it always serves the newest build. Changes to `site/` or Markdown files alone don't cut a release. To start a new minor line, change `version` in `package.json` (for example to `0.2.0`). You can also run the workflow by hand from the Actions tab.

### Website

`site/` is a static page bundled by `scripts/build-site.mjs` (it reuses the app's avatar renderer from `src/renderer/ui.ts`). `.github/workflows/pages.yml` deploys it to GitHub Pages at <https://sungmyeonggi.github.io/PixelBot/> whenever it changes. The page reads the latest release's version, date and size from the GitHub API, so a new release shows up without a redeploy.

```sh
npm run site                      # _site/
cd _site && python3 -m http.server
```

For a signed and notarized build, add these repository secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Developer ID Application certificate (`.p12`), base64 |
| `CSC_KEY_PASSWORD` | Its password |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for it |
| `APPLE_TEAM_ID` | Your team ID |

### Remaking the icon

```sh
cd build && mkdir icon.iconset
for s in 16 32 128 256 512; do
  rsvg-convert -w $s -h $s icon.svg -o icon.iconset/icon_${s}x${s}.png
  rsvg-convert -w $((s*2)) -h $((s*2)) icon.svg -o icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns icon.iconset -o icon.icns && rm -r icon.iconset
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
```

`icon.svg` clips `source.png` to the macOS rounded square; replace `source.png` to change the art.

## Development

```sh
npm start                                                       # build and run from source
npm run build && npx electron . --remote-debugging-port=9333   # with DevTools over CDP
npm run typecheck
npm test
```

Running from source stores data in `~/Library/Application Support/PixelBot Dev`; the installed app uses `PixelBot`, so a fresh install starts at the first-run setup (account sign-in, name, starter team, first task).

Optional cloud backup on Supabase: see [docs/supabase.md](docs/supabase.md).

Every change needs `npm run build` (which `npm start` runs) and a restart. Pull requests and branches other than `main` run `.github/workflows/ci.yml`: typecheck, tests, the app build and the site build.

## Limitations

- macOS on Apple Silicon only.
- One person. No sign-in, teams or admin pages.
- Bots run directly on your Mac in their own folder, not in a VM or container, and have no browser of their own.
- No email, mobile app or payments.
- Voice recognition is set to Korean (`ko-KR`).

## Roadmap

- [ ] An isolated computer per Bot: a local VM or container first, then the cloud
- [ ] A browser per Bot, with taking the wheel at a login or 2FA wall
- [ ] Gateway rules that block orders and payments on outside APIs
- [ ] An evaluation set built from real tasks
- [ ] Intel Macs and other platforms

## Acknowledgements

- PixelBot is an independent project, not affiliated with or endorsed by Anthropic or OpenAI.
- The gateway and routine limits borrow from [CopilotKit OpenBot](https://github.com/CopilotKit/OpenBot).
- Logos in the app catalog belong to their services and are used only to identify them.

## Contributing

- Open an issue before starting substantial work.
- Keep changes focused, and update this README when setup, behavior or security changes.
- Keep secrets, tokens and conversation data out of the repository.
- Run `npm run typecheck` and `npm test` before opening a pull request.

## License

[Apache License 2.0](./LICENSE) © 2026 SUNGMYEONGGI

The Claude Agent SDK, the Codex SDK and other dependencies are distributed under their own licenses and terms.

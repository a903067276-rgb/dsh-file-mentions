# dsh-file-mentions 📎

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

**Clickable file paths in DSH replies** — a DeepSeek Harness (DSH) web plugin with a Codex-style experience.

Inline paths wrapped in backticks (`` `~/...` ``, absolute, relative, or Chinese paths) become
**click-to-open**; each clickable path carries a small 📂 button that reveals the file in your
file manager; a "📎 mentioned files" chip list at the turn tail covers the rest. URLs are
already auto-linked by the official renderer, so this plugin leaves them alone.

## Features

| Where | What | Effect |
|---|---|---|
| Inline path text | click | Open with default app / open directory |
| 📂 after inline path | click | Reveal in file manager (macOS Finder) |
| "📎 mentioned files" chip | click name | Preview content inside DSH |
| 📂 in the chip list | click | Reveal in file manager |
| Inline URL | click | Browser opens it (official autolink) |

Supports `~/` expansion, relative paths (resolved against the session cwd), and absolute
paths in macOS / Linux / Windows forms. Non-existent paths silently do nothing.

## Install

### Official bundle install (recommended)

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-mentions#main"
```

Restart `dsh web`. Requires pnpm on PATH (`dsh plugin` forwards to pnpm).

### Manual mount (fallback)

See [docs/install.md](docs/install.md): symlink into
`~/.dsh/profiles/web/node_modules/` plus a **single entry** in `~/.dsh/cordis.patch.yml`
(a double entry makes the plugin apply twice and crash on duplicate route registration),
then restart.

## Usage

Have the agent wrap paths in backticks (e.g. `` `~/docs/plan.md` ``) to make them clickable
inline. The tail chip list appears automatically — no configuration.

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ fully tested (incl. Chinese paths) |
| Linux / Windows | ⚠️ not tested; expected to work (command branching and path parsing implemented) |

## How it works

- **Host** (`lib/index.js`): two routes — `/api/file-mentions/check` (existence check) and
  `/api/file-mentions/open` (system open, `mode: open/reveal`, per-platform command). Pure
  Node stdlib; `execFile` avoids shell injection.
- **Client** (`lib/client.js`): a conversationEvents collector extracts paths from each
  reply → publishes them to turn data → the tail list filters non-existent paths before
  rendering; inline clicks use a **document-level click delegation** (the official render
  entry is occupied by the official "deliverables" plugin, so DOM delegation is the only
  viable path); inline 📂 buttons are inserted by a MutationObserver and restored
  automatically after React re-renders.

See [docs/architecture.md](docs/architecture.md).

## Compatibility notes

- Inline clicks rely on backtick-wrapped paths (the agent-output convention, same as
  Codex); bare paths in prose are intentionally not clickable.
- The official "produced files" list and this plugin coexist: official wins when it has
  output, otherwise this plugin shows.
- Windows / Linux validation via issue or PR is welcome.

## License

MIT

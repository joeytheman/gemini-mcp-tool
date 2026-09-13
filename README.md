
# Gemini MCP Tool

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/joeytheman/gemini-mcp-tool?logo=github&label=GitHub)](https://github.com/joeytheman/gemini-mcp-tool/releases)
[![npm version](https://img.shields.io/npm/v/@joeytheman/gemini-mcp-tool)](https://www.npmjs.com/package/@joeytheman/gemini-mcp-tool)
[![npm downloads](https://img.shields.io/npm/dt/@joeytheman/gemini-mcp-tool)](https://www.npmjs.com/package/@joeytheman/gemini-mcp-tool)
[![License: MIT Non-Commercial](https://img.shields.io/badge/License-MIT%20Non--Commercial-blue.svg)](./LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-❤️-red.svg)](https://github.com/joeytheman/gemini-mcp-tool)

</div>

> 📚 **[View Full Documentation](https://joeytheman.github.io/gemini-mcp-tool/)** - Search me!, Examples, FAQ, Troubleshooting, Best Practices

> **Fork Notice:** This project is a fork of [jamubc/gemini-mcp-tool](https://github.com/jamubc/gemini-mcp-tool), originally created by [jamubc](https://github.com/jamubc). We are grateful to the original author for their foundational work.

This is a simple Model Context Protocol (MCP) server that lets AI assistants ask Gemini through Google's Antigravity CLI (`agy`). The primary use case is giving Codex, Claude Code, and other MCP clients a second opinion from Gemini on plans, implementations, code reviews, architecture tradeoffs, and large files using the `@` syntax.

- Ask gemini natural questions, through claude or Brainstorm new ideas in a party of 3!

<a href="https://glama.ai/mcp/servers/@joeytheman/gemini-mcp-tool">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@joeytheman/gemini-mcp-tool/badge" alt="Gemini Tool MCP server" />
</a>

## TLDR: [![Claude](https://img.shields.io/badge/Claude-D97757?logo=claude&logoColor=fff)](#) + [![Google Gemini](https://img.shields.io/badge/Google%20Gemini-886FBF?logo=googlegemini&logoColor=fff)](#) + [![Antigravity (agy)](https://img.shields.io/badge/Antigravity%20%28agy%29-4285F4?logo=google&logoColor=fff)](#)


**Goal**: Use Gemini's analysis capabilities directly from Codex or Claude Code for reviews, critiques, and large-file questions.

## What's New in 2.1

- **`live-pass`** — hand a live UI verification to Gemini. It drives its own Playwright (web) or Maestro (iOS simulator) MCP server, captures each requested screen/state/viewport into an artifact directory inside the worktree under test, opens every PNG itself, and returns a PASS/FAIL/BLOCKED verdict with a sentence per frame. The caller never opens an image. The verdict is derived in code from the requested targets, so a frame Gemini forgot, a stale PNG, or an uncovered target fails the pass even when Gemini says PASS.
- **`screen-review`** — a second pair of eyes on frames someone else captured (`mode: "review"`), or an action inventory of a route file before anything is built (`mode: "plan"`). Also text only.
- **JSON envelopes for `ask-gemini`** — `outputFormat: "json"` returns agy's envelope: the conversation ID line, the response (or `structured_output` when you pass a `jsonSchema`), and a token-usage line. `conversationId` resumes an exact conversation and **errors** if agy silently started a different one.

## What's New in 2.0.2

- **Gemini 3.8 Flash support** — the default model is now **Gemini 3.8 Flash (High)** for strong coding and complex-analysis performance. Pass `model: "Gemini 3.8 Flash (Low)"` or `model: "Gemini 3.8 Flash (Medium)"` when latency matters more than the High reasoning budget. Gemini 3.1 Pro (Low/High) remains available as an explicit alternative when exposed by `agy models`.

## What's New in 2.0

Version 2.0 moves the Gemini backend from the retired Gemini CLI/API path to Google's **Antigravity CLI (`agy`)** and brings the MCP-facing `ask-gemini` workflow along with several capabilities:

- **Antigravity backend** — Gemini is reached through `agy --print`.
- **Opt-in response caching** — LRU cache (30-minute TTL, 10 MB max) for repeated queries, enabled with `AGY_CACHE_ENABLED=true`.
- **Conversation resume** — continue the latest `agy` conversation or resume a specific one via the `resume` option (`--continue` / `--conversation <id>`).
- **Extra workspace directories** — add directories to the Antigravity workspace with `includeDirectories` (maps to repeated `--add-dir`).
- **Configurable print timeout** — bound long-running calls with `printTimeout` (for example `5m` or `90s`; maps to `--print-timeout`).
- **Working directory control** — run `agy` from a chosen directory (or a drive root on Windows) via `workingDirectory`, supported by both `ask-gemini` and `brainstorm`.
- **Structured change mode** — `OLD/NEW` edit suggestions Claude can apply directly, with automatic chunking and a `fetch-chunk` tool for large edit sets.

**Removed:** there is no longer a Pro→Flash quota fallback, and legacy Gemini CLI flags (`outputFormat`, `extensions`, `debug`, `promptInteractive`, and `approvalMode` other than `yolo`) now return explicit unsupported-option errors.

## Prerequisites

Before using this tool, ensure you have:

1. **[Node.js](https://nodejs.org/)** (v18.0.0 or higher)
2. **Antigravity CLI (`agy`)** installed and configured

Verify `agy` before adding the MCP server:

```bash
agy --version
agy install
agy models
```

The default requires `Gemini 3.8 Flash (High)` to appear in `agy models`. If it is missing, update Antigravity CLI and rerun setup. Until 3.8 is available, pass an exact model shown by `agy models`, such as `model: "Gemini 3.1 Pro (High)"`.


### One-Line Setup

```bash
claude mcp add gemini-feedback -- npx -y @joeytheman/gemini-mcp-tool
```

### Verify Installation

Type `/mcp` inside Claude Code to verify the gemini-feedback MCP is active.

---

### Alternative: Import from Claude Desktop

If you already have it configured in Claude Desktop:

1. Add to your Claude Desktop config:
```json
"gemini-feedback": {
  "command": "npx",
  "args": ["-y", "@joeytheman/gemini-mcp-tool"]
}
```

2. Import to Claude Code:
```bash
claude mcp add-from-claude-desktop
```

## Configuration

Register the MCP server with your MCP client:

### For NPX Usage (Recommended)

Add this configuration to your Claude Desktop config file:

```json
{
  "mcpServers": {
    "gemini-feedback": {
      "command": "npx",
      "args": ["-y", "@joeytheman/gemini-mcp-tool"]
    }
  }
}
```

### For Global Installation

If you installed globally, use this configuration instead:

```json
{
  "mcpServers": {
    "gemini-feedback": {
      "command": "gemini-mcp"
    }
  }
}
```

### Optional: Enable Response Caching

To enable the LRU response cache for near-instant repeated queries, add the `AGY_CACHE_ENABLED` environment variable:

```json
{
  "mcpServers": {
    "gemini-feedback": {
      "command": "npx",
      "args": ["-y", "@joeytheman/gemini-mcp-tool"],
      "env": {
        "AGY_CACHE_ENABLED": "true"
      }
    }
  }
}
```

Caching is disabled by default. When enabled, responses are cached with a 30-minute TTL and 10MB max size.

**Configuration File Locations:**

- **Claude Desktop**:
  - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
  - **Linux**: `~/.config/claude/claude_desktop_config.json`

After updating the configuration, restart your terminal session.

## Live UI passes (setup)

`live-pass` needs Gemini to have its own MCP servers registered with Antigravity CLI. Register them once:

```bash
agy mcp add playwright -- npx -y @playwright/mcp@latest --browser chromium --headless --isolated \
  --allow-unrestricted-file-access   # artifact dirs live inside each worktree, so no fixed --output-dir
agy mcp add maestro /path/to/maestro mcp
agy mcp list                         # playwright + maestro
```

`--allow-unrestricted-file-access` is what lets Playwright write PNGs into a worktree-local artifact directory. The tool compensates: `artifactDir` must be inside `workingDirectory`, every frame is checked on disk (fresh, non-empty, inside the artifact dir), and the working tree is diffed before and after the run.

Add `.live-pass/` to the repository's `.gitignore` so frames never land in a commit; deleting the worktree then removes them. Add `.playwright-mcp/` too — the Playwright MCP server creates that directory in whatever it runs from, which the working-tree guard will otherwise report as a WARNING on every pass.

A full pass can run for many minutes inside one MCP call. The server sends keepalive progress notifications every 25 seconds when the client passes a `progressToken`; raise your client's `MCP_TIMEOUT` if a pass outlives it, and consider calling `live-pass` from a small relay sub-agent so the orchestrating session stays free.

## Example Workflow

- **Natural language**: "use gemini to explain index.html", "understand the massive project using gemini", "ask gemini to search for latest news"
- **Claude Code**: Use `/ask-gemini` directly, or ask naturally for Gemini feedback.

## Usage Examples

### With File References (using @ syntax)

- `ask gemini to analyze @src/main.js and explain what it does`
- `use gemini to summarize @. the current directory`
- `analyze @package.json and tell me about dependencies`

### General Questions (without files)

- `ask gemini to search for the latest tech news`
- `use gemini to explain div centering`
- `ask gemini about best practices for React development related to @file_im_confused_about`

### Using Antigravity Sandbox Mode

The sandbox mode maps to `agy --sandbox`, which runs with terminal restrictions enabled.

- `use gemini sandbox to create and run a Python script that processes data`
- `ask gemini to safely test @script.py and explain what it does`
- `use gemini sandbox to install numpy and create a data visualization`
- `test this code safely: Create a script that makes HTTP requests to an API`

### Tools (for the AI)

These tools are designed to be used by the AI assistant.

- **`ask-gemini`**: Ask Gemini through Antigravity CLI (`agy`) for plan review, implementation critique, code review, architecture feedback, debugging, and tradeoff analysis.
  - **`prompt`** (required): The analysis request. Use the `@` syntax to include file or directory references (e.g., `@src/main.js review this implementation`) or ask general questions.
  - **`model`** (optional): The Antigravity model to use. Defaults to `Gemini 3.8 Flash (High)`. Verified options also include `Gemini 3.8 Flash (Low)`, `Gemini 3.8 Flash (Medium)`, `Gemini 3.1 Pro (Low)`, and `Gemini 3.1 Pro (High)`.
  - **`sandbox`** (optional): Set to `true` to pass `--sandbox`.
  - **`changeMode`** (optional): Enable structured change mode for edit suggestions that Claude can apply directly.
  - **`yolo`** (optional): Pass `--dangerously-skip-permissions`. Use with caution.
  - **`includeDirectories`** (optional): Additional directories to include in the Antigravity workspace; maps to repeated `--add-dir`.
  - **`printTimeout`** (optional): Pass `--print-timeout` (for example, `5m` or `90s`).
  - **`resume`** (optional): `true`, `latest`, or `continue` maps to `--continue`; any other string maps to `--conversation <id>`.
  - **`conversationId`** (optional): Resume this exact conversation (`--conversation <id>`); wins over `resume`. In `outputFormat: "json"` the call fails with `CONVERSATION_NOT_RESUMED` when agy silently starts a different conversation — a stale ID only warns on stderr and would otherwise return an unrelated answer. IDs come from the `[GEMINI_CONVERSATION_ID=...]` line of a previous json call; text mode has no ID to report.
  - **`outputFormat`** (optional): `"text"` (default) or `"json"`. `"json"` returns agy's envelope rendered as the conversation line, the answer, and a usage line. `"stream-json"` is unsupported.
  - **`jsonSchema`** (optional): Inline JSON Schema passed to `--json-schema`, constraining the answer to `structured_output`. Requires `outputFormat: "json"`.
  - **`effort`** (optional): `low`, `medium`, or `high`, passed to `--effort`. Tiered Gemini names already encode effort in the name, and agy rejects `--effort` for them — the rejection is surfaced verbatim.
  - **`workingDirectory`** (optional): Working directory to run `agy` from. Use drive root (e.g., 'C:/' or 'D:/') on Windows to access files across drives.
  - **Unsupported legacy options**: `extensions`, `debug`, `promptInteractive`, `outputFormat: "stream-json"`, and `approvalMode` except `approvalMode: "yolo"`.

- **`live-pass`**: Delegate a live UI verification to Gemini. It drives its own Playwright or Maestro MCP server, captures the requested frames, looks at them, and returns text.
  - **`targets`** (required): One `{screen, state, viewport, expected}` per frame the pass must produce. `expected` is what that state must show — for an intentional error/empty/offline state, name the reason text and the recovery affordance. The effective verdict is derived from this list: **any target that produced no frame fails the pass**, whether Gemini skipped it with a reason or never reported it at all. A skip explains missing evidence; it does not excuse it. Each target's screenshot filename is derived in code from its `screen`/`state`/`viewport`, so two targets can never be answered by one image — a reused file is reported as `DUPLICATE` and fails the pass.
  - **`brief`** (required): Base URL or app id, the served-branch marker, the seed case, navigation hints.
  - **`workingDirectory`** (required): Absolute path to the worktree under test. Used as agy's cwd and workspace root.
  - **`driver`** (required): `playwright` or `maestro`.
  - **`artifactDir`** (optional): Absolute path, strictly inside `workingDirectory`. Defaults to `<workingDirectory>/.live-pass/<timestamp>`, so deleting the worktree cleans up the frames. Add `.live-pass/` to the repo's `.gitignore`.
  - **`publishCommand`** (optional): Shell command run **in code** after validation, with `{files}` replaced by the shell-quoted paths of the frames that validated OK; its stdout is returned as PR markdown. Never run on a BLOCKED pass.
  - **`conversationId`** (optional): Resume the previous pass so Gemini reports deltas (`resolved`, `regressions`, `changes`) instead of a bare snapshot. The browser or simulator still starts fresh — resume only changes what Gemini remembers. Start fresh when the brief changed materially, after a BLOCKED pass, or after about three rounds (each resumed round roughly doubles input tokens).
  - **`yolo`** (optional, default **true**): Without `--dangerously-skip-permissions`, headless agy denies the MCP tool calls and the pass is BLOCKED. The tool snapshots the working tree before and after — status lines *and* content hashes of every dirty file, since a file Gemini rewrites in a PR worktree was already modified before the run — and reports any change as a WARNING, including when the agy call itself fails.
  - **`model`** (optional, default `Gemini 3.8 Flash (Medium)`), **`printTimeout`** (optional, default `15m`).

- **`screen-review`**: Have Gemini judge captured screens, or inventory a route before it is built.
  - **`mode`** (required): `review` judges PNGs after a live pass; `plan` inventories a route file and returns no verdict.
  - **`instructions`** (required): The caller's reviewer prompt, passed through verbatim so rule citations stay exact.
  - **`workingDirectory`** (required): The checkout the instructions cite; used as agy's cwd so repository-relative rule paths resolve.
  - **`images`** (review mode, required): Absolute PNG/JPEG paths that must exist. **`routeFile`** (plan mode, required): absolute path inside `workingDirectory`. Neither may contain whitespace — agy resolves an `@reference` up to the first space, so a spaced path would hang until `printTimeout`; the tool rejects it up front instead.
  - **`context`** (optional): Composition contract, issue text, anything else the reviewer prompt cites.
  - **`changedRoutes`** (optional, review mode): Repo-relative files the diff touched (from `git diff --name-only`). Gemini maps each image to the route file it shows, and a changed screen (under an `app/` directory) that no image shows makes the review REQUEST_CHANGES — partial screenshot coverage is as unreviewed as none. A changed file under `components/` only warns. The report prints a route → image coverage table.
  - **`conversationId`** (optional): Round 2 keeps round 1's visual analysis.
  - **`yolo`** (optional, default **false**): a review only reads. Set it to `true` when the instructions ask Gemini to read repository files that are not among the images — it reaches for a shell to do that, headless agy denies the shell, and the call fails naming the denied action.

- **`brainstorm`**: Generate creative ideas with structured methodologies and domain context.
  - **`prompt`** (required): Brainstorming challenge or question to explore.
  - **`model`** (optional): The Antigravity model to use. Defaults to `Gemini 3.8 Flash (High)`.
  - **`methodology`** (optional): Framework to use: `divergent`, `convergent`, `scamper`, `design-thinking`, `lateral`, or `auto` (default).
  - **`domain`** (optional): Domain context (e.g., 'software', 'business', 'creative', 'research').
  - **`constraints`** (optional): Known limitations or requirements.
  - **`existingContext`** (optional): Background information, previous attempts, or current state to build upon.
  - **`ideaCount`** (optional): Number of ideas to generate (default: 12).
  - **`includeAnalysis`** (optional): Include feasibility and impact analysis (default: true).
  - **`workingDirectory`** (optional): Working directory to run `agy` from.

- **`fetch-chunk`**: Retrieve cached chunks from large changeMode responses.
  - **`cacheKey`** (required): Cache key from initial changeMode response.
  - **`chunkIndex`** (required): Chunk number to retrieve (1-based index).

- **`ping`**: Echo test message to verify server connection.
  - **`prompt`** (optional): Message to echo back.

- **`Help`**: Display Antigravity CLI (`agy`) help information.

### Slash Commands (for the User)

You can use these commands directly in Claude Code's interface (compatibility with other clients has not been tested).

- **/ask-gemini**: Ask Gemini through Antigravity CLI with caching and change mode.
  - **Example**: `/ask-gemini prompt:@src/ summarize this directory`
  - **With sandbox**: `/ask-gemini prompt:@script.py test this safely sandbox:true`
  - **With change mode**: `/ask-gemini prompt:Refactor this code changeMode:true`
  - **Supported backend flags**: model, sandbox, yolo, includeDirectories, printTimeout, resume, workingDirectory.

- **/brainstorm**: Generate structured ideas with creative methodologies.
  - **Example**: `/brainstorm prompt:How can we improve user onboarding? methodology:design-thinking domain:software`
  - **Quick use**: `/brainstorm prompt:Ideas for a mobile app feature`
  - **Supported flags**: model, methodology, domain, constraints, existingContext, ideaCount, includeAnalysis, workingDirectory.

- **/live-pass**: Walk a running app with Gemini and get a text verdict with per-frame observations.
  - **Example**: `/live-pass driver:playwright workingDirectory:/path/to/worktree brief:"Base URL http://localhost:8081; marker: footer BRANCH: my-branch" targets:[{"screen":"home","state":"default","viewport":"390x844","expected":"order list with one seeded order"}]`
  - **Supported flags**: targets, brief, workingDirectory, driver, artifactDir, model, printTimeout, yolo, publishCommand, conversationId.

- **/screen-review**: Judge captured frames, or inventory a route file before building it.
  - **Example**: `/screen-review mode:review workingDirectory:/path/to/worktree images:["/path/to/.live-pass/run/home-default-390x844.png"] instructions:"<reviewer prompt>"`
  - **Plan mode**: `/screen-review mode:plan workingDirectory:/path/to/worktree routeFile:/path/to/app/orders.tsx instructions:"<action inventory rules>"`

- **/fetch-chunk**: Retrieve next chunk of a large changeMode response.
  - **Example**: `/fetch-chunk cacheKey:abc123 chunkIndex:2`

- **/Help**: Display Antigravity CLI help information.
  - **Example**: `/Help`

- **/ping**: Test the MCP server connection.
  - **Example**: `/ping prompt:Hello server!`

## Performance Features

This MCP server includes several performance optimizations:

- **LRU Response Cache** (opt-in): Near-instant responses for repeated queries with 30-minute TTL and 10MB max size. Enable via `AGY_CACHE_ENABLED=true` env var.
- **Efficient Command Execution**: O(n) array buffer performance for large outputs
- **Smart Chunking**: Large changeMode responses are automatically chunked for better handling
- **Progress Notifications**: Real-time progress updates during long-running operations

## Contributing

Contributions are welcome! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and contribute to the project.

## Acknowledgments

This project was originally created by [jamubc](https://github.com/jamubc) and is maintained as a fork by [joeytheman](https://github.com/joeytheman). The original repository can be found at [jamubc/gemini-mcp-tool](https://github.com/jamubc/gemini-mcp-tool).

## License

This project is licensed under the MIT License (Non-Commercial). Commercial use is prohibited without prior written permission from the original copyright holder. See the [LICENSE](LICENSE) file for full details.

**Disclaimer:** This is an unofficial, third-party tool and is not affiliated with, endorsed, or sponsored by Google.

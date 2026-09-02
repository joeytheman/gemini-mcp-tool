
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
  - **`workingDirectory`** (optional): Working directory to run `agy` from. Use drive root (e.g., 'C:/' or 'D:/') on Windows to access files across drives.
  - **Unsupported legacy options**: `outputFormat`, `extensions`, `debug`, `promptInteractive`, and `approvalMode` except `approvalMode: "yolo"`.

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

# Installation

Multiple ways to install Gemini MCP Tool, depending on your needs.

## Prerequisites

- Node.js v20.12.0 or higher
- Claude Desktop or Claude Code with MCP support
- Antigravity CLI (`agy`) installed and configured

Verify Antigravity before configuring the MCP server:

```bash
agy --version
agy install
agy models
```

`ask-gemini` and `brainstorm` default to `Gemini 4 Carbon (High)` (verified with agy 1.5.5). Google currently lists Carbon access in Antigravity for Google AI Ultra and Enterprise accounts (Argon is also on Google AI Pro); see [model availability](https://antigravity.google/docs/models/). If Carbon is absent from `agy models`, update Antigravity CLI and check your account's access, or explicitly pass an available model such as `model: "Gemini 4 Argon (High)"` or `model: "Gemini 3.8 Flash (High)"`. The MCP server does not automatically fall back.

`live-pass` and `screen-review` continue to default to `Gemini 3.8 Flash (Medium)`.

## Web live pass setup

For `live-pass` with `driver:playwright`, register Playwright MCP with Antigravity CLI. Use a version with `browser_run_code_unsafe` (tested with `@playwright/mcp` 0.0.84):

```bash
agy mcp add playwright -- npx -y @playwright/mcp@latest --browser chromium --headless --isolated \
  --codegen none --allow-unrestricted-file-access
agy mcp list
```

Update an existing Playwright registration to include both flags. `--allow-unrestricted-file-access` lets the capture read its worktree-local script and save the layout report; `--codegen none` prevents Playwright from echoing that script into Gemini's history. Playwright targets use a `WxH` viewport, such as `390x844`. Add `.live-pass/` and `.playwright-mcp/` to the app worktree's `.gitignore`.

## Method 1: NPX (Recommended)

No installation needed - runs directly:

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

## Method 2: Global Installation

```bash
claude mcp add gemini-feedback -- npx -y @joeytheman/gemini-mcp-tool
```

Then configure:
```json
{
  "mcpServers": {
    "gemini-feedback": {
      "command": "gemini-mcp"
    }
  }
}
```

## Method 3: Local Project

```bash
npm install @joeytheman/gemini-mcp-tool
```

See [Getting Started](/getting-started) for full setup instructions.

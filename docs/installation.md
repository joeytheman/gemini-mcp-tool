# Installation

Multiple ways to install Gemini MCP Tool, depending on your needs.

## Prerequisites

- Node.js v18.0.0 or higher
- Claude Desktop or Claude Code with MCP support
- Antigravity CLI (`agy`) installed and configured

Verify Antigravity before configuring the MCP server:

```bash
agy --version
agy install
agy models
```

`ask-gemini` and `brainstorm` default to `Gemini 4 Argon (High)` (verified with agy 1.3.4). Google currently lists Argon access in Antigravity for Google AI Ultra and Enterprise accounts; see [model availability](https://antigravity.google/docs/models/). If Argon is absent from `agy models`, update Antigravity CLI and check your account's access, or explicitly pass an available model such as `model: "Gemini 3.8 Flash (High)"`. The MCP server does not automatically fall back.

`live-pass` and `screen-review` continue to default to `Gemini 3.8 Flash (Medium)`.

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

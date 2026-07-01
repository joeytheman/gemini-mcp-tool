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

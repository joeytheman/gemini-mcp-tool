# Changelog

## [Unreleased]
- Updated default model to `gemini-3-pro-preview`
- Added MCP tool annotations to all 6 tools per [MCP specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#annotations) (`readOnlyHint`, `openWorldHint`, `idempotentHint`)
- Resolved npm audit vulnerabilities (14 → 7 remaining, all dev-only `lodash-es` with no fix available)
  - Upgraded `@modelcontextprotocol/sdk` from 0.5.x to 1.25.x (high severity)
  - Removed unused `ai` dependency and its transitive `jsondiffpatch` vulnerability
  - Added `esbuild` override to fix dev server request vulnerability
  - Bumped `vitepress` to ^1.6.4 and `mermaid` to ^11.12.2
  - Bumped minimum Node.js engine from 16 to 18 (required by SDK 1.x)
- Added LRU response cache for Gemini API responses (opt-in via `GEMINI_CACHE_ENABLED=true` env var)
- Added extended CLI flags: yolo, approvalMode, outputFormat, debug, includeDirectories, extensions, resume
- Improved command execution performance with O(n) array buffers
- Added `buildGeminiArgs()` helper and `GeminiCLIOptions` interface to eliminate code duplication
- Added vitest test suite with schema validation, registry, and server tests

## [1.1.3]
- "gemini reads, claude edits"
- Added `changeMode` parameter to ask-gemini tool for structured edit responses using claude edit diff.
- Testing intelligent parsing and chunking for large edit responses (>25k characters). I recommend you provide a focused prompt, although large (2000+) line edits have had success in testing.
- Added structured response format with Analysis, Suggested Changes, and Next Steps sections
- Improved guidance for applying edits using Claude's Edit/MultiEdit tools, avoids reading...
- Testing token limit handling with continuation support for large responses

## [1.1.2]
- Gemini Pro quota limit exceeded now falls back to gemini-2.5-flash automatically. Unless you ask for pro or flash, it will default to pro.

## [1.1.1]

- Public
- Basic Gemini CLI integration
- Support for file analysis with @ syntax
- Sandbox mode support

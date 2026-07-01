# Changelog

## [Unreleased]

## [2.0.0]
- Breaking: switched runtime execution to Antigravity CLI (`agy`) while keeping the MCP-facing `ask-gemini` workflow.
- Default model is now `Gemini 3.5 Flash (Medium)`.
- Added support for `agy` options: `sandbox`, `yolo`, `includeDirectories`, `printTimeout`, `resume`, and `workingDirectory`.
- Removed runtime fallback behavior; unsupported legacy options now fail explicitly.
- Cache opt-in now uses `AGY_CACHE_ENABLED=true`.
- `Help` now returns `agy --help`.

## [1.1.3]
- "gemini reads, claude edits"
- Added `changeMode` parameter to ask-gemini tool for structured edit responses using claude edit diff.
- Testing intelligent parsing and chunking for large edit responses (>25k characters). I recommend you provide a focused prompt, although large (2000+) line edits have had success in testing.
- Added structured response format with Analysis, Suggested Changes, and Next Steps sections
- Improved guidance for applying edits using Claude's Edit/MultiEdit tools, avoids reading...
- Testing token limit handling with continuation support for large responses

## [1.1.2]
- Gemini Pro quota limit exceeded now falls back to gemini-3-flash-preview automatically. Unless you ask for pro or flash, it will default to pro.

## [1.1.1]

- Public
- Basic Gemini CLI integration
- Support for file analysis with @ syntax
- Sandbox mode support

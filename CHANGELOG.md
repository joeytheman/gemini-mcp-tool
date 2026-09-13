# Changelog

## [Unreleased]

## [2.1.0]
- Added `live-pass`: Gemini drives its own Playwright or Maestro MCP server, captures frames into a worktree-local artifact directory, looks at them itself, and returns a text verdict. No image reaches the caller's context.
- Added `screen-review`: Gemini judges captured frames against a reviewer prompt (`mode: "review"`) or inventories a route file's controls before implementation (`mode: "plan"`). Pass `changedRoutes` and a changed screen with no screenshot fails the review — partial coverage is as unreviewed as none.
- `ask-gemini` gained `outputFormat: "json"` (agy's JSON envelope: conversation ID, response or `structured_output`, usage), `jsonSchema`, `effort`, and `conversationId`.
- Resumes are verified: when agy silently starts a new conversation instead of resuming the requested one, the call now errors instead of returning an unrelated answer.
- Denied tool actions with an empty response now fail with the denied action names and a `yolo` hint instead of looking like an empty answer.
- Resumed, `conversationId` and `noCache` calls are never served from or written to the response cache; the cache key now also covers `jsonSchema`, `effort` and `conversationId`.
- Transcript recovery prefers an explicitly resumed conversation over the working-directory lookup.

## [2.0.2]
- Added support for the `Gemini 3.8 Flash` Low, Medium, and High tiers exposed by `agy models`.
- Default model changed from `Gemini 3.1 Pro (High)` to `Gemini 3.8 Flash (High)`.
- Synchronized the MCP server version with the package version.

## [2.0.1]
- Added support for `Gemini 3.1 Pro (Low)` and `Gemini 3.1 Pro (High)`, now exposed by `agy models`.
- Default model changed from `Gemini 3.5 Flash (Medium)` to `Gemini 3.1 Pro (High)`.

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

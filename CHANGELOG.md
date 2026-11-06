# Changelog

## [Unreleased]
- `live-pass` (web) captures each frame with one `browser_run_code_unsafe` call on a capture file the tool writes beside the frame (`<frame>.capture.js`): it sets the target's viewport and grows a scrolling screen taller, a few times at most and up to 4000 px, until the page's or the largest shown scroller's overflow fits (only scrollers inside an open `aria-modal` sheet count); a screen that still scrolls after that is shot as it stands. It then saves the PNG, runs the layout check at the shot's size, and restores the viewport. One short `browser_evaluate` then saves the layout report to `<frame>.layout.json`. Neither the layout nor the measure snippet is in the prompt any more, and Gemini no longer resizes. A centred or bottom-anchored screen is no longer stretched to about 4000 px. A `playwright` target's `viewport` must now be `WxH`. A reported frame whose filename and file signature do not match PNG or JPEG fails as `NOT_IMAGE`, and the tool replaces an existing file or symlink at a capture path instead of writing through it. Register `@playwright/mcp` with `--codegen none` (README), and use a version that has `browser_run_code_unsafe` (0.0.84 does).
- Each tool call owns its keep-alive timer and output preview. Before, the first of two overlapping calls to finish stopped the other's keep-alives, and the client aborted the survivor about 30 minutes later.
- agy and its child processes are stopped when it runs 2 minutes past its `printTimeout`, or after 2 hours when `printTimeout` is omitted or `0` (agy's "no limit"). On POSIX, the process group receives SIGTERM, then SIGKILL after 10 s if needed; on Windows, `taskkill /T /F` stops the tree. The call fails after the process closes, so callers can inspect the final working tree.
- `ask-gemini`, `live-pass` and `screen-review` reject a `printTimeout` that is not a duration such as `90s`, `15m`, `2h30m` or `2.5h` (terms in `h`, `m`, `s` or `ms`, with optional fractions), or `0`. The input schema advertises the pattern.
- Cancelling an MCP request stops its agy process (Help's `agy --help` included) and that call's progress notifications, even while a tool that ignores the cancel is still running.
- The final progress notification follows the last keep-alive (its progress and total are the keep-alive count plus one) instead of a fixed 100 of 100, so progress keeps increasing on calls longer than about 41 minutes.
- Every agy call reads its answer from agy's documented JSON envelope (`--output-format json`), including text-mode `ask-gemini`, `changeMode` and `brainstorm`. Text callers still get plain text: the envelope's `response`, trimmed.
- Removed transcript recovery and `AGY_DISABLE_TRANSCRIPT_RECOVERY`. The tool no longer reads agy's private conversation folders for answers; an empty run fails instead of being filled in from a transcript: with `Could not parse the Antigravity CLI JSON envelope` when agy printed nothing, and, for text calls (`changeMode` and `brainstorm` included), with `finished with an empty answer` plus the `[GEMINI_CONVERSATION_ID=...]` line when the envelope's `response` is empty. json calls still get the envelope, and `live-pass` and `screen-review` still report it as BLOCKED or "no usable answer". The step store is still read, only for the "Gemini steps" usage line.
- Text calls now get the checks json calls already had: a `conversationId` agy did not resume throws `agy did not resume conversation`, and an empty answer with denied actions throws the denied-actions error instead of returning an empty string. In `changeMode` that error asks for the change as OLD/NEW edits again, without `yolo`.
- A `structured_output` agy replays from an earlier turn of a resumed conversation counts as the answer only when this call passed a `jsonSchema`, so it can no longer hide a denied-actions failure.

## [2.3.0]
- `live-pass` spends fewer Gemini turns. The prompt now carries the branch and HEAD of `workingDirectory` (read in code), a parameter cheat sheet for the Playwright or Maestro tools the procedure uses, and the rule for native dialogs (`browser_handle_dialog` right after the click). Gemini may not read product source, tests, docs, tool schemas or the database, or run git or other shell commands beyond the capture command; the brief carries every fact it needs.
- `live-pass` follows the user path: sign-in form, navigation taps, form submits; the app opens once at its start URL, a target begins at its own link only when the brief says the user arrives by it (an invite, email or share link) and names its source, which the frame quotes in `link_source`; every other target is reached by taps from the previous screen, a reload opens the current URL only where the brief makes it part of the path, and no `browser_evaluate` shortcuts. The injected checkout is context: the pass blocks only when the app's marker contradicts it. Controls are located by testID, then `browser_find`, then a scoped `browser_snapshot`. A broken path skips the target with the step where it broke, and a missing brief fact skips it with `brief missing: <fact>`.
- `live-pass` (web) runs a layout check after each frame and writes `<frame>.layout.json` next to it: horizontal page scroll, spilling and clipped text, covered controls, and controls cut off at the screen edge, with line-clamped or ellipsized text listed apart. Covered-control checks hit-test only the visible part of a control and skip only what sits in a horizontal scroller's own row (a sibling or the row's edge control); text extents ignore whitespace runs; a framework dev overlay, including one Expo draws in the shadow root of a zero-size host, is reported once with its largest shown box as `dev-overlay` and excluded from the other checks. A file measured at another width than its frame is not trusted. The report adds a "Layout checks (measured in the page)" section; it never affects the verdict.
- `live-pass` and `screen-review` report Gemini's model steps under the usage line (per frame for a live pass), read from agy's conversation store.
- `screen-review` bounds Gemini's reads to the evidence its checklist needs (the route each image shows and what it renders, changed files, producer lines, rules, READMEs and boards), and bans running tests or npm and reading `node_modules` or release notes. New `baseRef` (review mode) is resolved in code to its merge base with HEAD; Gemini may run read-only `git diff <merge-base>...HEAD` and `git show <merge-base>:<path>`. Without it Gemini runs no git.
- Package and MCP server versions synchronized at `2.3.0`.

## [2.2.0]
- Default model for `ask-gemini` and `brainstorm` changed to `Gemini 4 Argon (High)`; `live-pass` and `screen-review` continue to default to `Gemini 3.8 Flash (Medium)`.
- Added Gemini 4 Argon Low, Medium, and High tiers to the advertised model choices and updated setup guidance for account-dependent availability. Explicit model overrides remain supported, with no automatic fallback.
- Package and MCP server versions synchronized at `2.2.0`.

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

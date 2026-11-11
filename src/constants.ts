

// Logging
export const LOG_PREFIX = "[GMCPT]";

// Error messages
export const ERROR_MESSAGES = {
  AGY_NOT_FOUND: "Antigravity CLI (`agy`) was not found. Install or update Antigravity CLI, run `agy install`, then verify `agy --version` works from your shell.",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
  UNSUPPORTED_AGY_OPTIONS: "Unsupported Antigravity CLI option(s)",
  INVALID_RESUME: "resume must be true, latest, continue, or a non-empty conversation ID.",
  AGY_NO_OUTPUT: "Antigravity CLI (`agy`) returned no output (it may have timed out resolving a file reference). Ensure any @referenced files exist under the working directory or an includeDirectories entry, narrow the prompt, or increase printTimeout.",
  UNSAFE_ROOT_YOLO: "Refusing to run agy with yolo (`--dangerously-skip-permissions`) when workingDirectory is a filesystem root. Set workingDirectory to a specific project directory.",
  UNSUPPORTED_OUTPUT_FORMAT: "outputFormat must be 'text' or 'json'. Antigravity CLI has no stream-json mode.",
  JSON_SCHEMA_REQUIRES_JSON: "jsonSchema requires outputFormat: 'json'.",
  INVALID_EFFORT: "effort must be one of: low, medium, high.",
  AGY_JSON_PARSE: "Could not parse the Antigravity CLI JSON envelope",
  AGY_STATUS_ERROR: "Antigravity CLI returned status ERROR",
  AGY_DENIED_ACTIONS: "Antigravity CLI produced no response because it denied required actions. Retry with `yolo: true`, or allow the actions in the Antigravity `permissions.allow` settings. Denied",
  CHANGEMODE_DENIED_ACTIONS: "changeMode returned no OLD/NEW edits. Ask again for the change as OLD/NEW edits, without yolo. Denied",
  AGY_EMPTY_ANSWER: "Antigravity CLI (`agy`) finished with an empty answer.",
  INVALID_PRINT_TIMEOUT: "printTimeout must be a duration such as 90s, 15m, 2h30m or 2.5h, or 0 for no limit",
  INVALID_CONVERSATION_ID: "conversationId must be a non-empty agy conversation ID.",
  CONVERSATION_NOT_RESUMED: "agy did not resume conversation",
  AGY_HUNG: "Antigravity CLI (`agy`) ran past its time limit and was stopped",
  AGY_CANCELLED: "The request was cancelled, so agy was stopped.",
  INVALID_WORKING_DIRECTORY: "workingDirectory must be an absolute path to an existing directory that is not a filesystem root",
  LIVE_PASS_ARTIFACT_DIR: "artifactDir must be an absolute path strictly inside workingDirectory",
  LIVE_PASS_WEB_VIEWPORT: "a playwright target's viewport must be WxH, such as 390x844",
  LIVE_PASS_NO_BRIEF: "brief is required: describe the base URL or app id, the served-branch marker, the seed case, and any navigation hints.",
  // agy resolves an @reference up to the first space, so a path containing
  // whitespace becomes a dangling reference that hangs until --print-timeout.
  UNREFERENCEABLE_PATH: "path contains whitespace, which Antigravity CLI cannot resolve as an @reference. Move or rename it so the path has no spaces",
  SCREEN_REVIEW_NO_IMAGES: "review mode requires at least one absolute image path",
  SCREEN_REVIEW_IMAGE_MISSING: "image does not exist",
  SCREEN_REVIEW_ROUTE_FILE: "plan mode requires routeFile: an absolute path to an existing file inside workingDirectory",
  SCREEN_REVIEW_BASE_REF: "baseRef does not resolve to a merge base with HEAD in workingDirectory",
} as const;

// How long an agy process may run before it is stopped. agy honours its own
// --print-timeout; this ceiling exists for runs that hang past it.
export const AGY_LIMITS = {
  CEILING_MARGIN_MS: 2 * 60_000,
  DEFAULT_CEILING_MS: 2 * 60 * 60_000,
  KILL_GRACE_MS: 10_000,
  KILL_CLOSE_WAIT_MS: 1_000,
} as const;

export const PRINT_TIMEOUT_CEILING_NOTE =
  `The server stops agy ${AGY_LIMITS.CEILING_MARGIN_MS / 60_000} minutes after this limit, ` +
  `or after ${AGY_LIMITS.DEFAULT_CEILING_MS / 3_600_000} hours when no limit is given.`;

// Undocumented Antigravity CLI internals. The step store feeds only the
// "Gemini steps" usage line, so a reader must degrade to null, never throw.
// Answers come only from agy's documented JSON output.
export const AGY_INTERNAL = {
  ROOT_SEGMENTS: [".gemini", "antigravity-cli"],
  TIMEOUT_SENTINEL: "Error: timed out waiting for response",
  // agy 1.4.12 keeps each conversation's steps in SQLite; step_type 15 is a model step.
  CONVERSATIONS_DIR: "conversations",
  CONVERSATION_STORE_EXT: ".db",
  MODEL_STEP_TYPE: 15,
} as const;

// Status messages
export const STATUS_MESSAGES = {
  SANDBOX_EXECUTING: "🔒 Executing Antigravity CLI command in sandbox mode...",
  GEMINI_RESPONSE: "Gemini response:",
  // Timeout prevention messages
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing... Gemini is working on your request",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
} as const;

// Models. The tier in an Antigravity model name IS its reasoning effort, which
// is why `--effort` is rejected for these names.
export const MODELS = {
  DEFAULT: "Gemini 4 Carbon (High)",
  MEDIUM: "Gemini 3.8 Flash (Medium)",
} as const;

export const MODEL_CHOICE_DESCRIPTION =
  "Optional Antigravity model name. Verified options: 'Gemini 4 Carbon (Low)', 'Gemini 4 Carbon (Medium)', 'Gemini 4 Carbon (High)', 'Gemini 4 Argon (Low)', 'Gemini 4 Argon (Medium)', 'Gemini 4 Argon (High)', 'Gemini 3.8 Flash (Low)', 'Gemini 3.8 Flash (Medium)', and 'Gemini 3.8 Flash (High)'. Availability depends on your CLI version and account; check `agy models`. Some accounts also expose 'Gemini 3.1 Pro (Low)' and 'Gemini 3.1 Pro (High)'. The tier in the name is the reasoning effort.";

// Live UI pass / screen review
export const LIVE_PASS = {
  DEFAULT_ARTIFACT_SEGMENT: ".live-pass",
  MANIFEST_FILE: "manifest.json",
  DEFAULT_PRINT_TIMEOUT: "15m",
  SCREEN_REVIEW_PRINT_TIMEOUT: "10m",
  PLAYWRIGHT_MCP_NAME: "playwright",
  MAESTRO_MCP_NAME: "maestro",
  // Slack between a frame's mtime and our run-start clock.
  FRESHNESS_TOLERANCE_MS: 2000,
  CONVERSATION_LINE_PREFIX: "[GEMINI_CONVERSATION_ID=",
  LAYOUT_FILE_SUFFIX: ".layout.json",
  CAPTURE_FILE_SUFFIX: ".capture.js",
  // React Native Web lays out again asynchronously after a viewport resize.
  CAPTURE_SETTLE_MS: 1000,
  // A virtualized list's tail spacer can report a scrollHeight far past its rows.
  CAPTURE_MAX_HEIGHT: 4000,
  CAPTURE_MAX_GROWS: 4,
  LAYOUT_CHECK_ID: "layout-check/1",
  LAYOUT_MAX_ENTRIES: 50,
  LAYOUT_TEXT_CHARS: 80,
} as const;

/**
 * Embedded in each web target's capture file, which runs it in the page right
 * after the screenshot. Its return value is the `.layout.json` file the layout
 * validator parses, so the two change together. The readable source is
 * src/layout-check.snippet.js; its caps and check id must equal LIVE_PASS's.
 */
export { LAYOUT_CHECK_SNIPPET } from './layoutCheckSnippet.generated.js';

// MCP Protocol Constants
export const PROTOCOL = {
  // Message roles
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  // Content types
  CONTENT_TYPES: {
    TEXT: "text",
  },
  // Status codes
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  // Notification methods
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  // Timeout prevention
  KEEPALIVE_INTERVAL: 25000, // 25 seconds
} as const;


// CLI Constants
export const CLI = {
  // Command names
  COMMANDS: {
    AGY: "agy",
    ECHO: "echo",
  },
  // Command flags
  FLAGS: {
    MODEL: "--model",
    SANDBOX: "--sandbox",
    PRINT: "--print",
    HELP: "--help",
    YOLO: "--dangerously-skip-permissions",
    ADD_DIR: "--add-dir",
    PRINT_TIMEOUT: "--print-timeout",
    CONTINUE: "--continue",
    CONVERSATION: "--conversation",
    OUTPUT_FORMAT: "--output-format",
    JSON_SCHEMA: "--json-schema",
    EFFORT: "--effort",
  },
  // Default values
  DEFAULTS: {
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
    APPROVAL_MODE_YOLO: "yolo",
    RESUME_LATEST: "latest",
    RESUME_CONTINUE: "continue",
    OUTPUT_FORMAT_TEXT: "text",
    OUTPUT_FORMAT_JSON: "json",
    EFFORT_LEVELS: ["low", "medium", "high"],
  },
} as const;


// (merged PromptArguments and ToolArguments)
export interface ToolArguments {
  prompt?: string;
  model?: string;
  sandbox?: boolean | string;
  changeMode?: boolean | string;
  chunkIndex?: number | string; // Which chunk to return (1-based)
  chunkCacheKey?: string; // Optional cache key for continuation
  message?: string; // For Ping tool -- Un-used.

  // Phase 1: Critical flags
  yolo?: boolean | string; // Auto-accept all actions (YOLO mode)
  approvalMode?: string; // Legacy approval mode; only yolo maps to agy
  outputFormat?: string; // agy --output-format: text (default) or json
  jsonSchema?: string; // agy --json-schema: inline JSON schema for structured_output
  effort?: string; // agy --effort; rejected by agy for tiered Gemini model names
  conversationId?: string; // agy --conversation <id>; wins over resume
  includeDirectories?: string | string[]; // Additional directories to include
  debug?: boolean | string; // Unsupported legacy Gemini CLI option
  printTimeout?: string; // agy --print-timeout duration (for example: 5m, 90s)

  // Phase 2: Enhanced features
  promptInteractive?: string; // Unsupported in MCP request/response mode
  extensions?: string | string[]; // Unsupported legacy Gemini CLI option
  resume?: boolean | string; // Continue latest conversation or resume by conversation ID

  // Brainstorm tool
  methodology?: string; // Brainstorming framework to use
  domain?: string; // Domain context for specialized brainstorming
  constraints?: string; // Known limitations or requirements
  existingContext?: string; // Background information to build upon
  ideaCount?: number; // Target number of ideas to generate
  includeAnalysis?: boolean; // Include feasibility and impact analysis

  [key: string]: string | boolean | number | string[] | undefined; // Allow additional properties
}

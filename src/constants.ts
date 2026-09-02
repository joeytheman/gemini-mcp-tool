

// Logging
export const LOG_PREFIX = "[GMCPT]";

// Error messages
export const ERROR_MESSAGES = {
  AGY_NOT_FOUND: "Antigravity CLI (`agy`) was not found. Install or update Antigravity CLI, run `agy install`, then verify `agy --version` works from your shell.",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
  UNSUPPORTED_AGY_OPTIONS: "Unsupported Antigravity CLI option(s)",
  INVALID_RESUME: "resume must be true, latest, continue, or a non-empty conversation ID.",
  AGY_NO_OUTPUT: "Antigravity CLI (`agy`) returned no output (it may have timed out resolving a file reference) and no recoverable transcript was found. Ensure any @referenced files exist under the working directory or an includeDirectories entry, narrow the prompt, or increase printTimeout.",
  UNSAFE_ROOT_YOLO: "Refusing to run agy with yolo (`--dangerously-skip-permissions`) when workingDirectory is a filesystem root. Set workingDirectory to a specific project directory.",
} as const;

// Antigravity CLI internal layout, used ONLY for best-effort output recovery.
// FRAGILE: pinned to agy 1.0.13 internals — a patch release may rename any of these.
// All access must degrade to null on mismatch; never throw based on these.
export const AGY_INTERNAL = {
  ROOT_SEGMENTS: [".gemini", "antigravity-cli"],
  LAST_CONVERSATIONS_SEGMENTS: ["cache", "last_conversations.json"],
  BRAIN_DIR: "brain",
  TRANSCRIPT_SEGMENTS: [".system_generated", "logs", "transcript.jsonl"],
  // A transcript record holding the final model answer.
  TRANSCRIPT_FINAL: { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE" },
  TIMEOUT_SENTINEL: "Error: timed out waiting for response",
  DISABLE_RECOVERY_ENV: "AGY_DISABLE_TRANSCRIPT_RECOVERY",
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

// Models
export const MODELS = {
  DEFAULT: "Gemini 3.8 Flash (High)",
} as const;

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
  },
  // Default values
  DEFAULTS: {
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
    APPROVAL_MODE_YOLO: "yolo",
    RESUME_LATEST: "latest",
    RESUME_CONTINUE: "continue",
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
  outputFormat?: string; // Unsupported legacy Gemini CLI option
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

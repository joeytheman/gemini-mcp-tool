

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
  UNSUPPORTED_OUTPUT_FORMAT: "outputFormat must be 'text' or 'json'. Antigravity CLI has no stream-json mode.",
  JSON_SCHEMA_REQUIRES_JSON: "jsonSchema requires outputFormat: 'json'.",
  INVALID_EFFORT: "effort must be one of: low, medium, high.",
  AGY_JSON_PARSE: "Could not parse the Antigravity CLI JSON envelope",
  AGY_STATUS_ERROR: "Antigravity CLI returned status ERROR",
  AGY_DENIED_ACTIONS: "Antigravity CLI produced no response because it denied required actions. Retry with `yolo: true`, or allow the actions in the Antigravity `permissions.allow` settings. Denied",
  INVALID_CONVERSATION_ID: "conversationId must be a non-empty agy conversation ID.",
  CONVERSATION_NOT_RESUMED: "agy did not resume conversation",
  INVALID_WORKING_DIRECTORY: "workingDirectory must be an absolute path to an existing directory that is not a filesystem root",
  LIVE_PASS_ARTIFACT_DIR: "artifactDir must be an absolute path strictly inside workingDirectory",
  LIVE_PASS_NO_BRIEF: "brief is required: describe the base URL or app id, the served-branch marker, the seed case, and any navigation hints.",
  // agy resolves an @reference up to the first space, so a path containing
  // whitespace becomes a dangling reference that hangs until --print-timeout.
  UNREFERENCEABLE_PATH: "path contains whitespace, which Antigravity CLI cannot resolve as an @reference. Move or rename it so the path has no spaces",
  SCREEN_REVIEW_NO_IMAGES: "review mode requires at least one absolute image path",
  SCREEN_REVIEW_IMAGE_MISSING: "image does not exist",
  SCREEN_REVIEW_ROUTE_FILE: "plan mode requires routeFile: an absolute path to an existing file inside workingDirectory",
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

// Models. The tier in an Antigravity model name IS its reasoning effort, which
// is why `--effort` is rejected for these names.
export const MODELS = {
  DEFAULT: "Gemini 4 Argon (High)",
  MEDIUM: "Gemini 3.8 Flash (Medium)",
} as const;

export const MODEL_CHOICE_DESCRIPTION =
  "Optional Antigravity model name. Verified options: 'Gemini 4 Argon (Low)', 'Gemini 4 Argon (Medium)', 'Gemini 4 Argon (High)', 'Gemini 3.8 Flash (Low)', 'Gemini 3.8 Flash (Medium)', and 'Gemini 3.8 Flash (High)'. Availability depends on your CLI version and account; check `agy models`. Some accounts also expose 'Gemini 3.1 Pro (Low)' and 'Gemini 3.1 Pro (High)'. The tier in the name is the reasoning effort.";

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
  LAYOUT_CHECK_ID: "layout-check/1",
  LAYOUT_MAX_ENTRIES: 50,
  LAYOUT_TEXT_CHARS: 80,
} as const;

/**
 * Run in the page by browser_evaluate after each web frame, printed verbatim in
 * the live-pass prompt. Its return value is the `.layout.json` file the layout
 * validator parses, so the two change together. Text is capped on purpose when
 * its own box sets -webkit-line-clamp or text-overflow: ellipsis (React Native
 * Web's numberOfLines > 1 and === 1); those go to `clamped`, never `entries`.
 */
export const LAYOUT_CHECK_SNIPPET = `() => {
  const W = innerWidth, H = innerHeight, CAP = ${LIVE_PASS.LAYOUT_MAX_ENTRIES}, LEVELS = 4;
  const entries = [], clamped = [];
  let found = 0;
  const cs = (el) => getComputedStyle(el);
  const rect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
  const words = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, ${LIVE_PASS.LAYOUT_TEXT_CHARS});
  const testID = (el) => el.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
  const add = (list, kind, el, r, text) => {
    if (list === entries) found++;
    if (list.length < CAP) list.push({ kind, text: text ?? words(el), testID: el ? testID(el) : null, rect: rect(r) });
  };
  const shown = (el, r) => r.width > 0 && r.height > 0 && cs(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"],[inert]');
  const onScreen = (r) => r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const capped = (s) => (s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis';
  const blockOf = (el) => { let b = el; while (b.parentElement && ['inline', 'contents'].includes(cs(b).display)) b = b.parentElement; return b; };

  const page = document.scrollingElement || document.documentElement;
  if (page.scrollWidth > W) add(entries, 'page-scroll-x', null, { left: 0, top: 0, width: page.scrollWidth, height: H }, 'scrollWidth ' + page.scrollWidth + ' > innerWidth ' + W);

  const range = document.createRange();
  for (const el of document.body.querySelectorAll('*')) {
    if (el.matches('input, textarea, select, script, style, noscript') || el.isContentEditable) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    const own = blockOf(el);
    const ownRect = own.getBoundingClientRect();
    if (!shown(el, ownRect) || !onScreen(ownRect)) continue;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const n of texts) {
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      if (!tr.width) continue;
      l = Math.min(l, tr.left); t = Math.min(t, tr.top); r = Math.max(r, tr.right); b = Math.max(b, tr.bottom);
    }
    if (l === Infinity) continue;
    const ownStyle = cs(own);
    for (let box = own, level = 0; box && box !== document.body && level < LEVELS; box = box.parentElement) {
      const s = cs(box);
      if (['inline', 'contents'].includes(s.display)) continue;
      level++;
      const br = box.getBoundingClientRect();
      const cl = br.left + box.clientLeft, ct = br.top + box.clientTop, cr = cl + box.clientWidth, cb = ct + box.clientHeight;
      const outX = l < cl - 1 || r > cr + 1, outY = t < ct - 1 || b > cb + 1;
      if ((clips(s.overflowX) && outX) || (clips(s.overflowY) && outY)) {
        const partlyVisible = l < cr && r > cl && t < cb && b > ct;
        if (partlyVisible) add(box === own && capped(ownStyle) ? clamped : entries, box === own && capped(ownStyle) ? 'text-clamped' : 'text-clipped', el, el.getBoundingClientRect());
        break;
      }
      if (scrolls(s.overflowX) || scrolls(s.overflowY)) break;
      if (outX) { add(entries, 'text-spill', el, el.getBoundingClientRect()); break; }
      if (s.position === 'absolute' || s.position === 'fixed') break;
    }
  }

  const modal = [...document.querySelectorAll('[aria-modal="true"]')].find((m) => shown(m, m.getBoundingClientRect()));
  const scrollsX = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (scrolls(cs(a).overflowX) && a.scrollWidth > a.clientWidth) return true; return false; };
  const controls = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="slider"], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(controls)) {
    const r = el.getBoundingClientRect();
    if (!shown(el, r) || cs(el).pointerEvents === 'none' || r.bottom <= 0 || r.top >= H) continue;
    if ((r.left < -0.5 || r.right > W + 0.5) && r.right > 0 && r.left < W && !scrollsX(el)) add(entries, 'control-offscreen', el, r);
    if (modal && !modal.contains(el)) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && !el.contains(hit) && !hit.contains(el)) add(entries, 'control-covered', el, r);
  }

  return { check: '${LIVE_PASS.LAYOUT_CHECK_ID}', viewport: { width: W, height: H }, found, entries, clamped };
}`;

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

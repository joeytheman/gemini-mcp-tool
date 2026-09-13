import { z, type ZodType } from 'zod';
import { executeCommand } from './commandExecutor.js';
import { Logger } from './logger.js';
import {
  ERROR_MESSAGES,
  MODELS,
  CLI,
  AGY_INTERNAL,
  LIVE_PASS
} from '../constants.js';

import { parseChangeModeOutput, validateChangeModeEdits } from './changeModeParser.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from './changeModeTranslator.js';
import { chunkChangeModeEdits } from './changeModeChunker.js';
import { cacheChunks, getChunks } from './chunkCache.js';
import { generateCacheKey, getCachedResponse, cacheResponse, isCacheEnabled } from './responseCache.js';
import { normalizeList, resolveFileReferences, isFilesystemRoot } from './fileReferences.js';
import { recoverFromTranscript, isRecoverableEmptyOutput } from './agyTranscriptRecovery.js';

export interface AgyCLIOptions {
  model?: string;
  sandbox?: boolean;
  changeMode?: boolean;
  yolo?: boolean;
  approvalMode?: string;
  outputFormat?: string;
  jsonSchema?: string;
  effort?: string;
  includeDirectories?: string | string[];
  debug?: boolean;
  printTimeout?: string;
  promptInteractive?: string;
  extensions?: string | string[];
  resume?: boolean | string;
  conversationId?: string;
  noCache?: boolean;
  cwd?: string;
}

export interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

export interface AgyDeniedAction {
  action?: string;
  display_name?: string;
}

/** One line of `agy --output-format json` output. */
export interface AgyJsonEnvelope {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  structured_output?: unknown;
  num_turns?: number;
  duration_seconds?: number;
  usage?: AgyUsage;
  denied_actions?: AgyDeniedAction[];
}

const AGY_STATUS_SUCCESS = 'SUCCESS';
const AGY_STATUS_ERROR = 'ERROR';
const PARSE_EXCERPT_CHARS = 200;

function isYoloEnabled(opts: AgyCLIOptions): boolean {
  return Boolean(opts.yolo) || opts.approvalMode === CLI.DEFAULTS.APPROVAL_MODE_YOLO;
}

function isJsonMode(opts: AgyCLIOptions): boolean {
  return opts.outputFormat === CLI.DEFAULTS.OUTPUT_FORMAT_JSON;
}

function validateAgyOptions(opts: AgyCLIOptions): void {
  const unsupported: string[] = [];

  if (opts.debug) unsupported.push('debug');
  if (opts.promptInteractive) unsupported.push('promptInteractive');
  if (opts.extensions) unsupported.push('extensions');
  if (opts.approvalMode && opts.approvalMode !== CLI.DEFAULTS.APPROVAL_MODE_YOLO) {
    unsupported.push(`approvalMode:${opts.approvalMode}`);
  }

  if (unsupported.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.UNSUPPORTED_AGY_OPTIONS}: ${unsupported.join(', ')}. ` +
      `The Antigravity CLI headless path supports model, sandbox, yolo, includeDirectories, printTimeout, ` +
      `resume, conversationId, outputFormat, jsonSchema, effort, and workingDirectory.`
    );
  }

  if (opts.outputFormat &&
    opts.outputFormat !== CLI.DEFAULTS.OUTPUT_FORMAT_TEXT &&
    opts.outputFormat !== CLI.DEFAULTS.OUTPUT_FORMAT_JSON) {
    throw new Error(`${ERROR_MESSAGES.UNSUPPORTED_OUTPUT_FORMAT} Received '${opts.outputFormat}'.`);
  }

  if (opts.jsonSchema && !isJsonMode(opts)) {
    throw new Error(ERROR_MESSAGES.JSON_SCHEMA_REQUIRES_JSON);
  }

  // Passthrough only: agy rejects --effort for tiered Gemini names and that
  // error is surfaced verbatim. We only guard the shape.
  if (opts.effort && !(CLI.DEFAULTS.EFFORT_LEVELS as readonly string[]).includes(opts.effort)) {
    throw new Error(`${ERROR_MESSAGES.INVALID_EFFORT} Received '${opts.effort}'.`);
  }

  if (opts.changeMode && isJsonMode(opts)) {
    throw new Error(
      `${ERROR_MESSAGES.UNSUPPORTED_AGY_OPTIONS}: changeMode with outputFormat 'json'. ` +
      `changeMode returns OLD/NEW text, not a JSON envelope.`
    );
  }

  if (opts.conversationId !== undefined && !opts.conversationId.trim()) {
    throw new Error(ERROR_MESSAGES.INVALID_CONVERSATION_ID);
  }

  // Refuse yolo (skip-permissions) from a filesystem root, which would grant agy
  // unrestricted access to the whole drive. Check the effective cwd: when
  // workingDirectory is omitted, agy inherits the server's process.cwd().
  if (isYoloEnabled(opts) && isFilesystemRoot(opts.cwd || process.cwd())) {
    throw new Error(ERROR_MESSAGES.UNSAFE_ROOT_YOLO);
  }
}

function resolveResumeArgs(resume?: boolean | string): string[] {
  if (resume === undefined || resume === false) return [];

  const normalized = String(resume).trim();
  const lower = normalized.toLowerCase();

  if (lower === CLI.DEFAULTS.BOOLEAN_FALSE) return [];
  if (normalized === '') {
    throw new Error(ERROR_MESSAGES.INVALID_RESUME);
  }

  if (resume === true ||
    lower === CLI.DEFAULTS.BOOLEAN_TRUE ||
    lower === CLI.DEFAULTS.RESUME_LATEST ||
    lower === CLI.DEFAULTS.RESUME_CONTINUE) {
    return [CLI.FLAGS.CONTINUE];
  }

  return [CLI.FLAGS.CONVERSATION, normalized];
}

/**
 * The conversation this call asked agy to resume, if any. `resume` with a bare
 * ID maps to the same `--conversation` flag as `conversationId`, so both must be
 * checked against what agy actually returned.
 */
export function requestedConversationId(opts: AgyCLIOptions): string | undefined {
  const explicit = opts.conversationId?.trim();
  if (explicit) return explicit;
  const args = resolveResumeArgs(opts.resume);
  return args[0] === CLI.FLAGS.CONVERSATION ? args[1] : undefined;
}

/** An explicit conversationId wins over `resume`. */
function resolveConversationArgs(opts: AgyCLIOptions): string[] {
  const explicit = opts.conversationId?.trim();
  if (explicit) return [CLI.FLAGS.CONVERSATION, explicit];
  return resolveResumeArgs(opts.resume);
}

function buildAgyArgs(opts: AgyCLIOptions, prompt: string, refDirs: string[]): string[] {
  const args: string[] = [];
  const model = opts.model || MODELS.DEFAULT;

  args.push(CLI.FLAGS.MODEL, model);

  if (opts.effort) {
    args.push(CLI.FLAGS.EFFORT, opts.effort);
  }

  if (opts.sandbox) {
    args.push(CLI.FLAGS.SANDBOX);
  }

  if (isYoloEnabled(opts)) {
    args.push(CLI.FLAGS.YOLO);
  }

  // Explicit includeDirectories plus the directories resolved from @file
  // references, deduped.
  for (const dir of new Set([...normalizeList(opts.includeDirectories), ...refDirs])) {
    args.push(CLI.FLAGS.ADD_DIR, dir);
  }

  if (opts.printTimeout) {
    args.push(CLI.FLAGS.PRINT_TIMEOUT, opts.printTimeout);
  }

  if (isJsonMode(opts)) {
    args.push(CLI.FLAGS.OUTPUT_FORMAT, CLI.DEFAULTS.OUTPUT_FORMAT_JSON);
    // The schema is passed inline (~2 KB); agy takes it as a flag value.
    if (opts.jsonSchema) {
      args.push(CLI.FLAGS.JSON_SCHEMA, opts.jsonSchema);
    }
  }

  args.push(...resolveConversationArgs(opts));

  args.push(CLI.FLAGS.PRINT, prompt);

  return args;
}

const CONTROL_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** Escape raw newlines/tabs that appear INSIDE JSON string literals, which JSON.parse rejects. */
function escapeControlCharsInStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (inString && escaped) { out += ch; escaped = false; continue; }
    if (inString && ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    out += (inString && CONTROL_ESCAPES[ch]) ? CONTROL_ESCAPES[ch] : ch;
  }
  return out;
}

/**
 * Parse the JSON envelope out of `agy --output-format json` stdout. agy may
 * print progress lines first, so the envelope is whatever starts at the last
 * line beginning with `{`.
 */
/**
 * An agy envelope, not merely any JSON object: `{}` must read as a parse
 * failure rather than a verified, cacheable, empty success.
 */
function isAgyEnvelope(value: unknown): value is AgyJsonEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as AgyJsonEnvelope;
  if (candidate.status === AGY_STATUS_ERROR) return true;
  // An ERROR can arrive before agy has a conversation, so only a SUCCESS is
  // required to carry the id. Either way a bare `{}` is a parse failure, not an
  // empty success.
  return candidate.status === AGY_STATUS_SUCCESS && typeof candidate.conversation_id === 'string';
}

function tryParseEnvelope(candidate: string): AgyJsonEnvelope | null {
  for (const text of [candidate, escapeControlCharsInStrings(candidate)]) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isAgyEnvelope(parsed)) return parsed;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

export function parseAgyJsonEnvelope(stdout: string): AgyJsonEnvelope {
  const lines = stdout.split('\n');

  // The envelope is the last JSON object agy printed, so start from the last
  // `{` line and walk backwards: when that line turns out to sit INSIDE the
  // envelope's own `response` (raw newlines plus quoted JSON), the earlier real
  // start line still parses. Progress lines printed before it are never reached.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].trimStart().startsWith('{')) continue;
    const envelope = tryParseEnvelope(lines.slice(index).join('\n').trim());
    if (envelope) return envelope;
  }

  throw new Error(
    `${ERROR_MESSAGES.AGY_JSON_PARSE}. Output began: ${stdout.trim().slice(0, PARSE_EXCERPT_CHARS)}`
  );
}

/** Human-readable "DisplayName (action)" list of the actions agy refused to run. */
export function deniedActionsSummary(envelope: AgyJsonEnvelope): string {
  return (envelope.denied_actions ?? [])
    .map(denied => `${denied.display_name || denied.action || 'unknown'} (${denied.action || 'unknown'})`)
    .join(', ');
}

export function formatAgyUsageLine(envelope: AgyJsonEnvelope): string {
  const usage = envelope.usage ?? {};
  return `Usage: ${envelope.num_turns ?? '?'} turns · ${envelope.duration_seconds ?? '?'}s · tokens in ` +
    `${usage.input_tokens ?? 0} / out ${usage.output_tokens ?? 0} / thinking ${usage.thinking_tokens ?? 0} / ` +
    `cache ${usage.cache_read_tokens ?? 0} / total ${usage.total_tokens ?? 0}`;
}

/**
 * Render an envelope for a human reader. A resumed turn replays the PREVIOUS
 * turn's structured_output, so it is only trusted when this call passed a schema.
 */
export function renderAgyJsonEnvelope(envelope: AgyJsonEnvelope, opts: { hadSchema?: boolean } = {}): string {
  if (opts.hadSchema && envelope.structured_output !== undefined && envelope.structured_output !== null) {
    return JSON.stringify(envelope.structured_output, null, 2);
  }
  return envelope.response ?? '';
}

export function formatConversationLine(conversationId: string): string {
  return `${LIVE_PASS.CONVERSATION_LINE_PREFIX}${conversationId}]`;
}

/** A zod schema as the JSON Schema agy's `--json-schema` accepts (no `$schema` key). */
export function toAgyJsonSchema(schema: ZodType): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/**
 * Validate a json-mode run before it is cached or returned. Throws for every
 * failure mode agy signals inside an exit-0 envelope.
 */
function verifyJsonEnvelope(stdout: string, opts: AgyCLIOptions): void {
  if (stdout.trim() === AGY_INTERNAL.TIMEOUT_SENTINEL) {
    throw new Error(ERROR_MESSAGES.AGY_NO_OUTPUT);
  }

  const envelope = parseAgyJsonEnvelope(stdout);

  if (envelope.status === AGY_STATUS_ERROR) {
    throw new Error(`${ERROR_MESSAGES.AGY_STATUS_ERROR}: ${envelope.error || 'no error text'}`);
  }

  // A stale or unknown ID only warns on stderr and silently starts a NEW
  // conversation with status SUCCESS, so compare what came back.
  const requested = requestedConversationId(opts);
  if (requested && envelope.conversation_id !== requested) {
    throw new Error(
      `${ERROR_MESSAGES.CONVERSATION_NOT_RESUMED} ${requested}; it returned ` +
      `${envelope.conversation_id || '(none)'}. The ID is unknown to this machine or workspace.`
    );
  }

  const hasContent = Boolean(envelope.response?.trim()) ||
    (envelope.structured_output !== undefined && envelope.structured_output !== null);
  const denied = deniedActionsSummary(envelope);
  if (!hasContent && denied) {
    throw new Error(`${ERROR_MESSAGES.AGY_DENIED_ACTIONS}: ${denied}`);
  }
}

export async function executeAgyCLI(
  prompt: string,
  options: AgyCLIOptions | string,
  onProgress?: (newOutput: string) => void
): Promise<string> {
  const opts: AgyCLIOptions = typeof options === 'string'
    ? { model: options }
    : options || {};

  validateAgyOptions(opts);

  // Cache key (computed once) is only used when caching is enabled and the call
  // is repeatable: changeMode, resumed turns and opt-outs are never cached
  // because their answer depends on conversation state, not just the prompt.
  const cacheable = isCacheEnabled() && !opts.changeMode && !opts.resume &&
    !opts.conversationId && !opts.noCache;
  const cacheKey = cacheable ? generateCacheKey(prompt, opts) : undefined;
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      Logger.debug('Returning cached response');
      return cached;
    }
  }

  // Normalize file references and register the directories of any reference
  // that resolves to a real file under a trusted root, so agy can read them (a
  // bare @file outside an added dir makes agy hang). Unresolved references are
  // passed through untouched.
  const { prompt: resolvedPrompt, addDirs: refDirs } = resolveFileReferences(
    prompt,
    { cwd: opts.cwd, includeDirectories: opts.includeDirectories },
  );
  let processedPrompt = resolvedPrompt;

  if (opts.changeMode) {
    const changeModeInstructions = `
[CHANGEMODE INSTRUCTIONS]
You are generating code modifications that will be processed by an automated system. The output format is critical because it enables programmatic application of changes without human intervention.

INSTRUCTIONS:
1. Analyze each provided file thoroughly
2. Identify locations requiring changes based on the user request
3. For each change, output in the exact format specified
4. The OLD section must be EXACTLY what appears in the file (copy-paste exact match)
5. Provide complete, directly replacing code blocks
6. Verify line numbers are accurate

CRITICAL REQUIREMENTS:
1. Output edits in the EXACT format specified below - no deviations
2. The OLD string MUST be findable with Ctrl+F - it must be a unique, exact match
3. Include enough surrounding lines to make the OLD string unique
4. If a string appears multiple times (like </div>), include enough context lines above and below to make it unique
5. Copy the OLD content EXACTLY as it appears - including all whitespace, indentation, line breaks
6. Never use partial lines - always include complete lines from start to finish

OUTPUT FORMAT (follow exactly):
**FILE: [filename]:[line_number]**
\`\`\`
OLD:
[exact code to be replaced - must match file content precisely]
NEW:
[new code to insert - complete and functional]
\`\`\`

EXAMPLE 1 - Simple unique match:
**FILE: src/utils/helper.js:100**
\`\`\`
OLD:
function getMessage() {
  return "Hello World";
}
NEW:
function getMessage() {
  return "Hello Universe!";
}
\`\`\`

EXAMPLE 2 - Common tag needing context:
**FILE: index.html:245**
\`\`\`
OLD:
        </div>
      </div>
    </section>
NEW:
        </div>
      </footer>
    </section>
\`\`\`

IMPORTANT: The OLD section must be an EXACT copy from the file that can be found with Ctrl+F!

USER REQUEST:
${processedPrompt}
`;
    processedPrompt = changeModeInstructions;
  }

  const args = buildAgyArgs(opts, processedPrompt, refDirs);

  const runStartMs = Date.now();
  try {
    const result = await executeCommand(CLI.COMMANDS.AGY, args, onProgress, opts.cwd);

    // json mode carries its own failure signalling in the envelope, so it is
    // verified here instead of going through transcript recovery.
    if (isJsonMode(opts)) {
      verifyJsonEnvelope(result, opts);
      if (cacheKey) cacheResponse(cacheKey, result);
      return result;
    }

    // agy can exit 0 with empty/timeout stdout while the real answer is only in
    // its transcript. Recover BEFORE caching or changeMode parsing.
    let finalResult = result;
    if (isRecoverableEmptyOutput(result)) {
      Logger.debug('agy returned empty/timeout output; attempting transcript recovery');
      const recovered = recoverFromTranscript({
        cwd: opts.cwd,
        conversationId: requestedConversationId(opts),
        runStartMs,
      });
      if (recovered) {
        finalResult = recovered;
      } else if (result.trim() === AGY_INTERNAL.TIMEOUT_SENTINEL) {
        // The timeout sentinel is never a real answer; fail loud.
        throw new Error(ERROR_MESSAGES.AGY_NO_OUTPUT);
      } else {
        // Genuinely empty output (e.g. a changeMode request the model decided
        // needs no edits). Preserve the legacy soft result rather than erroring.
        finalResult = '';
      }
    }

    // Never cache an empty result — it is not a useful answer and an empty
    // string would crash the size-bounded LRU (size 0).
    if (cacheKey && finalResult) {
      cacheResponse(cacheKey, finalResult);
    }

    return finalResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('command not found')) {
      throw new Error(ERROR_MESSAGES.AGY_NOT_FOUND);
    }
    throw error;
  }
}

/** Run agy in json mode and return the parsed envelope. */
export async function executeAgyJson(
  prompt: string,
  options: AgyCLIOptions = {},
  onProgress?: (newOutput: string) => void
): Promise<AgyJsonEnvelope> {
  const raw = await executeAgyCLI(
    prompt,
    { ...options, outputFormat: CLI.DEFAULTS.OUTPUT_FORMAT_JSON },
    onProgress
  );
  return parseAgyJsonEnvelope(raw);
}

export async function processChangeModeOutput(
  rawResult: string,
  chunkIndex?: number,
  chunkCacheKey?: string,
  prompt?: string
): Promise<string> {
  if (chunkIndex && chunkCacheKey) {
    const cachedChunks = getChunks(chunkCacheKey);
    if (cachedChunks && chunkIndex > 0 && chunkIndex <= cachedChunks.length) {
      Logger.debug(`Using cached chunk ${chunkIndex} of ${cachedChunks.length}`);
      const chunk = cachedChunks[chunkIndex - 1];
      let result = formatChangeModeResponse(
        chunk.edits,
        { current: chunkIndex, total: cachedChunks.length, cacheKey: chunkCacheKey }
      );

      if (chunkIndex === 1 && chunk.edits.length > 5) {
        const allEdits = cachedChunks.flatMap(c => c.edits);
        result = summarizeChangeModeEdits(allEdits) + '\n\n' + result;
      }

      return result;
    }
    Logger.debug(`Cache miss or invalid chunk index, processing new result`);
  }

  const edits = parseChangeModeOutput(rawResult);

  if (edits.length === 0) {
    return `No edits found in Gemini's response. Please ensure Gemini uses the OLD/NEW format. \n\n+ ${rawResult}`;
  }

  const validation = validateChangeModeEdits(edits);
  if (!validation.valid) {
    return `Edit validation failed:\n${validation.errors.join('\n')}`;
  }

  const chunks = chunkChangeModeEdits(edits);

  let cacheKey: string | undefined;
  if (chunks.length > 1 && prompt) {
    cacheKey = cacheChunks(prompt, chunks);
    Logger.debug(`Cached ${chunks.length} chunks with key: ${cacheKey}`);
  }

  const returnChunkIndex = (chunkIndex && chunkIndex > 0 && chunkIndex <= chunks.length) ? chunkIndex : 1;
  const returnChunk = chunks[returnChunkIndex - 1];

  let result = formatChangeModeResponse(
    returnChunk.edits,
    chunks.length > 1 ? { current: returnChunkIndex, total: chunks.length, cacheKey } : undefined
  );

  if (returnChunkIndex === 1 && edits.length > 5) {
    result = summarizeChangeModeEdits(edits, chunks.length > 1) + '\n\n' + result;
  }

  Logger.debug(`ChangeMode: Parsed ${edits.length} edits, ${chunks.length} chunks, returning chunk ${returnChunkIndex}`);
  return result;
}

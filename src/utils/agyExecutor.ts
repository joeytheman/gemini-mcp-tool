import { executeCommand } from './commandExecutor.js';
import { Logger } from './logger.js';
import {
  ERROR_MESSAGES,
  MODELS,
  CLI,
  AGY_INTERNAL
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
  includeDirectories?: string | string[];
  debug?: boolean;
  printTimeout?: string;
  promptInteractive?: string;
  extensions?: string | string[];
  resume?: boolean | string;
  cwd?: string;
}

function isYoloEnabled(opts: AgyCLIOptions): boolean {
  return Boolean(opts.yolo) || opts.approvalMode === CLI.DEFAULTS.APPROVAL_MODE_YOLO;
}

function validateAgyOptions(opts: AgyCLIOptions): void {
  const unsupported: string[] = [];

  if (opts.outputFormat) unsupported.push('outputFormat');
  if (opts.debug) unsupported.push('debug');
  if (opts.promptInteractive) unsupported.push('promptInteractive');
  if (opts.extensions) unsupported.push('extensions');
  if (opts.approvalMode && opts.approvalMode !== CLI.DEFAULTS.APPROVAL_MODE_YOLO) {
    unsupported.push(`approvalMode:${opts.approvalMode}`);
  }

  if (unsupported.length > 0) {
    throw new Error(
      `${ERROR_MESSAGES.UNSUPPORTED_AGY_OPTIONS}: ${unsupported.join(', ')}. ` +
      `The Antigravity CLI headless path supports model, sandbox, yolo, includeDirectories, printTimeout, resume, and workingDirectory.`
    );
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

function buildAgyArgs(opts: AgyCLIOptions, prompt: string, refDirs: string[]): string[] {
  const args: string[] = [];
  const model = opts.model || MODELS.DEFAULT;

  args.push(CLI.FLAGS.MODEL, model);

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

  args.push(...resolveResumeArgs(opts.resume));

  args.push(CLI.FLAGS.PRINT, prompt);

  return args;
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

  // Cache key (computed once) is only used when caching is enabled and this is
  // not a changeMode request.
  const cacheKey = (isCacheEnabled() && !opts.changeMode)
    ? generateCacheKey(prompt, opts)
    : undefined;
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

    // agy can exit 0 with empty/timeout stdout while the real answer is only in
    // its transcript. Recover BEFORE caching or changeMode parsing.
    let finalResult = result;
    if (isRecoverableEmptyOutput(result)) {
      Logger.debug('agy returned empty/timeout output; attempting transcript recovery');
      const recovered = recoverFromTranscript({ cwd: opts.cwd, runStartMs });
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

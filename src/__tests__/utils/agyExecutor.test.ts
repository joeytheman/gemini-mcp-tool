import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    commandExecution: vi.fn(),
    commandComplete: vi.fn(),
  },
}));

const mockExecuteCommand = vi.fn();
vi.mock('../../utils/commandExecutor.js', () => ({
  executeCommand: (...args: any[]) => mockExecuteCommand(...args),
}));

const mockIsCacheEnabled = vi.fn().mockReturnValue(false);
const mockGenerateCacheKey = vi.fn().mockReturnValue('mock-cache-key');
const mockGetCachedResponse = vi.fn().mockReturnValue(undefined);
const mockCacheResponse = vi.fn();
vi.mock('../../utils/responseCache.js', () => ({
  isCacheEnabled: () => mockIsCacheEnabled(),
  generateCacheKey: (...args: any[]) => mockGenerateCacheKey(...args),
  getCachedResponse: (...args: any[]) => mockGetCachedResponse(...args),
  cacheResponse: (...args: any[]) => mockCacheResponse(...args),
}));

vi.mock('../../utils/chunkCache.js', () => ({
  cacheChunks: vi.fn().mockReturnValue('chunk123'),
  getChunks: vi.fn().mockReturnValue(null),
}));

const mockRecover = vi.fn();
vi.mock('../../utils/agyTranscriptRecovery.js', () => ({
  isRecoverableEmptyOutput: (s: string) => {
    const t = s.trim();
    return t === '' || t === 'Error: timed out waiting for response';
  },
  recoverFromTranscript: (...args: any[]) => mockRecover(...args),
}));

import {
  executeAgyCLI,
  executeAgyJson,
  processChangeModeOutput,
  parseAgyJsonEnvelope,
  renderAgyJsonEnvelope,
  deniedActionsSummary,
  formatAgyUsageLine,
  formatConversationLine,
} from '../../utils/agyExecutor.js';
import { CLI, MODELS, ERROR_MESSAGES } from '../../constants.js';

describe('executeAgyCLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCacheEnabled.mockReturnValue(false);
    mockGenerateCacheKey.mockReturnValue('mock-cache-key');
    mockGetCachedResponse.mockReturnValue(undefined);
    mockExecuteCommand.mockResolvedValue('Gemini response');
  });

  describe('argument building', () => {
    it('should use agy with the default Gemini model and print mode', async () => {
      await executeAgyCLI('test', {});

      expect(MODELS.DEFAULT).toBe('Gemini 3.8 Flash (High)');
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        CLI.COMMANDS.AGY,
        [CLI.FLAGS.MODEL, MODELS.DEFAULT, CLI.FLAGS.PRINT, 'test'],
        undefined,
        undefined
      );
    });

    it('should add model flag when specified', async () => {
      await executeAgyCLI('test', { model: 'Gemini 3.8 Flash (Medium)' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.MODEL);
      expect(args).toContain('Gemini 3.8 Flash (Medium)');
    });

    it('should add sandbox flag when specified', async () => {
      await executeAgyCLI('test', { sandbox: true });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.SANDBOX);
    });

    it('should map yolo to dangerously skip permissions', async () => {
      await executeAgyCLI('test', { yolo: true });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.YOLO);
    });

    it('should map approvalMode yolo to dangerously skip permissions', async () => {
      await executeAgyCLI('test', { approvalMode: 'yolo' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.YOLO);
    });

    it('should map includeDirectories array to repeated add-dir flags', async () => {
      await executeAgyCLI('test', { includeDirectories: ['src', 'lib'] });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toEqual([
        CLI.FLAGS.MODEL,
        MODELS.DEFAULT,
        CLI.FLAGS.ADD_DIR,
        'src',
        CLI.FLAGS.ADD_DIR,
        'lib',
        CLI.FLAGS.PRINT,
        'test',
      ]);
    });

    it('should split includeDirectories string and map to repeated add-dir flags', async () => {
      await executeAgyCLI('test', { includeDirectories: 'src, lib' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.ADD_DIR);
      expect(args.filter((arg: string) => arg === CLI.FLAGS.ADD_DIR)).toHaveLength(2);
      expect(args).toContain('src');
      expect(args).toContain('lib');
    });

    it('should add print timeout when specified', async () => {
      await executeAgyCLI('test', { printTimeout: '10m' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.PRINT_TIMEOUT);
      expect(args).toContain('10m');
    });

    it('should map latest resume values to continue', async () => {
      await executeAgyCLI('test', { resume: 'latest' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.CONTINUE);
      expect(args).not.toContain(CLI.FLAGS.CONVERSATION);
    });

    it('should map conversation IDs to conversation flag', async () => {
      await executeAgyCLI('test', { resume: 'conversation-123' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.CONVERSATION);
      expect(args).toContain('conversation-123');
    });

    it('should reject blank resume values', async () => {
      await expect(executeAgyCLI('test', { resume: '   ' }))
        .rejects.toThrow('resume must be true, latest, continue, or a non-empty conversation ID');

      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('should pass prompt through --print rather than a positional prompt', async () => {
      await executeAgyCLI('analyze @file.ts', {});

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args[args.length - 2]).toBe(CLI.FLAGS.PRINT);
      expect(args[args.length - 1]).toBe('analyze @file.ts');
    });

    it('should pass cwd when specified', async () => {
      await executeAgyCLI('test', { cwd: '/some/path' });

      const cwd = mockExecuteCommand.mock.calls[0][3];
      expect(cwd).toBe('/some/path');
    });

    it('should handle string options for model compatibility', async () => {
      await executeAgyCLI('test', 'Gemini 3.8 Flash (Low)');

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.MODEL);
      expect(args).toContain('Gemini 3.8 Flash (Low)');
    });
  });

  describe('unsupported legacy Gemini CLI options', () => {
    it.each([
      [{ debug: true }, 'debug'],
      [{ extensions: ['ts'] }, 'extensions'],
      [{ promptInteractive: 'hello' }, 'promptInteractive'],
      [{ approvalMode: 'auto_edit' }, 'approvalMode:auto_edit'],
    ])('should reject unsupported option %s', async (options, optionName) => {
      await expect(executeAgyCLI('test', options as any)).rejects.toThrow(String(optionName));
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
  });

  describe('no fallback behavior', () => {
    it('should not retry when the agy backend reports resource exhaustion', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED'));

      await expect(executeAgyCLI('test', { model: 'Gemini 3.8 Flash (Medium)' }))
        .rejects.toThrow('RESOURCE_EXHAUSTED');

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it('should return install guidance when agy is missing', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('Failed to spawn command: ENOENT'));

      await expect(executeAgyCLI('test', {})).rejects.toThrow(ERROR_MESSAGES.AGY_NOT_FOUND);
    });
  });

  describe('output recovery', () => {
    it('recovers from the transcript when stdout is empty', async () => {
      mockExecuteCommand.mockResolvedValue('');
      mockRecover.mockReturnValue('RECOVERED ANSWER');

      const result = await executeAgyCLI('test', {});

      expect(result).toBe('RECOVERED ANSWER');
      expect(mockRecover).toHaveBeenCalled();
    });

    it('recovers when stdout is the timeout sentinel', async () => {
      mockExecuteCommand.mockResolvedValue('Error: timed out waiting for response');
      mockRecover.mockReturnValue('RECOVERED ANSWER');

      const result = await executeAgyCLI('test', {});

      expect(result).toBe('RECOVERED ANSWER');
    });

    it('throws AGY_NO_OUTPUT for the timeout sentinel when recovery fails', async () => {
      mockIsCacheEnabled.mockReturnValue(true);
      mockExecuteCommand.mockResolvedValue('Error: timed out waiting for response');
      mockRecover.mockReturnValue(null);

      await expect(executeAgyCLI('test', {})).rejects.toThrow(ERROR_MESSAGES.AGY_NO_OUTPUT);
      expect(mockCacheResponse).not.toHaveBeenCalled();
    });

    it('returns empty (soft) and does not cache for genuinely empty output without recovery', async () => {
      mockIsCacheEnabled.mockReturnValue(true);
      mockExecuteCommand.mockResolvedValue('');
      mockRecover.mockReturnValue(null);

      const result = await executeAgyCLI('test', {});

      expect(result).toBe('');
      expect(mockCacheResponse).not.toHaveBeenCalled();
    });

    it('does not attempt recovery for normal output', async () => {
      mockExecuteCommand.mockResolvedValue('a real answer');

      const result = await executeAgyCLI('test', {});

      expect(result).toBe('a real answer');
      expect(mockRecover).not.toHaveBeenCalled();
    });
  });

  describe('safety guards', () => {
    it('refuses yolo with a filesystem-root workingDirectory', async () => {
      await expect(executeAgyCLI('test', { yolo: true, cwd: '/' }))
        .rejects.toThrow(ERROR_MESSAGES.UNSAFE_ROOT_YOLO);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
  });

  describe('cache integration', () => {
    it('should return cached response when cache is enabled', async () => {
      mockIsCacheEnabled.mockReturnValue(true);
      mockGetCachedResponse.mockReturnValue('cached result');

      const result = await executeAgyCLI('test', {});

      expect(result).toBe('cached result');
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('should cache successful responses when cache is enabled', async () => {
      mockIsCacheEnabled.mockReturnValue(true);
      mockGetCachedResponse.mockReturnValue(undefined);
      mockExecuteCommand.mockResolvedValue('fresh result');

      await executeAgyCLI('test', {});

      expect(mockCacheResponse).toHaveBeenCalledWith('mock-cache-key', 'fresh result');
    });

    it('should not cache changeMode responses', async () => {
      mockIsCacheEnabled.mockReturnValue(true);
      mockGetCachedResponse.mockReturnValue(undefined);
      mockExecuteCommand.mockResolvedValue('edit result');

      await executeAgyCLI('test', { changeMode: true });

      expect(mockCacheResponse).not.toHaveBeenCalled();
    });

    it('should not use cache when disabled', async () => {
      mockIsCacheEnabled.mockReturnValue(false);

      await executeAgyCLI('test', {});

      expect(mockGetCachedResponse).not.toHaveBeenCalled();
    });
  });
});

describe('processChangeModeOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse raw result and return formatted edits', async () => {
    const raw = `**FILE: src/a.ts:10**
\`\`\`
OLD:
const x = 1;
NEW:
const x = 2;
\`\`\``;

    const result = await processChangeModeOutput(raw);
    expect(result).toContain('[CHANGEMODE OUTPUT');
    expect(result).toContain('src/a.ts');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('const x = 2;');
  });

  it('should return "No edits found" for unparseable input', async () => {
    const result = await processChangeModeOutput('just some random text');
    expect(result).toContain('No edits found');
  });

  it('should return validation errors for invalid edits', async () => {
    const raw = `**FILE: src/a.ts:10**
\`\`\`
OLD:
old code
NEW:
new code
\`\`\``;

    const result = await processChangeModeOutput(raw);
    expect(result).not.toContain('validation failed');
  });

  it('should handle cached chunks when cacheKey provided', async () => {
    const { getChunks } = await import('../../utils/chunkCache.js');
    vi.mocked(getChunks).mockReturnValueOnce([
      {
        edits: [{
          filename: 'cached.ts',
          oldStartLine: 1,
          oldEndLine: 1,
          oldCode: 'cached old',
          newStartLine: 1,
          newEndLine: 1,
          newCode: 'cached new',
        }],
        chunkIndex: 1,
        totalChunks: 2,
        hasMore: true,
        estimatedChars: 500,
      },
      {
        edits: [{
          filename: 'cached2.ts',
          oldStartLine: 1,
          oldEndLine: 1,
          oldCode: 'old2',
          newStartLine: 1,
          newEndLine: 1,
          newCode: 'new2',
        }],
        chunkIndex: 2,
        totalChunks: 2,
        hasMore: false,
        estimatedChars: 400,
      },
    ]);

    const result = await processChangeModeOutput('ignored', 1, 'cache-key');
    expect(result).toContain('cached.ts');
    expect(result).toContain('Chunk 1 of 2');
  });

  it('should add summary for cached chunk 1 with >5 edits', async () => {
    const { getChunks } = await import('../../utils/chunkCache.js');
    const manyEdits = Array.from({ length: 6 }, (_, i) => ({
      filename: `file${i}.ts`,
      oldStartLine: 1,
      oldEndLine: 1,
      oldCode: `old${i}`,
      newStartLine: 1,
      newEndLine: 1,
      newCode: `new${i}`,
    }));
    vi.mocked(getChunks).mockReturnValueOnce([
      {
        edits: manyEdits,
        chunkIndex: 1,
        totalChunks: 2,
        hasMore: true,
        estimatedChars: 2000,
      },
      {
        edits: [{
          filename: 'extra.ts',
          oldStartLine: 1,
          oldEndLine: 1,
          oldCode: 'old',
          newStartLine: 1,
          newEndLine: 1,
          newCode: 'new',
        }],
        chunkIndex: 2,
        totalChunks: 2,
        hasMore: false,
        estimatedChars: 200,
      },
    ]);

    const result = await processChangeModeOutput('ignored', 1, 'cache-key');
    expect(result).toContain('ChangeMode Summary');
    expect(result).toContain('Chunk 1 of 2');
  });

  it('should cache multi-chunk results and return first chunk with summary', async () => {
    const editBlocks = Array.from({ length: 7 }, (_, i) =>
`**FILE: src/file${i}.ts:1**
\`\`\`
OLD:
${'x'.repeat(3000)}
NEW:
${'y'.repeat(3000)}
\`\`\``
    ).join('\n\n');

    const result = await processChangeModeOutput(editBlocks, undefined, undefined, 'original prompt');

    expect(result).toContain('[CHANGEMODE OUTPUT');
    expect(result).toContain('ChangeMode Summary');
    expect(result).toContain('Total edits: 7');
  });

  it('should process new result when cache misses', async () => {
    const { getChunks } = await import('../../utils/chunkCache.js');
    vi.mocked(getChunks).mockReturnValueOnce(null);

    const raw = `**FILE: src/fresh.ts:1**
\`\`\`
OLD:
old
NEW:
new
\`\`\``;

    const result = await processChangeModeOutput(raw, 1, 'bad-key');
    expect(result).toContain('src/fresh.ts');
  });
});

const ENVELOPE = {
  conversation_id: 'conv-abc',
  status: 'SUCCESS',
  response: 'plain answer',
  structured_output: { ok: true },
  num_turns: 2,
  duration_seconds: 12.5,
  usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 0, total_tokens: 125 },
  denied_actions: [],
};

function envelopeLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...ENVELOPE, ...overrides });
}

describe('executeAgyCLI json mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCacheEnabled.mockReturnValue(false);
    mockGenerateCacheKey.mockReturnValue('mock-cache-key');
    mockGetCachedResponse.mockReturnValue(undefined);
    mockExecuteCommand.mockResolvedValue(envelopeLine());
  });

  it('adds --output-format json without a schema', async () => {
    await executeAgyCLI('test', { outputFormat: 'json' });

    const args = mockExecuteCommand.mock.calls[0][1];
    expect(args).toContain(CLI.FLAGS.OUTPUT_FORMAT);
    expect(args).toContain('json');
    expect(args).not.toContain(CLI.FLAGS.JSON_SCHEMA);
  });

  it('adds --json-schema inline when a schema is given', async () => {
    const schema = '{"type":"object"}';
    await executeAgyCLI('test', { outputFormat: 'json', jsonSchema: schema });

    const args = mockExecuteCommand.mock.calls[0][1];
    expect(args).toContain(CLI.FLAGS.JSON_SCHEMA);
    expect(args).toContain(schema);
  });

  it('returns the raw envelope line', async () => {
    const raw = envelopeLine();
    mockExecuteCommand.mockResolvedValue(raw);

    expect(await executeAgyCLI('test', { outputFormat: 'json' })).toBe(raw);
  });

  it('surfaces a fatal ERROR envelope that carries no conversation id', async () => {
    mockExecuteCommand.mockResolvedValue('{"status":"ERROR","error":"agy could not start"}');

    await expect(executeAgyCLI('test', { outputFormat: 'json' })).rejects.toThrow('agy could not start');
  });

  it('throws the envelope error text on status ERROR', async () => {
    mockExecuteCommand.mockResolvedValue(envelopeLine({
      status: 'ERROR',
      error: '--effort is not supported for model "Gemini 3.8 Flash (High)"',
      response: '',
    }));

    await expect(executeAgyCLI('test', { outputFormat: 'json' }))
      .rejects.toThrow('--effort is not supported for model "Gemini 3.8 Flash (High)"');
  });

  it('throws AGY_JSON_PARSE for empty stdout and never runs transcript recovery', async () => {
    mockExecuteCommand.mockResolvedValue('');

    await expect(executeAgyCLI('test', { outputFormat: 'json' }))
      .rejects.toThrow(ERROR_MESSAGES.AGY_JSON_PARSE);
    expect(mockRecover).not.toHaveBeenCalled();
  });

  it('throws AGY_NO_OUTPUT for the timeout sentinel', async () => {
    mockExecuteCommand.mockResolvedValue('Error: timed out waiting for response');

    await expect(executeAgyCLI('test', { outputFormat: 'json' }))
      .rejects.toThrow(ERROR_MESSAGES.AGY_NO_OUTPUT);
  });

  it('throws with the denied action when agy produced no response', async () => {
    mockIsCacheEnabled.mockReturnValue(true);
    mockExecuteCommand.mockResolvedValue(envelopeLine({
      response: '',
      structured_output: null,
      denied_actions: [{ action: 'command', display_name: 'RunCommand' }],
    }));

    await expect(executeAgyCLI('test', { outputFormat: 'json' }))
      .rejects.toThrow('RunCommand (command)');
    expect(mockCacheResponse).not.toHaveBeenCalled();
  });

  it('resolves when actions were denied but a response still came back', async () => {
    const raw = envelopeLine({ denied_actions: [{ action: 'command', display_name: 'RunCommand' }] });
    mockExecuteCommand.mockResolvedValue(raw);

    expect(await executeAgyCLI('test', { outputFormat: 'json' })).toBe(raw);
  });

  it('throws CONVERSATION_NOT_RESUMED when agy silently started a new conversation', async () => {
    mockIsCacheEnabled.mockReturnValue(true);
    mockExecuteCommand.mockResolvedValue(envelopeLine({ conversation_id: 'conv-other' }));

    await expect(executeAgyCLI('test', { outputFormat: 'json', conversationId: 'conv-abc' }))
      .rejects.toThrow(`${ERROR_MESSAGES.CONVERSATION_NOT_RESUMED} conv-abc`);
    expect(mockCacheResponse).not.toHaveBeenCalled();
  });

  it('checks a resume-by-id the same way as conversationId', async () => {
    mockExecuteCommand.mockResolvedValue(envelopeLine({ conversation_id: 'conv-other' }));

    await expect(executeAgyCLI('test', { outputFormat: 'json', resume: 'conv-abc' }))
      .rejects.toThrow(`${ERROR_MESSAGES.CONVERSATION_NOT_RESUMED} conv-abc`);
  });

  it('does not check the conversation for resume: true, which has no requested id', async () => {
    mockExecuteCommand.mockResolvedValue(envelopeLine({ conversation_id: 'conv-whatever' }));

    await expect(executeAgyCLI('test', { outputFormat: 'json', resume: true })).resolves.toBeTruthy();
  });

  it('caches a verified envelope', async () => {
    mockIsCacheEnabled.mockReturnValue(true);
    const raw = envelopeLine();
    mockExecuteCommand.mockResolvedValue(raw);

    await executeAgyCLI('test', { outputFormat: 'json' });

    expect(mockCacheResponse).toHaveBeenCalledWith('mock-cache-key', raw);
  });
});

describe('option validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCacheEnabled.mockReturnValue(false);
    mockExecuteCommand.mockResolvedValue(envelopeLine());
  });

  it.each([
    [{ outputFormat: 'stream-json' }, ERROR_MESSAGES.UNSUPPORTED_OUTPUT_FORMAT],
    [{ jsonSchema: '{}' }, ERROR_MESSAGES.JSON_SCHEMA_REQUIRES_JSON],
    [{ effort: 'extreme' }, ERROR_MESSAGES.INVALID_EFFORT],
    [{ changeMode: true, outputFormat: 'json' }, 'changeMode'],
    [{ conversationId: '  ' }, ERROR_MESSAGES.INVALID_CONVERSATION_ID],
  ])('rejects %s', async (options, message) => {
    await expect(executeAgyCLI('test', options as any)).rejects.toThrow(message);
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });

  it('passes --effort through untouched', async () => {
    await executeAgyCLI('test', { effort: 'medium' });

    const args = mockExecuteCommand.mock.calls[0][1];
    expect(args).toContain(CLI.FLAGS.EFFORT);
    expect(args).toContain('medium');
  });

  it('leaves text mode arguments unchanged when outputFormat is text', async () => {
    await executeAgyCLI('test', { outputFormat: 'text' });

    expect(mockExecuteCommand.mock.calls[0][1]).toEqual([
      CLI.FLAGS.MODEL, MODELS.DEFAULT, CLI.FLAGS.PRINT, 'test',
    ]);
  });
});

describe('conversation resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCacheEnabled.mockReturnValue(false);
    mockExecuteCommand.mockResolvedValue(envelopeLine());
  });

  it('prefers an explicit conversationId over resume', async () => {
    await executeAgyCLI('test', { conversationId: 'conv-abc', resume: true });

    const args = mockExecuteCommand.mock.calls[0][1];
    expect(args).toContain(CLI.FLAGS.CONVERSATION);
    expect(args).toContain('conv-abc');
    expect(args).not.toContain(CLI.FLAGS.CONTINUE);
  });

  it('hands the explicit conversation id to transcript recovery', async () => {
    mockExecuteCommand.mockResolvedValue('');
    mockRecover.mockReturnValue('RECOVERED');

    await executeAgyCLI('test', { conversationId: 'conv-abc' });

    expect(mockRecover).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-abc' }));
  });

  it.each([
    ['resume', { resume: true }],
    ['conversationId', { conversationId: 'conv-abc' }],
    ['noCache', { noCache: true }],
  ])('never touches the cache for %s', async (_label, options) => {
    mockIsCacheEnabled.mockReturnValue(true);

    await executeAgyCLI('test', options as any);

    expect(mockGetCachedResponse).not.toHaveBeenCalled();
    expect(mockCacheResponse).not.toHaveBeenCalled();
  });
});

describe('executeAgyJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCacheEnabled.mockReturnValue(false);
    mockExecuteCommand.mockResolvedValue(envelopeLine());
  });

  it('forces json output and returns the parsed envelope', async () => {
    const envelope = await executeAgyJson('test', { model: 'Gemini 3.8 Flash (Medium)' });

    const args = mockExecuteCommand.mock.calls[0][1];
    expect(args).toContain(CLI.FLAGS.OUTPUT_FORMAT);
    expect(envelope.conversation_id).toBe('conv-abc');
    expect(envelope.structured_output).toEqual({ ok: true });
  });
});

describe('parseAgyJsonEnvelope', () => {
  it('takes the last line that starts with {', () => {
    const stdout = `starting up\n{"status":"IGNORED"}\n${envelopeLine()}`;

    expect(parseAgyJsonEnvelope(stdout).conversation_id).toBe('conv-abc');
  });

  it('parses an envelope whose response contains a raw JSON block', () => {
    const stdout = JSON.stringify({
      conversation_id: 'conv-abc',
      status: 'SUCCESS',
      response: 'PLACEHOLDER',
    }).replace('"PLACEHOLDER"', '"Use this config:\n{\n  \\"a\\": 1\n}\nDone."');

    const envelope = parseAgyJsonEnvelope(stdout);

    expect(envelope.conversation_id).toBe('conv-abc');
    expect(envelope.response).toContain('"a": 1');
  });

  it('retries after escaping raw control characters inside strings', () => {
    const stdout = '{"conversation_id":"conv-abc","status":"SUCCESS","response":"line one\nline two"}';

    expect(parseAgyJsonEnvelope(stdout).response).toBe('line one\nline two');
  });

  it.each([
    ['an empty object', '{}'],
    ['an object with no status', '{"conversation_id":"conv-abc","response":"hi"}'],
    ['an unknown status', '{"conversation_id":"conv-abc","status":"PENDING"}'],
    ['a SUCCESS with no conversation id', '{"status":"SUCCESS","response":"hi"}'],
  ])('refuses %s as an envelope', (_label, stdout) => {
    expect(() => parseAgyJsonEnvelope(stdout)).toThrow(ERROR_MESSAGES.AGY_JSON_PARSE);
  });

  it('accepts an ERROR envelope that never got a conversation id', () => {
    const envelope = parseAgyJsonEnvelope('{"status":"ERROR","error":"invalid model selection"}');

    expect(envelope.error).toBe('invalid model selection');
  });

  it('throws AGY_JSON_PARSE with an excerpt when there is no envelope', () => {
    expect(() => parseAgyJsonEnvelope('total nonsense')).toThrow(ERROR_MESSAGES.AGY_JSON_PARSE);
    expect(() => parseAgyJsonEnvelope('total nonsense')).toThrow('total nonsense');
  });
});

describe('envelope rendering', () => {
  it('uses structured_output only when this call passed a schema', () => {
    const envelope = { response: 'plain answer', structured_output: { ok: true } };

    expect(renderAgyJsonEnvelope(envelope, { hadSchema: true })).toContain('"ok": true');
    expect(renderAgyJsonEnvelope(envelope)).toBe('plain answer');
  });

  it('summarizes denied actions', () => {
    expect(deniedActionsSummary({ denied_actions: [{ action: 'command', display_name: 'RunCommand' }] }))
      .toBe('RunCommand (command)');
    expect(deniedActionsSummary({})).toBe('');
  });

  it('formats the usage line and the conversation line', () => {
    expect(formatAgyUsageLine(ENVELOPE)).toContain('total 125');
    expect(formatConversationLine('conv-abc')).toBe('[GEMINI_CONVERSATION_ID=conv-abc]');
  });
});

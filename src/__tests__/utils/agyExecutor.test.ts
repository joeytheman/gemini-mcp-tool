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

import { executeAgyCLI, processChangeModeOutput } from '../../utils/agyExecutor.js';
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
    it('should use agy with the default Gemini 3.5 Flash model and print mode', async () => {
      await executeAgyCLI('test', {});

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        CLI.COMMANDS.AGY,
        [CLI.FLAGS.MODEL, MODELS.DEFAULT, CLI.FLAGS.PRINT, 'test'],
        undefined,
        undefined
      );
    });

    it('should add model flag when specified', async () => {
      await executeAgyCLI('test', { model: 'Gemini 3.5 Flash (High)' });

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.MODEL);
      expect(args).toContain('Gemini 3.5 Flash (High)');
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
      await executeAgyCLI('test', 'Gemini 3.5 Flash (Low)');

      const args = mockExecuteCommand.mock.calls[0][1];
      expect(args).toContain(CLI.FLAGS.MODEL);
      expect(args).toContain('Gemini 3.5 Flash (Low)');
    });
  });

  describe('unsupported legacy Gemini CLI options', () => {
    it.each([
      [{ debug: true }, 'debug'],
      [{ outputFormat: 'json' }, 'outputFormat'],
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

      await expect(executeAgyCLI('test', { model: 'Gemini 3.5 Flash (Medium)' }))
        .rejects.toThrow('RESOURCE_EXHAUSTED');

      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it('should return install guidance when agy is missing', async () => {
      mockExecuteCommand.mockRejectedValueOnce(new Error('Failed to spawn command: ENOENT'));

      await expect(executeAgyCLI('test', {})).rejects.toThrow(ERROR_MESSAGES.AGY_NOT_FOUND);
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteAgyCLI = vi.fn();
const mockExecuteAgyJson = vi.fn();
vi.mock('../utils/agyExecutor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/agyExecutor.js')>();
  return {
    ...actual,
    executeAgyCLI: (...args: any[]) => mockExecuteAgyCLI(...args),
    executeAgyJson: (...args: any[]) => mockExecuteAgyJson(...args),
  };
});

import { askGeminiArgsSchema, askGeminiTool } from '../tools/ask-gemini.tool.js';

describe('ask-gemini Tool', () => {
  describe('Argument Schema Validation', () => {
    it('should accept valid minimal arguments', () => {
      const result = askGeminiArgsSchema.parse({ prompt: 'test prompt' });
      expect(result.prompt).toBe('test prompt');
      expect(result.sandbox).toBe(false);
      expect(result.changeMode).toBe(false);
    });

    it('should accept supported agy optional flags', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test prompt',
        model: 'Gemini 3.8 Flash (Medium)',
        sandbox: true,
        changeMode: true,
        yolo: true,
        includeDirectories: ['src', 'tests'],
        printTimeout: '10m',
        resume: true,
        workingDirectory: '/tmp/project',
      });

      expect(result.model).toBe('Gemini 3.8 Flash (Medium)');
      expect(result.sandbox).toBe(true);
      expect(result.changeMode).toBe(true);
      expect(result.yolo).toBe(true);
      expect(result.includeDirectories).toEqual(['src', 'tests']);
      expect(result.printTimeout).toBe('10m');
      expect(result.resume).toBe(true);
      expect(result.workingDirectory).toBe('/tmp/project');
    });

    it('should accept legacy fields so implementation can return explicit unsupported errors', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test prompt',
        approvalMode: 'auto_edit',
        outputFormat: 'json',
        debug: true,
        extensions: ['ts', 'js'],
        promptInteractive: 'continue after this',
      });

      expect(result.approvalMode).toBe('auto_edit');
      expect(result.outputFormat).toBe('json');
      expect(result.debug).toBe(true);
      expect(result.extensions).toEqual(['ts', 'js']);
      expect(result.promptInteractive).toBe('continue after this');
    });

    it('should reject missing prompt', () => {
      expect(() => askGeminiArgsSchema.parse({})).toThrow();
    });

    it('should reject empty prompt', () => {
      expect(() => askGeminiArgsSchema.parse({ prompt: '' })).toThrow();
    });

    it('should reject invalid approval mode', () => {
      expect(() =>
        askGeminiArgsSchema.parse({
          prompt: 'test',
          approvalMode: 'invalid',
        })
      ).toThrow();
    });

    it('should reject invalid output format', () => {
      expect(() =>
        askGeminiArgsSchema.parse({
          prompt: 'test',
          outputFormat: 'invalid',
        })
      ).toThrow();
    });

    it('should accept includeDirectories as string', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        includeDirectories: 'src,tests',
      });
      expect(result.includeDirectories).toBe('src,tests');
    });

    it('should accept includeDirectories as array', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        includeDirectories: ['src', 'tests'],
      });
      expect(result.includeDirectories).toEqual(['src', 'tests']);
    });

    it('should accept extensions as string', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        extensions: 'ts,js',
      });
      expect(result.extensions).toBe('ts,js');
    });

    it('should accept extensions as array', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        extensions: ['ts', 'js'],
      });
      expect(result.extensions).toEqual(['ts', 'js']);
    });

    it('should accept the json envelope arguments', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        outputFormat: 'json',
        jsonSchema: '{"type":"object"}',
        effort: 'medium',
        conversationId: 'conv-abc',
      });

      expect(result.outputFormat).toBe('json');
      expect(result.jsonSchema).toBe('{"type":"object"}');
      expect(result.effort).toBe('medium');
      expect(result.conversationId).toBe('conv-abc');
    });

    it('should reject an effort level agy does not accept', () => {
      expect(() => askGeminiArgsSchema.parse({ prompt: 'test', effort: 'extreme' })).toThrow();
    });

    it('should accept resume parameter', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        resume: 'latest',
      });
      expect(result.resume).toBe('latest');
    });

    it('should accept boolean resume parameter', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        resume: true,
      });
      expect(result.resume).toBe(true);
    });

    it('should accept chunkIndex as number', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        chunkIndex: 1,
      });
      expect(result.chunkIndex).toBe(1);
    });

    it('should accept chunkIndex as string', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        chunkIndex: '1',
      });
      expect(result.chunkIndex).toBe('1');
    });
  });

  describe('Flag Combinations', () => {
    it('should allow sandbox with yolo', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        sandbox: true,
        yolo: true,
      });
      expect(result.sandbox).toBe(true);
      expect(result.yolo).toBe(true);
    });

    it('should allow legacy approvalMode through schema for executor validation', () => {
      const result = askGeminiArgsSchema.parse({
        prompt: 'test',
        yolo: true,
        approvalMode: 'auto_edit',
      });
      expect(result.yolo).toBe(true);
      expect(result.approvalMode).toBe('auto_edit');
    });
  });

  describe('json output', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockExecuteAgyJson.mockResolvedValue({
        conversation_id: 'conv-abc',
        status: 'SUCCESS',
        response: 'plain answer',
        structured_output: { ok: true },
        num_turns: 1,
        duration_seconds: 3,
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      });
    });

    it('starts with the conversation line and renders structured output under a schema', async () => {
      const result = await askGeminiTool.execute({
        prompt: 'Return ok true',
        outputFormat: 'json',
        jsonSchema: '{"type":"object"}',
        conversationId: 'conv-abc',
      });

      expect(result.startsWith('[GEMINI_CONVERSATION_ID=conv-abc]')).toBe(true);
      expect(result).toContain('"ok": true');
      expect(result).toContain('Usage:');
      expect(mockExecuteAgyJson).toHaveBeenCalledWith(
        'Return ok true',
        expect.objectContaining({ conversationId: 'conv-abc', jsonSchema: '{"type":"object"}' }),
        undefined
      );
      expect(mockExecuteAgyCLI).not.toHaveBeenCalled();
    });

    it('renders the plain response when no schema was passed', async () => {
      const result = await askGeminiTool.execute({ prompt: 'hi', outputFormat: 'json' });

      expect(result).toContain('plain answer');
      expect(result).not.toContain('"ok"');
    });

    it('uses the text path for the default output format', async () => {
      mockExecuteAgyCLI.mockResolvedValue('text answer');

      const result = await askGeminiTool.execute({ prompt: 'hi' });

      expect(result).toContain('text answer');
      expect(mockExecuteAgyJson).not.toHaveBeenCalled();
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error for missing prompt', () => {
      try {
        askGeminiArgsSchema.parse({});
      } catch (error: any) {
        expect(error.issues[0].path).toContain('prompt');
        expect(error.issues[0].message).toMatch(/required|expected string/i);
      }
    });

    it('should provide clear error for empty prompt', () => {
      try {
        askGeminiArgsSchema.parse({ prompt: '' });
      } catch (error: any) {
        expect(error.issues[0].path).toContain('prompt');
        expect(error.issues[0].message).toMatch(/at least 1|>=1/i);
      }
    });
  });
});

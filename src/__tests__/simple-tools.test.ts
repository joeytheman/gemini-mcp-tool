import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteCommand = vi.fn();
vi.mock('../utils/commandExecutor.js', () => ({
  executeCommand: (...args: any[]) => mockExecuteCommand(...args),
}));

import { helpTool, pingTool } from '../tools/simple-tools.js';
import { AGY_LIMITS } from '../constants.js';

describe('simple tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteCommand.mockResolvedValue('help output');
  });

  it('Help should call agy help under the default ceiling and the request signal', async () => {
    const controller = new AbortController();

    const result = await helpTool.execute({}, undefined, controller.signal);

    expect(result).toBe('help output');
    expect(mockExecuteCommand).toHaveBeenCalledWith('agy', ['--help'], undefined, undefined, {
      killAfterMs: AGY_LIMITS.DEFAULT_CEILING_MS,
      signal: controller.signal,
    });
  });

  it('ping should return directly without spawning a shell command', async () => {
    const onProgress = vi.fn();

    const result = await pingTool.execute({ prompt: 'hello' }, onProgress);

    expect(result).toBe('hello');
    expect(onProgress).toHaveBeenCalledWith('hello');
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});

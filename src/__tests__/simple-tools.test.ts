import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteCommand = vi.fn();
vi.mock('../utils/commandExecutor.js', () => ({
  executeCommand: (...args: any[]) => mockExecuteCommand(...args),
}));

import { helpTool, pingTool } from '../tools/simple-tools.js';

describe('simple tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteCommand.mockResolvedValue('help output');
  });

  it('Help should call agy help', async () => {
    const result = await helpTool.execute({});

    expect(result).toBe('help output');
    expect(mockExecuteCommand).toHaveBeenCalledWith('agy', ['--help'], undefined);
  });

  it('ping should return directly without spawning a shell command', async () => {
    const onProgress = vi.fn();

    const result = await pingTool.execute({ prompt: 'hello' }, onProgress);

    expect(result).toBe('hello');
    expect(onProgress).toHaveBeenCalledWith('hello');
    expect(mockExecuteCommand).not.toHaveBeenCalled();
  });
});

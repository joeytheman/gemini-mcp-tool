import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock logger to suppress output
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

// Create a mock spawn that returns controllable process objects
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Import after mocks are set up
import { executeCommand } from '../../utils/commandExecutor.js';
import { AGY_LIMITS, ERROR_MESSAGES } from '../../constants.js';

function createMockChildProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout.destroy = vi.fn();
  proc.stderr.destroy = vi.fn();
  proc.kill = vi.fn();
  return proc;
}

describe('executeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return trimmed stdout on success', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('echo', ['hello']);

    // Simulate stdout data and successful close
    mockProc.stdout.emit('data', '  hello world  ');
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result).toBe('hello world');
  });

  it('should reject with error message on non-zero exit code', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('failing-cmd', []);

    mockProc.stderr.emit('data', 'something went wrong');
    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow('Command failed with exit code 1: something went wrong');
  });

  it('should reject with descriptive error on process error event', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('nonexistent', []);

    mockProc.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('Failed to spawn command: ENOENT');
  });

  it('should call onProgress with each stdout chunk', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const progressFn = vi.fn();
    const promise = executeCommand('cmd', [], progressFn);

    mockProc.stdout.emit('data', 'chunk1');
    mockProc.stdout.emit('data', 'chunk2');
    mockProc.emit('close', 0);

    await promise;

    expect(progressFn).toHaveBeenCalledTimes(2);
    expect(progressFn).toHaveBeenCalledWith('chunk1');
    expect(progressFn).toHaveBeenCalledWith('chunk2');
  });

  it('should handle Buffer data from stdout', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('cmd', []);

    mockProc.stdout.emit('data', Buffer.from('buffer data'));
    mockProc.emit('close', 0);

    const result = await promise;
    expect(result).toBe('buffer data');
  });

  it('should log RESOURCE_EXHAUSTED from stderr', async () => {
    const { Logger } = await import('../../utils/logger.js');
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', ['--print', 'test']);

    mockProc.stderr.emit('data', 'RESOURCE_EXHAUSTED: Quota exceeded');
    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow();
    expect(Logger.error).toHaveBeenCalled();
  });

  it('should reject when stderr reports RESOURCE_EXHAUSTED even on exit code 0', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', ['--print', 'test']);

    mockProc.stderr.emit('data', 'RESOURCE_EXHAUSTED: Quota exceeded');
    mockProc.emit('close', 0);

    await expect(promise).rejects.toThrow('RESOURCE_EXHAUSTED');
  });

  it('should reject with "Unknown error" when stderr is empty', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('cmd', []);

    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow('Command failed with exit code 1: Unknown error');
  });

  it('should only resolve once even if close fires after error', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('cmd', []);

    mockProc.emit('error', new Error('process error'));
    // Close event after error should be ignored
    mockProc.emit('close', 0);

    await expect(promise).rejects.toThrow('Failed to spawn command: process error');
  });

  it('should pass correct args to spawn', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', ['--model', 'Gemini 3.8 Flash (Medium)', '--print', 'test']);

    mockProc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('agy', ['--model', 'Gemini 3.8 Flash (Medium)', '--print', 'test'], {
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('should pass cwd to spawn when provided', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', ['--print', 'test'], undefined, '/some/dir');

    mockProc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('agy', ['--print', 'test'], {
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: '/some/dir',
    });
  });

  it('should not include cwd in spawn options when undefined', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', ['--print', 'test']);

    mockProc.emit('close', 0);
    await promise;

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions).not.toHaveProperty('cwd');
  });

  it('should never use shell spawning, including on Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      const promise = executeCommand('agy', ['--print', 'hello & goodbye']);

      mockProc.emit('close', 0);
      await promise;

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.shell).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('executeCommand limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(process.platform === 'win32')('waits for close after SIGTERM before reporting a timed-out call', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
    let settled = false;
    void promise.then(() => { settled = true; }, () => { settled = true; });
    vi.advanceTimersByTime(5000);

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProc.kill).not.toHaveBeenCalledWith('SIGKILL');
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(`${ERROR_MESSAGES.AGY_HUNG}: limit 5s`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('sends SIGKILL after the grace period when the process ignores SIGTERM', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
    vi.advanceTimersByTime(5000 + AGY_LIMITS.KILL_GRACE_MS);

    expect(mockProc.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
  });

  it.skipIf(process.platform === 'win32')('escalates when agy exited but a descendant still holds its output pipe', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
    vi.advanceTimersByTime(5000);
    mockProc.emit('exit', null, 'SIGTERM');
    vi.advanceTimersByTime(AGY_LIMITS.KILL_GRACE_MS);

    expect(mockProc.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
  });

  it('bounds the close wait after SIGKILL when a descendant holds the output pipes', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
    vi.advanceTimersByTime(5000 + AGY_LIMITS.KILL_GRACE_MS + AGY_LIMITS.KILL_CLOSE_WAIT_MS);

    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
    expect(mockProc.stdout.destroy).toHaveBeenCalled();
    expect(mockProc.stderr.destroy).toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('signals the isolated POSIX process group, including descendants', async () => {
    const mockProc = createMockChildProcess();
    mockProc.pid = 12345;
    mockSpawn.mockReturnValue(mockProc);
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    try {
      const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
      expect(mockSpawn.mock.calls[0][2].detached).toBe(true);
      vi.advanceTimersByTime(5000);
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      mockProc.emit('close', null);
      await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');
    } finally {
      killSpy.mockRestore();
    }
  });

  it('uses taskkill for the Windows process tree before the parent can exit', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockChildProcess();
    mockProc.pid = 12345;
    const killer = new EventEmitter();
    mockSpawn.mockReturnValueOnce(mockProc).mockReturnValueOnce(killer);

    try {
      const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
      vi.advanceTimersByTime(5000);
      expect(mockSpawn).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      mockProc.emit('close', null);
      await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('never stops a run that finished before its limit, and leaves no timer behind', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 5000 });
    mockProc.stdout.emit('data', 'done');
    mockProc.emit('close', 0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000 + AGY_LIMITS.KILL_GRACE_MS);

    await expect(promise).resolves.toBe('done');
    expect(mockProc.kill).not.toHaveBeenCalled();
  });

  it('rearms a timer beyond Node\'s maximum without shortening the requested limit', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = executeCommand('agy', [], undefined, undefined, { killAfterMs: 600 * 60 * 60_000 });
    const limitMs = 600 * 60 * 60_000;
    vi.advanceTimersByTime(2 ** 31 - 1);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2 ** 31 - 1);
    expect(mockProc.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(limitMs - (2 ** 31 - 1) - 1);
    expect(mockProc.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mockProc.kill).toHaveBeenCalledWith(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_HUNG);
    setTimeoutSpy.mockRestore();
  });

  it('sends SIGTERM and rejects AGY_CANCELLED when the request is cancelled', async () => {
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    const controller = new AbortController();

    const promise = executeCommand('agy', [], undefined, undefined, { signal: controller.signal });
    controller.abort();

    expect(mockProc.kill).toHaveBeenCalledWith(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_CANCELLED);
  });

  it('notices a cancellation that happens during spawn', async () => {
    const controller = new AbortController();
    const mockProc = createMockChildProcess();
    mockSpawn.mockImplementation(() => {
      controller.abort();
      return mockProc;
    });

    const promise = executeCommand('agy', [], undefined, undefined, { signal: controller.signal });
    expect(mockProc.kill).toHaveBeenCalledWith(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM');
    mockProc.emit('close', null);
    await expect(promise).rejects.toThrow(ERROR_MESSAGES.AGY_CANCELLED);
  });

  it('never spawns when the request was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(executeCommand('agy', [], undefined, undefined, { signal: controller.signal }))
      .rejects.toThrow(ERROR_MESSAGES.AGY_CANCELLED);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

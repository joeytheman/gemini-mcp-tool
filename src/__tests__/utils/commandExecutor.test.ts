import { describe, it, expect, vi, beforeEach } from 'vitest';
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

function createMockChildProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
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

    const promise = executeCommand('gemini', ['-p', 'test']);

    mockProc.stderr.emit('data', 'RESOURCE_EXHAUSTED: Quota exceeded');
    mockProc.emit('close', 1);

    await expect(promise).rejects.toThrow();
    expect(Logger.error).toHaveBeenCalled();
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

    const promise = executeCommand('gemini', ['-m', 'pro', '-p', 'test']);

    mockProc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('gemini', ['-m', 'pro', '-p', 'test'], {
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });
});

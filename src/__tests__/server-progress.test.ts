import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ProgressNotification } from '@modelcontextprotocol/sdk/types.js';
import { PROTOCOL } from '../constants.js';

const transports = vi.hoisted(() => ({ client: undefined as unknown as InMemoryTransport }));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', async () => {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const [client, server] = InMemoryTransport.createLinkedPair();
  transports.client = client;
  return { StdioServerTransport: function () { return server; } };
});

vi.mock('../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    toolInvocation: vi.fn(),
    commandExecution: vi.fn(),
    commandComplete: vi.fn(),
  },
}));

describe('progress notifications through the MCP SDK', () => {
  const progressSent: ProgressNotification['params'][] = [];
  let client: Client;

  beforeAll(async () => {
    await import('../index.js');
    client = new Client({ name: 'progress-test', version: '0.0.0' });
    await client.connect(transports.client);

    const deliver = transports.client.onmessage!;
    transports.client.onmessage = (message, extra) => {
      if ('method' in message && message.method === PROTOCOL.NOTIFICATIONS.PROGRESS) {
        progressSent.push(message.params as ProgressNotification['params']);
      }
      deliver(message, extra);
    };
  });

  afterEach(() => {
    progressSent.length = 0;
    vi.useRealTimers();
  });

  it('sends a start and a final notification for a call that completes', async () => {
    const result = await client.callTool({ name: 'ping', arguments: { prompt: 'hi' } }, undefined, { onprogress: () => {} });

    expect(result.isError).toBe(false);
    expect(progressSent.map(({ progress, total, message }) => ({ progress, total, message }))).toEqual([
      { progress: 0, total: undefined, message: '🔍 Starting ping' },
      { progress: 1, total: 1, message: '✅ ping completed successfully' },
    ]);
  });

  it('sends no progress after the client cancels, while the tool keeps running to completion', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const call = client.callTool(
      { name: 'timeout-test', arguments: { duration: PROTOCOL.KEEPALIVE_INTERVAL * 4 } },
      undefined,
      { onprogress: () => {}, signal: controller.signal }
    );
    const cancelled = call.then(() => 'resolved', () => 'rejected');
    await vi.advanceTimersByTimeAsync(PROTOCOL.KEEPALIVE_INTERVAL);
    expect(progressSent.map(({ progress }) => progress)).toEqual([0, 1]);

    controller.abort();
    await vi.advanceTimersByTimeAsync(PROTOCOL.KEEPALIVE_INTERVAL * 4);

    expect(await cancelled).toBe('rejected');
    expect(vi.getTimerCount()).toBe(0);
    expect(progressSent.map(({ progress }) => progress)).toEqual([0, 1]);
  });
});

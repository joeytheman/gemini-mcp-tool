import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startProgressUpdates } from '../../utils/progressUpdates.js';
import { PROTOCOL } from '../../constants.js';

describe('startProgressUpdates', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function callsFor(token: string) {
    return send.mock.calls.filter(([progressToken]) => progressToken === token);
  }

  it('keeps sending keep-alives for a call after another call in the same server finishes', () => {
    const first = startProgressUpdates('live-pass', 'tok-first', send);
    startProgressUpdates('screen-review', 'tok-second', send);
    first.finish('success');
    send.mockClear();

    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL);

    expect(callsFor('tok-first')).toEqual([]);
    expect(callsFor('tok-second')).toEqual([
      ['tok-second', 1, undefined, expect.stringContaining('screen-review')],
    ]);
  });

  it('shows each call only its own output preview', () => {
    const first = startProgressUpdates('ask-gemini', 'tok-first', send);
    const second = startProgressUpdates('brainstorm', 'tok-second', send);
    first.recordOutput('alpha output');
    second.recordOutput('beta output');

    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL);

    const [firstTick] = callsFor('tok-first').slice(-1);
    const [secondTick] = callsFor('tok-second').slice(-1);
    expect(firstTick[3]).toContain('alpha output');
    expect(firstTick[3]).not.toContain('beta output');
    expect(secondTick[3]).toContain('beta output');
  });

  it('sends a final notification for a finished or failed call', () => {
    startProgressUpdates('ask-gemini', 'tok-ok', send).finish('success');
    startProgressUpdates('ask-gemini', 'tok-failed', send).finish('failure');

    expect(callsFor('tok-ok').slice(-1)).toEqual([['tok-ok', 100, 100, '✅ ask-gemini completed successfully']]);
    expect(callsFor('tok-failed').slice(-1)).toEqual([['tok-failed', 100, 100, '❌ ask-gemini failed']]);
  });

  it('stops every notification the moment the request is cancelled, while the tool still runs', () => {
    const controller = new AbortController();
    const updates = startProgressUpdates('timeout-test', 'tok-cancelled', send, controller.signal);
    send.mockClear();

    controller.abort();
    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL * 3);
    updates.finish('success');

    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends nothing for a request that was cancelled before the call started', () => {
    const controller = new AbortController();
    controller.abort();

    const updates = startProgressUpdates('ask-gemini', 'tok-early', send, controller.signal);
    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL);
    updates.finish('failure');

    expect(send).not.toHaveBeenCalled();
  });

  it('stops listening for a cancel once the call finishes', () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    startProgressUpdates('ask-gemini', 'tok-done', send, controller.signal).finish('success');

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('sends nothing when the client asked for no progress', () => {
    const updates = startProgressUpdates('ask-gemini', undefined, send);
    updates.recordOutput('ignored');
    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL);
    updates.finish('success');

    expect(send).not.toHaveBeenCalled();
  });
});

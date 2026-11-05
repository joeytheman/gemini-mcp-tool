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

    expect(callsFor('tok-ok').slice(-1)).toEqual([['tok-ok', 1, 1, '✅ ask-gemini completed successfully']]);
    expect(callsFor('tok-failed').slice(-1)).toEqual([['tok-failed', 1, 1, '❌ ask-gemini failed']]);
  });

  it('ends above the last keep-alive on a call that outlasts 100 keep-alives', () => {
    const updates = startProgressUpdates('live-pass', 'tok-long', send);
    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL * 101);

    updates.finish('success');

    const calls = callsFor('tok-long');
    expect(calls.map(([, progress]) => progress)).toEqual(Array.from({ length: 103 }, (_, index) => index));
    expect(calls.at(-1)).toEqual(['tok-long', 102, 102, '✅ live-pass completed successfully']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends nothing when the client asked for no progress', () => {
    const updates = startProgressUpdates('ask-gemini', undefined, send);
    updates.recordOutput('ignored');
    vi.advanceTimersByTime(PROTOCOL.KEEPALIVE_INTERVAL);
    updates.finish('success');

    expect(send).not.toHaveBeenCalled();
  });
});

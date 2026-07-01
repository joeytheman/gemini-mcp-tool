import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const stats = new Map<string, { mtimeMs: number }>();

vi.mock('os', () => ({
  homedir: () => '/home/test',
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((p: string) => {
    if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
    return store.get(p);
  }),
  statSync: vi.fn((p: string) => {
    if (!stats.has(p)) throw new Error(`ENOENT: ${p}`);
    return stats.get(p);
  }),
  realpathSync: vi.fn((p: string) => p),
}));

vi.mock('../../utils/logger.js', () => ({
  Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}));

import { recoverFromTranscript, isRecoverableEmptyOutput } from '../../utils/agyTranscriptRecovery.js';
import { AGY_INTERNAL } from '../../constants.js';

const ROOT = '/home/test/.gemini/antigravity-cli';
const MAP_PATH = `${ROOT}/cache/last_conversations.json`;
const RUN_START = 1_700_000_000_000;
const FRESH = new Date(RUN_START + 3000).toISOString();
const STALE = new Date(RUN_START - 600_000).toISOString();

function transcriptPath(id: string): string {
  return `${ROOT}/brain/${id}/.system_generated/logs/transcript.jsonl`;
}

function setMap(map: Record<string, string>) {
  store.set(MAP_PATH, JSON.stringify(map));
  stats.set(MAP_PATH, { mtimeMs: RUN_START });
}

function setTranscript(id: string, lines: object[]) {
  const p = transcriptPath(id);
  store.set(p, lines.map((l) => JSON.stringify(l)).join('\n'));
  stats.set(p, { mtimeMs: RUN_START + 3000 });
}

function finalResponse(content: unknown, created_at = FRESH) {
  return { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at, content };
}

describe('isRecoverableEmptyOutput', () => {
  it('is true for empty / whitespace / the timeout sentinel only', () => {
    expect(isRecoverableEmptyOutput('')).toBe(true);
    expect(isRecoverableEmptyOutput('   \n ')).toBe(true);
    expect(isRecoverableEmptyOutput(AGY_INTERNAL.TIMEOUT_SENTINEL)).toBe(true);
    expect(isRecoverableEmptyOutput('a real answer')).toBe(false);
  });
});

describe('recoverFromTranscript', () => {
  beforeEach(() => {
    store.clear();
    stats.clear();
    delete process.env[AGY_INTERNAL.DISABLE_RECOVERY_ENV];
  });

  it('returns the last final response content keyed by cwd', () => {
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [
      { source: 'MODEL', type: 'VIEW_FILE', status: 'DONE', content: 'noise' },
      finalResponse('ANSWER'),
    ]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBe('ANSWER');
  });

  it('unwraps a nested {content} JSON payload', () => {
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [finalResponse(JSON.stringify({ type: 'message', content: 'INNER' }))]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBe('INNER');
  });

  it('falls back to the raw string when nested JSON is malformed', () => {
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [finalResponse('{"content": brokenjson')]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBe('{"content": brokenjson');
  });

  it('returns the LAST final response when several exist', () => {
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [finalResponse('FIRST'), finalResponse('LAST')]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBe('LAST');
  });

  it('returns null when cwd is not in the map (no cross-conversation leakage)', () => {
    setMap({ '/other': 'conv1' });
    setTranscript('conv1', [finalResponse('NOT YOURS')]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBeNull();
  });

  it('treats a response that predates the run as stale', () => {
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [finalResponse('OLD', STALE)]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBeNull();
  });

  it('returns null when recovery is disabled via env', () => {
    process.env[AGY_INTERNAL.DISABLE_RECOVERY_ENV] = 'true';
    setMap({ '/proj': 'conv1' });
    setTranscript('conv1', [finalResponse('ANSWER')]);
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBeNull();
  });

  it('never throws when the map or transcript is missing', () => {
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBeNull(); // no map
    setMap({ '/proj': 'conv1' }); // map present, transcript absent
    expect(recoverFromTranscript({ cwd: '/proj', runStartMs: RUN_START })).toBeNull();
  });
});

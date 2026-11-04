import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { agyConversationStore, countAgyModelSteps, formatModelSteps } from '../utils/agyModelSteps.js';

const CONVERSATION = '6a157307-cd13-4652-8725-f3500c103f2b';
const roots: string[] = [];

function storeWithSteps(stepTypes: number[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-steps-'));
  roots.push(root);
  const store = agyConversationStore(CONVERSATION, root);
  fs.mkdirSync(path.dirname(store), { recursive: true });
  const rows = stepTypes.map((type, idx) => `insert into steps (idx, step_type) values (${idx}, ${type});`).join('');
  execFileSync('sqlite3', [store, `pragma journal_mode=wal;create table steps (idx integer primary key, step_type integer not null default 0);${rows}pragma wal_checkpoint(truncate);`]);
  for (const side of ['-wal', '-shm']) fs.rmSync(`${store}${side}`, { force: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('countAgyModelSteps', () => {
  it("counts only agy's model steps (step_type 15), not the user turn or tool results", async () => {
    const root = storeWithSteps([14, 15, 132, 15, 132, 15]);
    await expect(countAgyModelSteps(CONVERSATION, root)).resolves.toBe(3);
  });

  it("reads agy's write-ahead-log store without leaving side files next to it", async () => {
    const root = storeWithSteps([15, 15]);
    const store = agyConversationStore(CONVERSATION, root);

    await expect(countAgyModelSteps(CONVERSATION, root)).resolves.toBe(2);

    expect(fs.readdirSync(path.dirname(store))).toEqual([path.basename(store)]);
  });

  it('is null when the conversation has no step store', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-steps-'));
    roots.push(root);
    await expect(countAgyModelSteps(CONVERSATION, root)).resolves.toBeNull();
  });

  it('is null for a conversation id that is not a uuid, without touching the filesystem', async () => {
    await expect(countAgyModelSteps('../../etc/passwd')).resolves.toBeNull();
  });
});

describe('formatModelSteps', () => {
  it('divides the steps by the reported frames, to one decimal', () => {
    expect(formatModelSteps(81, 6)).toBe('Gemini steps: 81 (13.5 per frame, 6 frames)');
  });

  it('says so when no frame was reported', () => {
    expect(formatModelSteps(12, 0)).toBe('Gemini steps: 12, no frames');
  });

  it('prints the bare count for a review, which has no frames', () => {
    expect(formatModelSteps(9)).toBe('Gemini steps: 9');
  });

  it("marks an unreadable step store with ?", () => {
    expect(formatModelSteps(null, 3)).toBe("Gemini steps: ? (agy's step store was unreadable)");
  });
});

import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { AGY_INTERNAL } from '../constants.js';

const execFileAsync = promisify(execFile);

export function agyConversationStore(conversationId: string, root = path.join(os.homedir(), ...AGY_INTERNAL.ROOT_SEGMENTS)): string {
  return path.join(root, AGY_INTERNAL.CONVERSATIONS_DIR, `${conversationId}${AGY_INTERNAL.CONVERSATION_STORE_EXT}`);
}

/** How many model steps Gemini took in a conversation, or null when agy's step store can't be read. */
export async function countAgyModelSteps(conversationId: string, root?: string): Promise<number | null> {
  if (!/^[0-9a-f-]+$/i.test(conversationId)) return null;
  try {
    const { stdout } = await execFileAsync(
      'sqlite3',
      [`file:${encodeURI(agyConversationStore(conversationId, root))}?immutable=1`, `select count(*) from steps where step_type = ${AGY_INTERNAL.MODEL_STEP_TYPE};`],
      { timeout: 10_000 },
    );
    const count = Number.parseInt(stdout.trim(), 10);
    return Number.isNaN(count) ? null : count;
  } catch {
    return null;
  }
}

export function formatModelSteps(steps: number | null, frameCount?: number): string {
  if (steps === null) return "Gemini steps: ? (agy's step store was unreadable)";
  if (frameCount === undefined) return `Gemini steps: ${steps}`;
  if (frameCount === 0) return `Gemini steps: ${steps}, no frames`;
  const perFrame = Math.round((steps / frameCount) * 10) / 10;
  return `Gemini steps: ${steps} (${perFrame} per frame, ${frameCount} frame${frameCount === 1 ? '' : 's'})`;
}

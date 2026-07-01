import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger.js';
import { AGY_INTERNAL } from '../constants.js';

/**
 * Best-effort recovery of an agy response from its on-disk transcript.
 *
 * `agy --print` sometimes exits 0 having printed nothing (empty stdout) or only
 * `Error: timed out waiting for response`, even though the model DID produce an
 * answer — that answer is written to the conversation transcript. This module
 * recovers it, keyed deterministically by working directory.
 *
 * FRAGILE: depends entirely on undocumented agy 1.0.13 internals (see
 * AGY_INTERNAL). Every access degrades to `null` on any mismatch — it must
 * never throw, and it must never return another conversation's answer.
 */

// Allow a small slack between the transcript record's second-precision
// timestamp and our millisecond run-start clock.
const FRESHNESS_TOLERANCE_MS = 2000;

interface TranscriptRecord {
  type?: string;
  source?: string;
  status?: string;
  created_at?: string;
  content?: unknown;
}

/** Output that should trigger transcript recovery: empty or the timeout sentinel. */
export function isRecoverableEmptyOutput(stdout: string): boolean {
  const trimmed = stdout.trim();
  return trimmed === '' || trimmed === AGY_INTERNAL.TIMEOUT_SENTINEL;
}

function recoveryDisabled(): boolean {
  return process.env[AGY_INTERNAL.DISABLE_RECOVERY_ENV] === 'true';
}

function agyRoot(): string {
  return path.join(os.homedir(), ...AGY_INTERNAL.ROOT_SEGMENTS);
}

/** Candidate forms of cwd to match against last_conversations.json keys. */
function cwdLookupKeys(cwd: string): string[] {
  const keys = new Set<string>([cwd]);
  try { keys.add(path.resolve(cwd)); } catch {}
  try { keys.add(fs.realpathSync(cwd)); } catch {}
  return [...keys];
}

function lookupConversationId(cwd: string): string | null {
  const mapPath = path.join(agyRoot(), ...AGY_INTERNAL.LAST_CONVERSATIONS_SEGMENTS);
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as Record<string, string>;
  for (const key of cwdLookupKeys(cwd)) {
    if (typeof map[key] === 'string') return map[key];
  }
  return null;
}

/** Unwrap a record's `content`, falling back to the raw string if it is not the nested JSON form. */
function unwrapContent(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).content === 'string') {
      const inner = (parsed as any).content.trim();
      return inner || null;
    }
  } catch {
    // Not the nested JSON form — use the raw string.
  }
  return trimmed;
}

function isFinalResponse(rec: TranscriptRecord): boolean {
  const f = AGY_INTERNAL.TRANSCRIPT_FINAL;
  return rec.type === f.type && rec.source === f.source && rec.status === f.status;
}

function readLastResponse(transcriptPath: string, runStartMs: number): string | null {
  // readFileSync throws (-> caller returns null) when the transcript is missing.
  const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');

  let last: TranscriptRecord | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: TranscriptRecord;
    try {
      rec = JSON.parse(line) as TranscriptRecord;
    } catch {
      continue;
    }
    if (isFinalResponse(rec)) last = rec;
  }
  if (!last) return null;

  // Freshness: prefer the record's own timestamp; fall back to the file mtime
  // (only stat'd when the record has no usable timestamp).
  const createdMs = last.created_at ? Date.parse(last.created_at) : NaN;
  const effectiveMs = Number.isNaN(createdMs) ? fs.statSync(transcriptPath).mtimeMs : createdMs;
  if (effectiveMs < runStartMs - FRESHNESS_TOLERANCE_MS) {
    Logger.debug('[recovery] last transcript response predates this run; treating as stale');
    return null;
  }

  return unwrapContent(last.content);
}

/**
 * Recover the latest model response for `cwd` if it was produced after
 * `runStartMs`. Returns the recovered text, or `null` if recovery is disabled,
 * the cwd has no known conversation, the transcript is stale/missing, or any
 * access fails. There is intentionally NO global "newest transcript" fallback —
 * that could return another project's or session's answer.
 */
export function recoverFromTranscript(opts: { cwd?: string; runStartMs: number }): string | null {
  if (recoveryDisabled()) return null;

  const cwd = opts.cwd || process.cwd();
  try {
    const id = lookupConversationId(cwd);
    if (!id) {
      Logger.debug(`[recovery] no conversation mapped for cwd ${cwd}`);
      return null;
    }
    const transcriptPath = path.join(agyRoot(), AGY_INTERNAL.BRAIN_DIR, id, ...AGY_INTERNAL.TRANSCRIPT_SEGMENTS);
    const recovered = readLastResponse(transcriptPath, opts.runStartMs);
    if (recovered) {
      Logger.debug(`[recovery] recovered ${recovered.length} chars from transcript for ${id}`);
    }
    return recovered;
  } catch (error) {
    Logger.debug(`[recovery] failed: ${error}`);
    return null;
  }
}

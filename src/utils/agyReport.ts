import { formatAgyUsageLine, formatConversationLine, type AgyJsonEnvelope } from './agyExecutor.js';
import type { WorkingTreeDiff } from './gitStatusGuard.js';

/**
 * Markdown rendering shared by the tools that turn an agy JSON envelope into a
 * report. Everything here is text only: no image data ever reaches the caller.
 */

const UNPARSABLE_EXCERPT_CHARS = 2000;

export function bulletList(items: string[]): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '- none';
}

export function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

/**
 * The uninvited-edit warning, or '' when the working tree did not change.
 * Every path that hands Gemini a shell must render this, including the ones
 * that bail out early.
 */
export function formatWorkingTreeSection(diff: WorkingTreeDiff): string {
  const modified = diff.modified ?? [];
  const changed = diff.added.length > 0 || diff.removed.length > 0 || modified.length > 0;
  // A capped run must still say so: "nothing to report" and "we could not look
  // at everything" are different answers, and silence would conflate them.
  if (!changed && !diff.truncated) return '';

  return section('Working tree', [
    changed
      ? '- WARNING: the working tree changed during this run.'
      : '- No change detected in the files that were checked.',
    ...diff.added.map(line => `- added: ${line}`),
    ...diff.removed.map(line => `- removed: ${line}`),
    // A file that was already dirty before the run keeps its status line, so
    // only its content hash reveals that it was rewritten.
    ...modified.map(file => `- modified during run: ${file}`),
    ...(diff.truncated ? ['- NOTE: too many dirty files to hash them all; content changes may be under-reported.'] : []),
  ].join('\n'));
}

/**
 * Rethrow an agy failure with any uninvited edits appended. A run that timed
 * out or exited non-zero may still have used its shell first, and that warning
 * must not be lost with the error.
 */
export function failWithWorkingTree(error: unknown, diff: WorkingTreeDiff): never {
  const warning = formatWorkingTreeSection(diff);
  const message = error instanceof Error ? error.message : String(error);
  throw warning ? new Error(`${message}\n\n${warning}`) : (error instanceof Error ? error : new Error(message));
}

/** Report for an envelope whose structured_output did not match the tool's result schema. */
export function renderUnparsableEnvelope(
  envelope: AgyJsonEnvelope,
  headline: string,
  issues: string[],
  subtitle?: string
): string {
  const raw = envelope.structured_output !== undefined && envelope.structured_output !== null
    ? JSON.stringify(envelope.structured_output)
    : (envelope.response ?? '');

  return [
    envelope.conversation_id ? formatConversationLine(envelope.conversation_id) : '',
    headline,
    subtitle ?? '',
    formatAgyUsageLine(envelope),
    section('Why', '- Gemini did not return a result matching the schema this tool requested.'),
    section('Schema issues', bulletList(issues)),
    section('Raw answer (truncated)', raw.slice(0, UNPARSABLE_EXCERPT_CHARS)),
  ].filter(Boolean).join('\n\n');
}

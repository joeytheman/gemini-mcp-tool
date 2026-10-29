import { z } from 'zod';
import * as fs from 'fs';
import { isWithin, realpathOfExistingPrefix } from './fileReferences.js';
import { LIVE_PASS } from '../constants.js';

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const entryFields = {
  text: z.string().max(LIVE_PASS.LAYOUT_TEXT_CHARS),
  testID: z.string().nullable(),
  rect: rectSchema,
};

export const LAYOUT_DEFECT_KINDS = [
  'page-scroll-x',
  'text-spill',
  'text-clipped',
  'control-covered',
  'control-offscreen',
] as const;

export const layoutReportSchema = z.object({
  check: z.literal(LIVE_PASS.LAYOUT_CHECK_ID),
  viewport: z.object({ width: z.number(), height: z.number() }),
  found: z.number().int().nonnegative(),
  entries: z.array(z.object({ kind: z.enum(LAYOUT_DEFECT_KINDS), ...entryFields })).max(LIVE_PASS.LAYOUT_MAX_ENTRIES),
  clamped: z.array(z.object({ kind: z.literal('text-clamped'), ...entryFields })).max(LIVE_PASS.LAYOUT_MAX_ENTRIES),
});

export type LayoutReport = z.infer<typeof layoutReportSchema>;
export type LayoutEntry = LayoutReport['entries'][number] | LayoutReport['clamped'][number];

export type LayoutCheckStatus = 'OK' | 'MISSING' | 'STALE' | 'OUTSIDE' | 'MALFORMED';

export interface LayoutCheck {
  file: string;
  status: LayoutCheckStatus;
  report?: LayoutReport;
  problem?: string;
}

export function layoutFileName(frameFileName: string): string {
  return frameFileName.replace(/\.png$/, LIVE_PASS.LAYOUT_FILE_SUFFIX);
}

/**
 * Read one frame's layout file. Never throws: a file that cannot be trusted is
 * reported with its status and treated by the report as "not run".
 */
export function readLayoutCheck(file: string, artifactDir: string, runStartMs: number): LayoutCheck {
  const absFile = realpathOfExistingPrefix(file);
  if (!isWithin(artifactDir, absFile)) {
    return { file: absFile, status: 'OUTSIDE', problem: 'resolves outside the artifact directory' };
  }

  let raw: string;
  try {
    const stat = fs.statSync(absFile);
    if (!stat.isFile()) return { file: absFile, status: 'MISSING', problem: 'not written' };
    if (stat.mtimeMs < runStartMs - LIVE_PASS.FRESHNESS_TOLERANCE_MS) {
      return { file: absFile, status: 'STALE', problem: 'predates this run' };
    }
    raw = fs.readFileSync(absFile, 'utf-8');
  } catch {
    return { file: absFile, status: 'MISSING', problem: 'not written' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { file: absFile, status: 'MALFORMED', problem: 'not valid JSON' };
  }
  const report = layoutReportSchema.safeParse(parsed);
  if (!report.success) {
    const issue = report.error.issues[0];
    return {
      file: absFile,
      status: 'MALFORMED',
      problem: `not a ${LIVE_PASS.LAYOUT_CHECK_ID} result (${issue.path.join('.') || 'root'}: ${issue.message})`,
    };
  }
  return { file: absFile, status: 'OK', report: report.data };
}

export function formatLayoutEntry(entry: LayoutEntry): string {
  const { x, y, width, height } = entry.rect;
  const testID = entry.testID ? ` testID=${entry.testID}` : '';
  return `${entry.kind} "${entry.text}"${testID} at ${x},${y} ${width}x${height}`;
}

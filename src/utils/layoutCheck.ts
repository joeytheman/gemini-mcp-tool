import { z } from 'zod';
import * as fs from 'fs';
import { realpathOfExistingPrefix } from './fileReferences.js';
import { checkArtifactFile } from './artifactFile.js';
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

export type LayoutCheckStatus = 'OK' | 'MISSING' | 'STALE' | 'OUTSIDE' | 'MALFORMED' | 'MISMATCHED';

export interface LayoutCheck {
  file: string;
  status: LayoutCheckStatus;
  report?: LayoutReport;
  problem?: string;
}

export function layoutFileName(frameFileName: string): string {
  return frameFileName.replace(/\.png$/, LIVE_PASS.LAYOUT_FILE_SUFFIX);
}

const FILE_PROBLEMS = {
  OUTSIDE: 'resolves outside the artifact directory',
  MISSING: 'not written',
  STALE: 'predates this run',
} as const;

/**
 * Read one frame's layout file. Never throws: a file that cannot be trusted is
 * reported with its status and treated by the report as "not run". A file
 * measured at another width than the frame's describes a different layout.
 */
export function readLayoutCheck(
  file: string,
  artifactDir: string,
  runStartMs: number,
  expectedWidth?: number
): LayoutCheck {
  const absFile = realpathOfExistingPrefix(file);
  const fileStatus = checkArtifactFile(absFile, artifactDir, runStartMs);
  if (fileStatus === 'EMPTY') return { file: absFile, status: 'MALFORMED', problem: 'empty' };
  if (fileStatus !== 'OK') return { file: absFile, status: fileStatus, problem: FILE_PROBLEMS[fileStatus] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(absFile, 'utf-8'));
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
  const measuredWidth = report.data.viewport.width;
  if (expectedWidth !== undefined && measuredWidth !== expectedWidth) {
    return {
      file: absFile,
      status: 'MISMATCHED',
      problem: `measured at width ${measuredWidth}, but the frame is ${expectedWidth} wide`,
    };
  }
  return { file: absFile, status: 'OK', report: report.data };
}

export function formatLayoutEntry(entry: LayoutEntry): string {
  const { x, y, width, height } = entry.rect;
  const testID = entry.testID ? ` testID=${entry.testID}` : '';
  return `${entry.kind} "${entry.text}"${testID} at ${x},${y} ${width}x${height}`;
}

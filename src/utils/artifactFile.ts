import * as fs from 'fs';
import { isWithin } from './fileReferences.js';
import { LIVE_PASS } from '../constants.js';

export type ArtifactFileStatus = 'OK' | 'OUTSIDE' | 'MISSING' | 'EMPTY' | 'STALE';

/** Whether a file a pass wrote is inside `artifactDir`, present, non-empty and written during this run. */
export function checkArtifactFile(absFile: string, artifactDir: string, runStartMs: number): ArtifactFileStatus {
  if (!isWithin(artifactDir, absFile)) return 'OUTSIDE';
  try {
    const stat = fs.statSync(absFile);
    if (!stat.isFile()) return 'MISSING';
    if (stat.size === 0) return 'EMPTY';
    if (stat.mtimeMs < runStartMs - LIVE_PASS.FRESHNESS_TOLERANCE_MS) return 'STALE';
    return 'OK';
  } catch {
    return 'MISSING';
  }
}

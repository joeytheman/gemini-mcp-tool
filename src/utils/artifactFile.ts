import * as fs from 'fs';
import * as path from 'path';
import { isWithin } from './fileReferences.js';
import { LIVE_PASS } from '../constants.js';

export type ArtifactFileStatus = 'OK' | 'OUTSIDE' | 'MISSING' | 'EMPTY' | 'STALE';

export const IMAGE_FILE = /\.(png|jpe?g)$/i;

export function hasImageSignature(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  if (extension !== '.png' && extension !== '.jpg' && extension !== '.jpeg') return false;

  let handle: number;
  try {
    handle = fs.openSync(file, 'r');
  } catch {
    return false;
  }

  try {
    const header = Buffer.alloc(24);
    const size = fs.readSync(handle, header, 0, header.length, 0);
    if (extension === '.png') {
      return size === header.length
        && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && header.readUInt32BE(8) === 13
        && header.toString('ascii', 12, 16) === 'IHDR'
        && header.readUInt32BE(16) > 0
        && header.readUInt32BE(20) > 0;
    }
    return size >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  } catch {
    return false;
  } finally {
    fs.closeSync(handle);
  }
}

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

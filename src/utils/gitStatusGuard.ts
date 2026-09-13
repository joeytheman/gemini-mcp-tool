import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger.js';
import { isWithin } from './fileReferences.js';

const execFileAsync = promisify(execFile);

/** Files larger than this are tracked by status only — hashing them is not worth the read. */
const MAX_HASH_BYTES = 8 * 1024 * 1024;
/** Upper bound on files hashed per snapshot; the report says so when it bites. */
const MAX_HASHED_FILES = 500;

/**
 * Before/after snapshots of a working tree, so a tool that hands Gemini a shell
 * can report uninvited edits. Never throws: a snapshot that cannot be taken is
 * `null` and simply disables the comparison.
 *
 * Status lines alone are not enough. These tools run against a dirty PR
 * worktree, where a file Gemini rewrites was already ` M` before the run and
 * stays ` M` after — the very files under review. So each dirty path's content
 * is hashed too, and the diff reports content changes as well as status changes.
 *
 * Async because `git status` on a cold repository takes seconds, and this runs
 * inside an MCP call whose keepalive notifications need the event loop.
 */

export interface WorkingTreeSnapshot {
  /** Repository root: porcelain paths are relative to it, never to cwd. */
  root: string;
  lines: string[];
  /** Absolute path -> sha256 of its content, for every dirty file we could hash. */
  hashes: Map<string, string>;
  /** True when MAX_HASHED_FILES cut the hashing short. */
  truncated: boolean;
}

export interface WorkingTreeDiff {
  added: string[];
  removed: string[];
  /** Paths whose content changed while keeping the same status. */
  modified: string[];
  /** True when either snapshot hashed only part of the dirty set. */
  truncated: boolean;
}

/** The path part of a porcelain line: `XY path`, possibly quoted, possibly a rename. */
function porcelainPath(line: string, repoRoot: string): string {
  const raw = line.slice(3).split(' -> ').pop() ?? '';
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return path.resolve(repoRoot, unquoted);
}

function hashFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_HASH_BYTES) return null;
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    // Deleted, unreadable, or a directory — status alone covers it.
    return null;
  }
}

export async function snapshotWorkingTree(cwd: string): Promise<WorkingTreeSnapshot | null> {
  try {
    const [{ stdout: rootOut }, { stdout: statusOut }] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' }),
      // --untracked-files=all: without it an untracked directory collapses to a
      // single `?? parent/` entry, which would hide unrelated files created
      // beside a tool's own artifact directory.
      execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf-8' }),
    ]);

    const root = rootOut.trim();
    const lines = statusOut.split('\n').map(line => line.trimEnd()).filter(Boolean);

    const hashes = new Map<string, string>();
    let truncated = false;
    for (const line of lines) {
      if (hashes.size >= MAX_HASHED_FILES) {
        truncated = true;
        break;
      }
      const file = porcelainPath(line, root);
      const hash = hashFile(file);
      if (hash) hashes.set(file, hash);
    }

    return { root, lines, hashes, truncated };
  } catch (error) {
    Logger.debug(`[git-guard] no working-tree snapshot for ${cwd}: ${error}`);
    return null;
  }
}

export function diffWorkingTree(
  before: WorkingTreeSnapshot | null,
  after: WorkingTreeSnapshot | null,
  opts: { ignoreDirectory?: string } = {}
): WorkingTreeDiff {
  if (!before || !after) return { added: [], removed: [], modified: [], truncated: false };

  // A tool's own artifact directory is not an uninvited edit.
  const ignore = opts.ignoreDirectory;
  const isOurs = (file: string): boolean => Boolean(ignore) && isWithin(ignore as string, file);

  const beforeSet = new Set(before.lines);
  const afterSet = new Set(after.lines);

  const modified: string[] = [];
  for (const [file, hash] of after.hashes) {
    const previous = before.hashes.get(file);
    if (previous && previous !== hash && !isOurs(file)) modified.push(file);
  }

  return {
    added: after.lines.filter(line => !beforeSet.has(line) && !isOurs(porcelainPath(line, after.root))),
    removed: before.lines.filter(line => !afterSet.has(line) && !isOurs(porcelainPath(line, before.root))),
    modified,
    truncated: before.truncated || after.truncated,
  };
}

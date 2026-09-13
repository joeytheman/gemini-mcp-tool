import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

vi.mock('../../utils/logger.js', () => ({
  Logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}));

import { snapshotWorkingTree, diffWorkingTree } from '../../utils/gitStatusGuard.js';
import { formatWorkingTreeSection } from '../../utils/agyReport.js';
import { makeTempDir, cleanupTempDirs } from './test-helpers.js';

const makeGitTempDir = () => makeTempDir('git-guard');

afterEach(cleanupTempDirs);

describe('snapshotWorkingTree', () => {
  it('returns null outside a git repository', async () => {
    expect(await snapshotWorkingTree(makeGitTempDir())).toBeNull();
  });

  it('returns null for a directory that does not exist', async () => {
    expect(await snapshotWorkingTree(path.join(makeGitTempDir(), 'missing'))).toBeNull();
  });

  it('lists porcelain status lines with the repository root and content hashes', async () => {
    const dir = makeGitTempDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(await snapshotWorkingTree(dir)).toMatchObject({ root: dir, lines: [], truncated: false });

    fs.writeFileSync(path.join(dir, 'new.txt'), 'hello');
    const snapshot = await snapshotWorkingTree(dir);

    expect(snapshot?.lines).toEqual(['?? new.txt']);
    expect(snapshot?.hashes.get(path.join(dir, 'new.txt'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists every untracked file, not the collapsed parent directory', async () => {
    const dir = makeGitTempDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const sub = path.join(dir, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'new.txt'), 'hello');

    const snapshot = await snapshotWorkingTree(sub);

    // Repo-root-relative, and expanded: `?? apps/` would hide siblings.
    expect(snapshot?.root).toBe(dir);
    expect(snapshot?.lines).toEqual(['?? apps/web/new.txt']);
  });

  it('hashes a file that is already dirty, so a later rewrite is detectable', async () => {
    const dir = makeGitTempDir();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q');
    const file = path.join(dir, 'app.tsx');
    fs.writeFileSync(file, 'committed');
    git('add', 'app.tsx');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'seed');
    fs.writeFileSync(file, 'dirty before the run');

    const before = await snapshotWorkingTree(dir);
    fs.writeFileSync(file, 'rewritten during the run');
    const after = await snapshotWorkingTree(dir);

    // The status line is identical (' M app.tsx') either side; only the hash moves.
    expect(before?.lines).toEqual([' M app.tsx']);
    expect(after?.lines).toEqual([' M app.tsx']);
    expect(diffWorkingTree(before, after).modified).toEqual([file]);
  });
});

function snapshot(lines: string[], root = '/work/tree', hashes: Record<string, string> = {}) {
  return { root, lines, hashes: new Map(Object.entries(hashes)), truncated: false };
}

describe('diffWorkingTree', () => {
  it('reports added and removed lines', () => {
    const diff = diffWorkingTree(snapshot(['?? a.txt', ' M b.txt']), snapshot([' M b.txt', '?? c.txt']));

    expect(diff.added).toEqual(['?? c.txt']);
    expect(diff.removed).toEqual(['?? a.txt']);
  });

  it('ignores the artifact directory but not a file created beside it', () => {
    const diff = diffWorkingTree(
      snapshot([]),
      snapshot([
        '?? .live-pass/run1/home.png',
        '?? .live-pass/uninvited.txt',
        ' M src/app/index.tsx',
      ]),
      { ignoreDirectory: '/work/tree/.live-pass/run1' }
    );

    expect(diff.added).toEqual(['?? .live-pass/uninvited.txt', ' M src/app/index.tsx']);
  });

  it('resolves porcelain paths against the repo root when the tool runs in a subdirectory', () => {
    const diff = diffWorkingTree(
      snapshot([], '/repo'),
      snapshot(['?? apps/web/.live-pass/run1/home.png', ' M apps/web/src/index.tsx'], '/repo'),
      { ignoreDirectory: '/repo/apps/web/.live-pass/run1' }
    );

    expect(diff.added).toEqual([' M apps/web/src/index.tsx']);
  });

  it('reads the path out of a quoted or renamed porcelain line', () => {
    const diff = diffWorkingTree(
      snapshot([]),
      snapshot(['R  old.txt -> .live-pass/run1/new.txt', '?? "spaced name.txt"']),
      { ignoreDirectory: '/work/tree/.live-pass/run1' }
    );

    expect(diff.added).toEqual(['?? "spaced name.txt"']);
  });

  it('reports content changes to a file whose status line never moved', () => {
    const diff = diffWorkingTree(
      snapshot([' M src/app.tsx'], '/work/tree', { '/work/tree/src/app.tsx': 'aaa' }),
      snapshot([' M src/app.tsx'], '/work/tree', { '/work/tree/src/app.tsx': 'bbb' })
    );

    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual(['/work/tree/src/app.tsx']);
  });

  it('does not report a content change inside the artifact directory', () => {
    const frame = '/work/tree/.live-pass/run1/home.png';
    const diff = diffWorkingTree(
      snapshot(['?? .live-pass/run1/home.png'], '/work/tree', { [frame]: 'aaa' }),
      snapshot(['?? .live-pass/run1/home.png'], '/work/tree', { [frame]: 'bbb' }),
      { ignoreDirectory: '/work/tree/.live-pass/run1' }
    );

    expect(diff.modified).toEqual([]);
  });

  it('keeps the truncation caveat even when nothing it could check changed', () => {
    const capped = { ...snapshot([]), truncated: true };

    const diff = diffWorkingTree(capped, capped);

    expect(diff.truncated).toBe(true);
    expect(formatWorkingTreeSection(diff)).toContain('may be under-reported');
    expect(formatWorkingTreeSection({ added: [], removed: [], modified: [], truncated: false })).toBe('');
  });

  it('reports nothing when either snapshot is missing', () => {
    const empty = { added: [], removed: [], modified: [], truncated: false };
    expect(diffWorkingTree(null, snapshot(['?? a.txt']))).toEqual(empty);
    expect(diffWorkingTree(snapshot(['?? a.txt']), null)).toEqual(empty);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  resolveFileReferences,
  isFilesystemRoot,
  normalizeList,
} from '../../utils/fileReferences.js';

let baseDir: string;
let proj: string;
let projReal: string;
let utilsDir: string;

beforeAll(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileref-'));
  proj = path.join(baseDir, 'proj');
  utilsDir = path.join(proj, 'src', 'utils');
  fs.mkdirSync(utilsDir, { recursive: true });
  fs.writeFileSync(path.join(proj, 'README.md'), '# readme');
  fs.writeFileSync(path.join(proj, 'Makefile'), 'all:\n'); // extensionless
  fs.writeFileSync(path.join(proj, 'notes.md'), 'notes');
  fs.writeFileSync(path.join(utilsDir, 'x.ts'), 'export const x = 1;');
  fs.writeFileSync(path.join(baseDir, 'secret.txt'), 'top secret'); // outside proj
  fs.symlinkSync(path.join(baseDir, 'secret.txt'), path.join(proj, 'escape.ts')); // escape
  projReal = fs.realpathSync(proj);
});

afterAll(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('normalizeList', () => {
  it('splits comma strings and trims, dropping empties', () => {
    expect(normalizeList('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(normalizeList(['x', ' y '])).toEqual(['x', 'y']);
    expect(normalizeList(undefined)).toEqual([]);
  });
});

describe('isFilesystemRoot', () => {
  it('is true for the filesystem root and false for a normal dir', () => {
    expect(isFilesystemRoot('/')).toBe(true);
    expect(isFilesystemRoot(proj)).toBe(false);
  });
});

describe('resolveFileReferences', () => {
  it('registers the root for a bare reference that resolves', () => {
    const { prompt, addDirs } = resolveFileReferences('review @README.md', { cwd: proj });
    expect(addDirs).toEqual([projReal]);
    expect(prompt).toBe('review @README.md'); // @ refs are not rewritten
  });

  it('registers the root for a nested reference', () => {
    expect(resolveFileReferences('see @src/utils/x.ts', { cwd: proj }).addDirs).toEqual([projReal]);
  });

  it('registers extensionless files (Makefile)', () => {
    expect(resolveFileReferences('build @Makefile', { cwd: proj }).addDirs).toEqual([projReal]);
  });

  it('resolves references under an includeDirectories root', () => {
    const { addDirs } = resolveFileReferences('@x.ts', { cwd: baseDir, includeDirectories: utilsDir });
    expect(addDirs).toEqual([fs.realpathSync(utilsDir)]);
  });

  it('ignores emails, @media, decorators, and non-existent refs without erroring', () => {
    expect(resolveFileReferences('mail joey@gmail.com', { cwd: proj }).addDirs).toEqual([]);
    expect(resolveFileReferences('css @media (min-width: 0)', { cwd: proj }).addDirs).toEqual([]);
    expect(resolveFileReferences('use @Injectable() here', { cwd: proj }).addDirs).toEqual([]);
    expect(resolveFileReferences('open @nope.ts', { cwd: proj }).addDirs).toEqual([]);
  });

  it('ignores absolute, traversal, and symlink-escape references', () => {
    expect(resolveFileReferences('@/etc/hosts', { cwd: proj }).addDirs).toEqual([]);
    expect(resolveFileReferences('@../secret.txt', { cwd: proj }).addDirs).toEqual([]);
    expect(resolveFileReferences('@escape.ts', { cwd: proj }).addDirs).toEqual([]);
  });

  it('rewrites a resolving file: reference to @ and registers its root', () => {
    const { prompt, addDirs } = resolveFileReferences('open file:src/utils/x.ts now', { cwd: proj });
    expect(prompt).toBe('open @src/utils/x.ts now');
    expect(addDirs).toEqual([projReal]);
  });

  it('drops trailing punctuation when converting file: to @', () => {
    const { prompt, addDirs } = resolveFileReferences('edit file:notes.md.', { cwd: proj });
    expect(prompt).toBe('edit @notes.md'); // trailing period dropped so agy resolves cleanly
    expect(addDirs).toEqual([projReal]);
  });

  it('leaves non-resolving file: tokens and file:// URLs untouched (no manufactured @ref)', () => {
    expect(resolveFileReferences('the file:notreal here', { cwd: proj })).toEqual({
      prompt: 'the file:notreal here',
      addDirs: [],
    });
    expect(resolveFileReferences('see file:///etc/passwd', { cwd: proj })).toEqual({
      prompt: 'see file:///etc/passwd',
      addDirs: [],
    });
  });
});

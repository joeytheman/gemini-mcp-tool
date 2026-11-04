import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('LAYOUT_CHECK_SNIPPET', () => {
  it('is the current minified build of src/layout-check.snippet.js', () => {
    const run = () => execFileSync('node', ['scripts/minify-layout-snippet.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });

    expect(run).not.toThrow();
  });
});

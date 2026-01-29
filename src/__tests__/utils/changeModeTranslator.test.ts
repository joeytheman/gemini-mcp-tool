import { describe, it, expect } from 'vitest';
import { formatChangeModeResponse, summarizeChangeModeEdits } from '../../utils/changeModeTranslator.js';
import { ChangeModeEdit } from '../../utils/changeModeParser.js';

function makeEdit(filename: string, oldCode = 'old', newCode = 'new'): ChangeModeEdit {
  return {
    filename,
    oldStartLine: 1,
    oldEndLine: 1,
    oldCode,
    newStartLine: 1,
    newEndLine: 1,
    newCode,
  };
}

describe('formatChangeModeResponse', () => {
  it('should format single chunk without chunkInfo', () => {
    const edits = [makeEdit('src/a.ts')];
    const result = formatChangeModeResponse(edits);

    expect(result).toContain('[CHANGEMODE OUTPUT');
    expect(result).toContain('1 modification');
    expect(result).toContain('### Edit 1: src/a.ts');
    expect(result).toContain('old');
    expect(result).toContain('new');
    expect(result).not.toContain('Chunk');
    expect(result).not.toContain('fetch-chunk');
  });

  it('should format multi-chunk with navigation footer', () => {
    const edits = [makeEdit('src/a.ts'), makeEdit('src/b.ts')];
    const chunkInfo = { current: 1, total: 3, cacheKey: 'abc12345' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('Chunk 1 of 3');
    expect(result).toContain('2 complete edits');
    expect(result).toContain('fetch-chunk cacheKey="abc12345" chunkIndex=2');
    expect(result).toContain('2 more chunks');
  });

  it('should use correct pluralization for 1 edit', () => {
    const edits = [makeEdit('src/a.ts')];
    const result = formatChangeModeResponse(edits);

    expect(result).toContain('1 modification');
    expect(result).not.toContain('modifications');
  });

  it('should use correct pluralization for multiple edits', () => {
    const edits = [makeEdit('src/a.ts'), makeEdit('src/b.ts'), makeEdit('src/c.ts')];
    const result = formatChangeModeResponse(edits);

    expect(result).toContain('3 modifications');
  });

  it('should use correct pluralization in multi-chunk header', () => {
    const edits = [makeEdit('src/a.ts')];
    const chunkInfo = { current: 1, total: 2, cacheKey: 'key123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('1 complete edit ');
    expect(result).not.toContain('1 complete edits');
  });

  it('should show "is 1 more chunk" when only 1 remaining', () => {
    const edits = [makeEdit('src/a.ts')];
    const chunkInfo = { current: 1, total: 2, cacheKey: 'key123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('is 1 more chunk');
    expect(result).not.toContain('is 1 more chunks');
  });

  it('should show "are N more chunks" for multiple remaining', () => {
    const edits = [makeEdit('src/a.ts')];
    const chunkInfo = { current: 1, total: 4, cacheKey: 'key123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('are 3 more chunks');
  });

  it('should not include footer for last chunk', () => {
    const edits = [makeEdit('src/a.ts')];
    const chunkInfo = { current: 3, total: 3, cacheKey: 'key123' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).not.toContain('fetch-chunk');
    expect(result).not.toContain('Next Step');
  });

  it('should include correct chunkIndex in fetch-chunk command', () => {
    const edits = [makeEdit('src/a.ts')];
    const chunkInfo = { current: 2, total: 5, cacheKey: 'mykey' };
    const result = formatChangeModeResponse(edits, chunkInfo);

    expect(result).toContain('fetch-chunk cacheKey="mykey" chunkIndex=3');
  });
});

describe('summarizeChangeModeEdits', () => {
  it('should show correct file grouping and edit counts', () => {
    const edits = [
      makeEdit('src/a.ts'),
      makeEdit('src/a.ts'),
      makeEdit('src/b.ts'),
    ];

    const summary = summarizeChangeModeEdits(edits);
    expect(summary).toContain('ChangeMode Summary:');
    expect(summary).toContain('Total edits: 3');
    expect(summary).toContain('Files affected: 2');
    expect(summary).toContain('- src/a.ts: 2 edits');
    expect(summary).toContain('- src/b.ts: 1 edit');
    expect(summary).not.toContain('1 edits');
  });

  it('should add "across all chunks" text when isPartialView is true', () => {
    const edits = [makeEdit('src/a.ts')];

    const summary = summarizeChangeModeEdits(edits, true);
    expect(summary).toContain('(across all chunks)');
    expect(summary).toContain('Complete analysis across all chunks');
  });

  it('should not add "across all chunks" text when isPartialView is false', () => {
    const edits = [makeEdit('src/a.ts')];

    const summary = summarizeChangeModeEdits(edits, false);
    expect(summary).not.toContain('across all chunks');
  });

  it('should not add "across all chunks" text when isPartialView is undefined', () => {
    const edits = [makeEdit('src/a.ts')];

    const summary = summarizeChangeModeEdits(edits);
    expect(summary).not.toContain('across all chunks');
  });
});

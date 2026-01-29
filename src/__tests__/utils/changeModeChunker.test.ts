import { describe, it, expect } from 'vitest';
import { chunkChangeModeEdits, summarizeChunking } from '../../utils/changeModeChunker.js';
import { ChangeModeEdit } from '../../utils/changeModeParser.js';

function makeEdit(filename: string, codeSize: number = 50): ChangeModeEdit {
  return {
    filename,
    oldStartLine: 1,
    oldEndLine: 1,
    oldCode: 'x'.repeat(codeSize),
    newStartLine: 1,
    newEndLine: 1,
    newCode: 'y'.repeat(codeSize),
  };
}

describe('chunkChangeModeEdits', () => {
  it('should return single empty chunk for empty edits', () => {
    const chunks = chunkChangeModeEdits([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].edits).toHaveLength(0);
    expect(chunks[0].chunkIndex).toBe(1);
    expect(chunks[0].totalChunks).toBe(1);
    expect(chunks[0].hasMore).toBe(false);
    expect(chunks[0].estimatedChars).toBe(0);
  });

  it('should fit small edit set in one chunk', () => {
    const edits = [makeEdit('src/a.ts'), makeEdit('src/b.ts')];
    const chunks = chunkChangeModeEdits(edits);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].edits).toHaveLength(2);
    expect(chunks[0].totalChunks).toBe(1);
    expect(chunks[0].hasMore).toBe(false);
  });

  it('should split large edits into multiple chunks', () => {
    // Create edits that exceed 20KB per chunk
    // Each edit is ~250 overhead + 2*codeSize. With codeSize=5000, each is ~10250 chars
    // Two edits from different files should split into 2 chunks at 20KB
    const edits = [
      makeEdit('src/a.ts', 5000),
      makeEdit('src/b.ts', 5000),
      makeEdit('src/c.ts', 5000),
    ];

    const chunks = chunkChangeModeEdits(edits, 12000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].hasMore).toBe(true);
    expect(chunks[chunks.length - 1].hasMore).toBe(false);
  });

  it('should group edits by file when possible', () => {
    const edits = [
      makeEdit('src/a.ts', 50),
      makeEdit('src/a.ts', 50),
      makeEdit('src/b.ts', 50),
      makeEdit('src/b.ts', 50),
    ];

    const chunks = chunkChangeModeEdits(edits);
    expect(chunks).toHaveLength(1);

    // All edits for same file should be grouped together
    const aEdits = chunks[0].edits.filter(e => e.filename === 'src/a.ts');
    const bEdits = chunks[0].edits.filter(e => e.filename === 'src/b.ts');
    expect(aEdits).toHaveLength(2);
    expect(bEdits).toHaveLength(2);
  });

  it('should split large single-file edits across chunks', () => {
    // Many edits for a single file exceeding max chunk size
    const edits: ChangeModeEdit[] = [];
    for (let i = 0; i < 20; i++) {
      edits.push(makeEdit('src/big.ts', 2000));
    }

    const chunks = chunkChangeModeEdits(edits, 10000);
    expect(chunks.length).toBeGreaterThan(1);

    // All edits should belong to the same file
    for (const chunk of chunks) {
      for (const edit of chunk.edits) {
        expect(edit.filename).toBe('src/big.ts');
      }
    }
  });

  it('should set correct chunk metadata', () => {
    const edits = [
      makeEdit('src/a.ts', 5000),
      makeEdit('src/b.ts', 5000),
      makeEdit('src/c.ts', 5000),
    ];

    const chunks = chunkChangeModeEdits(edits, 12000);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i + 1);
      expect(chunks[i].totalChunks).toBe(chunks.length);
      expect(chunks[i].hasMore).toBe(i < chunks.length - 1);
      expect(chunks[i].estimatedChars).toBeGreaterThan(0);
    }
  });
});

describe('summarizeChunking', () => {
  it('should produce correct summary format', () => {
    const edits = [makeEdit('src/a.ts'), makeEdit('src/b.ts')];
    const chunks = chunkChangeModeEdits(edits);

    const summary = summarizeChunking(chunks);
    expect(summary).toContain('Chunking Summary:');
    expect(summary).toContain('# edits: 2');
    expect(summary).toContain('# chunks: 1');
    expect(summary).toContain('est chars:');
    expect(summary).toContain('mean size:');
    expect(summary).toContain('Chunk 1:');
  });

  it('should correctly count edits across multiple chunks', () => {
    const edits = [
      makeEdit('src/a.ts', 5000),
      makeEdit('src/b.ts', 5000),
      makeEdit('src/c.ts', 5000),
    ];

    const chunks = chunkChangeModeEdits(edits, 12000);
    const summary = summarizeChunking(chunks);

    expect(summary).toContain('# edits: 3');
    expect(summary).toContain(`# chunks: ${chunks.length}`);
  });
});

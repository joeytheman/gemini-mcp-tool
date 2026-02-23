import { describe, it, expect, vi } from 'vitest';
import { parseChangeModeOutput, validateChangeModeEdits, ChangeModeEdit } from '../../utils/changeModeParser.js';

describe('parseChangeModeOutput', () => {
  it('should parse a single edit in markdown format', () => {
    const input = `**FILE: src/index.ts:10**
\`\`\`
OLD:
const x = 1;
NEW:
const x = 2;
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe('src/index.ts');
    expect(edits[0].oldStartLine).toBe(10);
    expect(edits[0].oldCode).toBe('const x = 1;');
    expect(edits[0].newCode).toBe('const x = 2;');
  });

  it('should parse multiple edits across different files', () => {
    const input = `**FILE: src/a.ts:5**
\`\`\`
OLD:
let a = 1;
NEW:
let a = 2;
\`\`\`

**FILE: src/b.ts:20**
\`\`\`
OLD:
let b = 3;
NEW:
let b = 4;
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(2);
    expect(edits[0].filename).toBe('src/a.ts');
    expect(edits[0].oldStartLine).toBe(5);
    expect(edits[1].filename).toBe('src/b.ts');
    expect(edits[1].oldStartLine).toBe(20);
  });

  it('should handle empty OLD code (insertions)', () => {
    const input = `**FILE: src/index.ts:1**
\`\`\`
OLD:

NEW:
const newLine = true;
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldCode).toBe('');
    expect(edits[0].newCode).toBe('const newLine = true;');
  });

  it('should handle empty NEW code (deletions)', () => {
    const input = `**FILE: src/index.ts:5**
\`\`\`
OLD:
const toDelete = true;
NEW:

\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldCode).toBe('const toDelete = true;');
    expect(edits[0].newCode).toBe('');
  });

  it('should fall back to legacy /old/ format when markdown not found', () => {
    const input = `/old/ * src/file.ts 'start:' 10
const old = true;
// 'end:' 10
\\new\\ * src/file.ts 'start:' 10
const updated = true;
// 'end:' 10`;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe('src/file.ts');
    expect(edits[0].oldStartLine).toBe(10);
    expect(edits[0].oldEndLine).toBe(10);
    expect(edits[0].oldCode).toBe('const old = true;');
    expect(edits[0].newCode).toBe('const updated = true;');
  });

  it('should return empty array when no edits found', () => {
    const input = 'Just some regular text with no edits.';
    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(0);
  });

  it('should handle multiline code blocks', () => {
    const input = `**FILE: src/component.tsx:15**
\`\`\`
OLD:
function render() {
  return (
    <div>Hello</div>
  );
}
NEW:
function render() {
  return (
    <div>World</div>
  );
}
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldStartLine).toBe(15);
    // Old code has 5 lines, so end line = 15 + 5 - 1 = 19
    expect(edits[0].oldEndLine).toBe(19);
    expect(edits[0].oldCode).toContain('<div>Hello</div>');
    expect(edits[0].newCode).toContain('<div>World</div>');
  });

  it('should calculate correct line ranges for multiline edits', () => {
    const input = `**FILE: src/test.ts:100**
\`\`\`
OLD:
line1
line2
line3
NEW:
newLine1
newLine2
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldStartLine).toBe(100);
    expect(edits[0].oldEndLine).toBe(102); // 100 + 3 - 1
    expect(edits[0].newStartLine).toBe(100);
    expect(edits[0].newEndLine).toBe(101); // 100 + 2 - 1
  });

  it('should trim filename whitespace', () => {
    const input = `**FILE:  src/padded.ts :42**
\`\`\`
OLD:
x = 1;
NEW:
x = 2;
\`\`\``;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(1);
    expect(edits[0].filename).toBe('src/padded.ts');
  });

  it('should skip legacy edits with mismatched filenames', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = `/old/ * src/fileA.ts 'start:' 10
old code
// 'end:' 10
\\new\\ * src/fileB.ts 'start:' 10
new code
// 'end:' 10`;

    const edits = parseChangeModeOutput(input);
    expect(edits).toHaveLength(0);
    consoleWarnSpy.mockRestore();
  });
});

describe('validateChangeModeEdits', () => {
  it('should validate valid edits', () => {
    const edits: ChangeModeEdit[] = [{
      filename: 'src/test.ts',
      oldStartLine: 1,
      oldEndLine: 5,
      oldCode: 'old code',
      newStartLine: 1,
      newEndLine: 5,
      newCode: 'new code',
    }];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail for missing filename', () => {
    const edits: ChangeModeEdit[] = [{
      filename: '',
      oldStartLine: 1,
      oldEndLine: 5,
      oldCode: 'old code',
      newStartLine: 1,
      newEndLine: 5,
      newCode: 'new code',
    }];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Edit missing filename');
  });

  it('should fail for invalid old line range (startLine > endLine)', () => {
    const edits: ChangeModeEdit[] = [{
      filename: 'test.ts',
      oldStartLine: 10,
      oldEndLine: 5,
      oldCode: 'code',
      newStartLine: 1,
      newEndLine: 1,
      newCode: 'code',
    }];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid line range');
  });

  it('should fail for invalid new line range', () => {
    const edits: ChangeModeEdit[] = [{
      filename: 'test.ts',
      oldStartLine: 1,
      oldEndLine: 1,
      oldCode: 'code',
      newStartLine: 10,
      newEndLine: 5,
      newCode: 'code',
    }];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid new line range');
  });

  it('should fail for empty edit (both oldCode and newCode empty)', () => {
    const edits: ChangeModeEdit[] = [{
      filename: 'test.ts',
      oldStartLine: 1,
      oldEndLine: 1,
      oldCode: '',
      newStartLine: 1,
      newEndLine: 1,
      newCode: '',
    }];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Empty edit');
  });

  it('should accumulate multiple errors', () => {
    const edits: ChangeModeEdit[] = [
      {
        filename: '',
        oldStartLine: 10,
        oldEndLine: 5,
        oldCode: '',
        newStartLine: 1,
        newEndLine: 1,
        newCode: '',
      },
      {
        filename: 'file.ts',
        oldStartLine: 1,
        oldEndLine: 1,
        oldCode: '',
        newStartLine: 1,
        newEndLine: 1,
        newCode: '',
      },
    ];

    const result = validateChangeModeEdits(edits);
    expect(result.valid).toBe(false);
    // First edit has 3 errors: missing filename, invalid line range, empty edit
    // Second edit has 1 error: empty edit
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

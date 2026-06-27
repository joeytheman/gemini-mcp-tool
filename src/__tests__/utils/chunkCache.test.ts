import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

// Track mock file store
const mockFileStore = new Map<string, string>();
const mockFileStats = new Map<string, { mtimeMs: number }>();

vi.mock('fs', () => ({
  existsSync: vi.fn((filePath: string) => {
    return mockFileStore.has(filePath) || filePath.endsWith('agy-mcp-chunks');
  }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn((filePath: string, content: string) => {
    mockFileStore.set(filePath, content);
    mockFileStats.set(filePath, { mtimeMs: Date.now() });
  }),
  readFileSync: vi.fn((filePath: string) => {
    const content = mockFileStore.get(filePath);
    if (!content) throw new Error(`ENOENT: no such file: ${filePath}`);
    return content;
  }),
  unlinkSync: vi.fn((filePath: string) => {
    mockFileStore.delete(filePath);
    mockFileStats.delete(filePath);
  }),
  readdirSync: vi.fn(() => {
    const files: string[] = [];
    for (const key of mockFileStore.keys()) {
      const parts = key.split('/');
      const filename = parts[parts.length - 1];
      if (filename.endsWith('.json')) {
        files.push(filename);
      }
    }
    return files;
  }),
  statSync: vi.fn((filePath: string) => {
    const stats = mockFileStats.get(filePath);
    if (!stats) throw new Error(`ENOENT: no such file: ${filePath}`);
    return stats;
  }),
}));

import { cacheChunks, getChunks, clearCache, getCacheStats } from '../../utils/chunkCache.js';
import type { EditChunk } from '../../utils/changeModeChunker.js';

const sampleChunks: EditChunk[] = [
  {
    edits: [{
      filename: 'test.ts',
      oldStartLine: 1,
      oldEndLine: 1,
      oldCode: 'old',
      newStartLine: 1,
      newEndLine: 1,
      newCode: 'new',
    }],
    chunkIndex: 1,
    totalChunks: 1,
    hasMore: false,
    estimatedChars: 100,
  },
];

describe('chunkCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileStore.clear();
    mockFileStats.clear();
  });

  describe('cacheChunks', () => {
    it('should return an 8-char key', () => {
      const key = cacheChunks('test prompt', sampleChunks);
      expect(key).toHaveLength(8);
      expect(key).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should produce deterministic keys for same prompt', () => {
      const key1 = cacheChunks('same prompt', sampleChunks);
      mockFileStore.clear();
      const key2 = cacheChunks('same prompt', sampleChunks);
      expect(key1).toBe(key2);
    });

    it('should write JSON file', () => {
      cacheChunks('test', sampleChunks);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getChunks', () => {
    it('should return cached data on hit', () => {
      const key = cacheChunks('test', sampleChunks);

      const result = getChunks(key);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].edits[0].filename).toBe('test.ts');
    });

    it('should return null for expired data (>10 min)', () => {
      const key = cacheChunks('test', sampleChunks);

      // Simulate expired timestamp by modifying the stored data
      for (const [path, content] of mockFileStore.entries()) {
        if (path.includes(key)) {
          const data = JSON.parse(content);
          data.timestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago
          mockFileStore.set(path, JSON.stringify(data));
        }
      }

      const result = getChunks(key);
      expect(result).toBeNull();
    });

    it('should return null for missing key', () => {
      // Override existsSync for this test to return false for the specific file
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);

      const result = getChunks('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('should remove all JSON files', () => {
      // Set up mock state so readdirSync returns known files
      vi.mocked(fs.readdirSync).mockReturnValueOnce(['abc.json', 'def.json'] as any);

      clearCache();

      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct stats', () => {
      vi.mocked(fs.readdirSync).mockReturnValueOnce(['a.json', 'b.json', 'c.json'] as any);

      const stats = getCacheStats();
      expect(stats.size).toBe(3);
      expect(stats.ttl).toBe(10 * 60 * 1000);
      expect(stats.maxSize).toBe(50);
      expect(stats.cacheDir).toContain('agy-mcp-chunks');
    });
  });
});

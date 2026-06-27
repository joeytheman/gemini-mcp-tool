import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCacheKey,
  isCacheEnabled,
  cacheResponse,
  getCachedResponse,
  clearCache,
  getCacheStats,
} from '../../utils/responseCache.js';

// Mock logger to suppress output
vi.mock('../../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

describe('responseCache', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('generateCacheKey', () => {
    it('should produce a deterministic SHA256 hash', () => {
      const key1 = generateCacheKey('test prompt', { model: 'Gemini 3.5 Flash (Medium)' });
      const key2 = generateCacheKey('test prompt', { model: 'Gemini 3.5 Flash (Medium)' });
      expect(key1).toBe(key2);
      // SHA256 produces 64 hex chars
      expect(key1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different keys for different prompts', () => {
      const key1 = generateCacheKey('prompt A', {});
      const key2 = generateCacheKey('prompt B', {});
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different options', () => {
      const key1 = generateCacheKey('test', { model: 'pro' });
      const key2 = generateCacheKey('test', { model: 'flash' });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different boolean options', () => {
      const key1 = generateCacheKey('test', { sandbox: true });
      const key2 = generateCacheKey('test', { sandbox: false });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different working directories', () => {
      const key1 = generateCacheKey('test', { cwd: '/project-a' });
      const key2 = generateCacheKey('test', { cwd: '/project-b' });
      expect(key1).not.toBe(key2);
    });
  });

  describe('isCacheEnabled', () => {
    it('should return true when env var is "true"', () => {
      const original = process.env.AGY_CACHE_ENABLED;
      process.env.AGY_CACHE_ENABLED = 'true';
      expect(isCacheEnabled()).toBe(true);
      process.env.AGY_CACHE_ENABLED = original;
    });

    it('should return false when env var is not "true"', () => {
      const original = process.env.AGY_CACHE_ENABLED;
      delete process.env.AGY_CACHE_ENABLED;
      expect(isCacheEnabled()).toBe(false);
      process.env.AGY_CACHE_ENABLED = original;
    });

    it('should return false when env var is "false"', () => {
      const original = process.env.AGY_CACHE_ENABLED;
      process.env.AGY_CACHE_ENABLED = 'false';
      expect(isCacheEnabled()).toBe(false);
      process.env.AGY_CACHE_ENABLED = original;
    });
  });

  describe('cacheResponse / getCachedResponse', () => {
    it('should round-trip a cached response', () => {
      cacheResponse('test-key', 'test-value');
      const result = getCachedResponse('test-key');
      expect(result).toBe('test-value');
    });

    it('should return undefined for cache miss', () => {
      const result = getCachedResponse('nonexistent-key');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing cache entry', () => {
      cacheResponse('key', 'value1');
      cacheResponse('key', 'value2');
      expect(getCachedResponse('key')).toBe('value2');
    });
  });

  describe('clearCache', () => {
    it('should empty the cache', () => {
      cacheResponse('key1', 'value1');
      cacheResponse('key2', 'value2');
      expect(getCachedResponse('key1')).toBe('value1');

      clearCache();
      expect(getCachedResponse('key1')).toBeUndefined();
      expect(getCachedResponse('key2')).toBeUndefined();
    });
  });

  describe('getCacheStats', () => {
    it('should return correct size info', () => {
      const emptyStats = getCacheStats();
      expect(emptyStats.size).toBe(0);
      expect(emptyStats.maxSize).toBe(100);

      cacheResponse('k1', 'v1');
      cacheResponse('k2', 'v2');

      const stats = getCacheStats();
      expect(stats.size).toBe(2);
    });
  });
});

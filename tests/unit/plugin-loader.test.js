import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginLoader } from '../../src/plugin-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../fixtures/plugins');

describe('PluginLoader', () => {
  let loader;

  beforeEach(() => {
    loader = new PluginLoader(fixturesDir);
  });

  afterEach(() => {
    loader.clearCache();
  });

  describe('loadTransform', () => {
    it('loads a transform plugin and returns the transform function', () => {
      const transform = loader.loadTransform('test-transform.cjs');
      expect(typeof transform).toBe('function');

      const result = transform({ foo: 'bar' }, {}, { name: 'myPlugin' });
      expect(result).toEqual({ foo: 'bar', transformed: true, by: 'myPlugin' });
    });

    it('throws if file does not exist', () => {
      expect(() => loader.loadTransform('nonexistent.cjs')).toThrow(/not found|cannot find/i);
    });

    it('throws if module does not export a transform function', () => {
      expect(() => loader.loadTransform('invalid-plugin.cjs')).toThrow(/transform/i);
    });
  });

  describe('loadFilter', () => {
    it('loads a filter plugin and returns the filter function', () => {
      const filter = loader.loadFilter('test-filter.cjs');
      expect(typeof filter).toBe('function');

      const passResult = filter({ action: 'push' }, {}, {});
      expect(passResult).toEqual({ pass: true });

      const dropResult = filter({ action: 'ignore' }, {}, {});
      expect(dropResult).toEqual({ pass: false, reason: 'Action is ignore' });
    });

    it('throws if file does not exist', () => {
      expect(() => loader.loadFilter('nonexistent.cjs')).toThrow(/not found|cannot find/i);
    });

    it('throws if module does not export a filter function', () => {
      expect(() => loader.loadFilter('invalid-plugin.cjs')).toThrow(/filter/i);
    });
  });

  describe('caching', () => {
    it('returns the same function reference on second load', () => {
      const first = loader.loadTransform('test-transform.cjs');
      const second = loader.loadTransform('test-transform.cjs');
      expect(first).toBe(second);
    });

    it('isLoaded returns true for cached plugins', () => {
      expect(loader.isLoaded('test-transform.cjs')).toBe(false);
      loader.loadTransform('test-transform.cjs');
      expect(loader.isLoaded('test-transform.cjs')).toBe(true);
    });

    it('clearCache removes all cached plugins', () => {
      loader.loadTransform('test-transform.cjs');
      expect(loader.isLoaded('test-transform.cjs')).toBe(true);
      loader.clearCache();
      expect(loader.isLoaded('test-transform.cjs')).toBe(false);
    });
  });
});

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

/**
 * Loads CJS transform/filter plugins from a specified directory.
 *
 * Plugin API contracts:
 * - Transform: `module.exports.transform = function(payload, headers, config) -> object|null`
 * - Filter: `module.exports.filter = function(payload, headers, config) -> { pass: boolean, reason?: string }`
 */
export class PluginLoader {
  #pluginsDir;
  #cache = new Map();
  #require;

  /**
   * @param {string} pluginsDir - Absolute path to the plugins directory
   */
  constructor(pluginsDir) {
    this.#pluginsDir = pluginsDir;
    this.#require = createRequire(import.meta.url);
  }

  /**
   * Load a transform plugin. Returns the module's `transform` function.
   * @param {string} relativePath - Path relative to pluginsDir
   * @returns {function(object, object, object): object|null}
   */
  loadTransform(relativePath) {
    const mod = this.#loadModule(relativePath);
    if (typeof mod.transform !== 'function') {
      throw new Error(
        `Plugin "${relativePath}" does not export a transform function`
      );
    }
    return mod.transform;
  }

  /**
   * Load a filter plugin. Returns the module's `filter` function.
   * @param {string} relativePath - Path relative to pluginsDir
   * @returns {function(object, object, object): { pass: boolean, reason?: string }}
   */
  loadFilter(relativePath) {
    const mod = this.#loadModule(relativePath);
    if (typeof mod.filter !== 'function') {
      throw new Error(
        `Plugin "${relativePath}" does not export a filter function`
      );
    }
    return mod.filter;
  }

  /** Clear the plugin cache (for hot-reload support). */
  clearCache() {
    for (const resolvedPath of this.#cache.keys()) {
      delete this.#require.cache[resolvedPath];
    }
    this.#cache.clear();
  }

  /**
   * Check if a plugin is cached.
   * @param {string} relativePath - Path relative to pluginsDir
   * @returns {boolean}
   */
  isLoaded(relativePath) {
    const resolved = path.resolve(this.#pluginsDir, relativePath);
    return this.#cache.has(resolved);
  }

  #loadModule(relativePath) {
    const resolved = path.resolve(this.#pluginsDir, relativePath);

    if (this.#cache.has(resolved)) {
      return this.#cache.get(resolved);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`Plugin not found: ${resolved}`);
    }

    const mod = this.#require(resolved);
    this.#cache.set(resolved, mod);
    return mod;
  }
}

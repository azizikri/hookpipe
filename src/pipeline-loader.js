import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import yaml from 'js-yaml';
import chokidar from 'chokidar';

const VALID_ID_RE = /^[a-z0-9-]+$/;
const ENV_VAR_RE = /\$\{([^}]+)\}/g;
const KNOWN_TYPES = new Set(['http']);

function interpolateEnv(value) {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_RE, (_, varName) => process.env[varName] || '');
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnv);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolateEnv(v);
    }
    return result;
  }
  return value;
}

function validate(config, filePath) {
  if (!config || !config.id) {
    throw new Error(`Pipeline id is required (file: ${filePath})`);
  }
  if (!VALID_ID_RE.test(config.id)) {
    throw new Error(`Invalid id "${config.id}" - must be URL-safe (lowercase alphanumeric + hyphens only) (file: ${filePath})`);
  }
  if (!config.destinations || !Array.isArray(config.destinations) || config.destinations.length === 0) {
    throw new Error(`Pipeline destinations is required and must be a non-empty array (file: ${filePath})`);
  }
  for (const dest of config.destinations) {
    if (!dest.id) {
      throw new Error(`Destination must have an id (file: ${filePath})`);
    }
    if (!dest.type) {
      throw new Error(`Destination must have a type (file: ${filePath})`);
    }
    if (!KNOWN_TYPES.has(dest.type)) {
      throw new Error(`Unknown destination type "${dest.type}" (file: ${filePath})`);
    }
    if (!dest.url) {
      throw new Error(`Destination must have a url (file: ${filePath})`);
    }
  }
}

export class PipelineLoader extends EventEmitter {
  #pipelines = new Map();
  #pipelinesDir;
  #watcher = null;
  #fileToPipelineId = new Map();

  constructor(pipelinesDir, opts = {}) {
    super();
    this.#pipelinesDir = pipelinesDir;
  }

  async loadAll() {
    const files = await this.#scanYamlFiles(this.#pipelinesDir);
    for (const file of files) {
      await this.#loadFile(file);
    }
  }

  get(pipelineId) {
    return this.#pipelines.get(pipelineId);
  }

  getAll() {
    return this.#pipelines;
  }

  startWatching() {
    this.#watcher = chokidar.watch(this.#pipelinesDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.#watcher.on('add', (filePath) => this.#handleFileChange(filePath));
    this.#watcher.on('change', (filePath) => this.#handleFileChange(filePath));
    this.#watcher.on('unlink', (filePath) => this.#handleFileRemove(filePath));

    return new Promise((resolve) => {
      this.#watcher.on('ready', resolve);
    });
  }

  stopWatching() {
    if (this.#watcher) {
      this.#watcher.close();
      this.#watcher = null;
    }
  }

  async #scanYamlFiles(dir) {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
      .map((e) => path.join(e.parentPath || e.path, e.name));
  }

  async #loadFile(filePath) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const raw = yaml.load(content);
      validate(raw, filePath);
      const config = interpolateEnv(raw);
      this.#pipelines.set(config.id, config);
      this.#fileToPipelineId.set(filePath, config.id);
      this.emit('loaded', config);
    } catch (err) {
      this.emit('error', err);
    }
  }

  async #handleFileChange(filePath) {
    if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) return;
    try {
      const content = await readFile(filePath, 'utf-8');
      const raw = yaml.load(content);
      validate(raw, filePath);
      const config = interpolateEnv(raw);
      // Remove old pipeline ID if the file previously had a different ID
      const oldId = this.#fileToPipelineId.get(filePath);
      if (oldId && oldId !== config.id) {
        this.#pipelines.delete(oldId);
      }
      this.#pipelines.set(config.id, config);
      this.#fileToPipelineId.set(filePath, config.id);
      this.emit('reloaded', config);
    } catch (err) {
      this.emit('error', err);
    }
  }

  #handleFileRemove(filePath) {
    const pipelineId = this.#fileToPipelineId.get(filePath);
    if (pipelineId) {
      this.#pipelines.delete(pipelineId);
      this.#fileToPipelineId.delete(filePath);
      this.emit('removed', pipelineId);
    }
  }
}

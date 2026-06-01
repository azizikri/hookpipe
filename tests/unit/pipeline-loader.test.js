import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipelineLoader } from '../../src/pipeline-loader.js';
import { writeFile, mkdir, rm, unlink, copyFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');
const tmpDir = path.join(__dirname, '..', 'fixtures', 'tmp-pipelines');

describe('PipelineLoader', () => {
  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadAll', () => {
    it('loads valid YAML and returns pipeline by id', async () => {
      await copyFile(
        path.join(fixturesDir, 'test-pipeline.yaml'),
        path.join(tmpDir, 'test-pipeline.yaml')
      );
      const loader = new PipelineLoader(tmpDir);
      await loader.loadAll();

      const pipeline = loader.get('test-pipeline');
      expect(pipeline).toBeDefined();
      expect(pipeline.name).toBe('Test Pipeline');
      expect(pipeline.destinations).toHaveLength(1);
      expect(pipeline.destinations[0].id).toBe('primary');
      expect(pipeline.destinations[0].type).toBe('http');
      expect(pipeline.destinations[0].url).toBe('http://localhost:9999/webhook');
    });

    it('rejects pipeline without id', async () => {
      await writeFile(path.join(tmpDir, 'no-id.yaml'), `
name: No ID Pipeline
destinations:
  - id: dest1
    type: http
    url: http://example.com
`);
      const loader = new PipelineLoader(tmpDir);
      const errors = [];
      loader.on('error', (err) => errors.push(err));
      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/id.*required/i);
      expect(loader.getAll().size).toBe(0);
    });

    it('rejects pipeline without destinations', async () => {
      await writeFile(path.join(tmpDir, 'no-dest.yaml'), `
id: no-dest
name: No Destinations
`);
      const loader = new PipelineLoader(tmpDir);
      const errors = [];
      loader.on('error', (err) => errors.push(err));
      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/destinations.*required/i);
    });

    it('rejects invalid id format (spaces, uppercase)', async () => {
      await writeFile(path.join(tmpDir, 'bad-id.yaml'), `
id: Bad Pipeline ID
destinations:
  - id: dest1
    type: http
    url: http://example.com
`);
      const loader = new PipelineLoader(tmpDir);
      const errors = [];
      loader.on('error', (err) => errors.push(err));
      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/url-safe|invalid.*id/i);
    });

    it('rejects destination without required fields', async () => {
      await writeFile(path.join(tmpDir, 'bad-dest.yaml'), `
id: bad-dest
destinations:
  - id: dest1
    type: http
`);
      const loader = new PipelineLoader(tmpDir);
      const errors = [];
      loader.on('error', (err) => errors.push(err));
      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/url/i);
    });

    it('rejects unknown destination type', async () => {
      await writeFile(path.join(tmpDir, 'bad-type.yaml'), `
id: bad-type
destinations:
  - id: dest1
    type: ftp
    url: ftp://example.com
`);
      const loader = new PipelineLoader(tmpDir);
      const errors = [];
      loader.on('error', (err) => errors.push(err));
      await loader.loadAll();

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/type/i);
    });
  });

  describe('env interpolation', () => {
    it('interpolates ${ENV_VAR} in string values', async () => {
      process.env.TEST_SECRET = 'my-secret-value';
      await copyFile(
        path.join(fixturesDir, 'test-pipeline.yaml'),
        path.join(tmpDir, 'test-pipeline.yaml')
      );
      const loader = new PipelineLoader(tmpDir);
      await loader.loadAll();

      const pipeline = loader.get('test-pipeline');
      expect(pipeline.auth.secret).toBe('my-secret-value');
      delete process.env.TEST_SECRET;
    });

    it('missing env var resolves to empty string', async () => {
      delete process.env.TEST_SECRET;
      await copyFile(
        path.join(fixturesDir, 'test-pipeline.yaml'),
        path.join(tmpDir, 'test-pipeline.yaml')
      );
      const loader = new PipelineLoader(tmpDir);
      await loader.loadAll();

      const pipeline = loader.get('test-pipeline');
      expect(pipeline.auth.secret).toBe('');
    });
  });

  describe('hot-reload', () => {
    it('reloads pipeline when file changes', async () => {
      await writeFile(path.join(tmpDir, 'hot.yaml'), `
id: hot-pipeline
name: Original
destinations:
  - id: dest1
    type: http
    url: http://example.com
`);
      const loader = new PipelineLoader(tmpDir, { watch: true });
      await loader.loadAll();
      await loader.startWatching();

      expect(loader.get('hot-pipeline').name).toBe('Original');

      await writeFile(path.join(tmpDir, 'hot.yaml'), `
id: hot-pipeline
name: Updated
destinations:
  - id: dest1
    type: http
    url: http://example.com
`);

      await new Promise((resolve) => {
        loader.once('reloaded', resolve);
        setTimeout(resolve, 3000);
      });

      expect(loader.get('hot-pipeline').name).toBe('Updated');
      loader.stopWatching();
    });

    it('removes pipeline when file is deleted', async () => {
      const filePath = path.join(tmpDir, 'removable.yaml');
      await writeFile(filePath, `
id: removable
destinations:
  - id: dest1
    type: http
    url: http://example.com
`);
      const loader = new PipelineLoader(tmpDir, { watch: true });
      await loader.loadAll();
      await loader.startWatching();

      expect(loader.get('removable')).toBeDefined();


      await unlink(filePath);

      await new Promise((resolve) => {
        loader.once('removed', resolve);
        setTimeout(resolve, 3000);
      });

      expect(loader.get('removable')).toBeUndefined();
      loader.stopWatching();
    });
  });
});

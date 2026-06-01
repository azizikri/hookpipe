import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const cli = path.join(projectRoot, 'src/cli/index.js');

function run(args, env = {}) {
  const result = execSync(`node ${cli} ${args}`, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    timeout: 10000,
  });
  return result.trim();
}

function runWithError(args, env = {}) {
  try {
    execSync(`node ${cli} ${args}`, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stderr: err.stderr?.trim() || err.stdout?.trim() || '' };
  }
}

describe('CLI end-to-end', () => {
  describe('hookpipe test', () => {
    it('dry-runs a webhook through the example pipeline with --skip-auth', () => {
      const payload = JSON.stringify({
        ref: 'refs/heads/main',
        pusher: { name: 'testuser' },
        commits: [{ id: 'abc1234', message: 'feat: test', author: { name: 'testuser' } }],
        repository: { full_name: 'org/repo' },
        compare: 'https://github.com/org/repo/compare/a...b',
      });

      const output = run(
        `test github-push --data '${payload}' --skip-auth`,
        { HOOKPIPE_PIPELINES_DIR: './pipelines', HOOKPIPE_PLUGINS_DIR: './plugins' }
      );

      const result = JSON.parse(output);
      expect(result.pipeline).toBe('github-push');
      expect(result.steps.auth.status).toBe('skipped');
      expect(result.steps.filter.status).toBe('pass');
      expect(result.steps.transform.after.branch).toBe('main');
      expect(result.steps.transform.after.pusher).toBe('testuser');
      expect(result.steps.destinations).toHaveLength(1);
      expect(result.steps.destinations[0].method).toBe('POST');
    });

    it('filter drops non-main branches', () => {
      const payload = JSON.stringify({
        ref: 'refs/heads/feature/xyz',
        pusher: { name: 'testuser' },
        commits: [],
        repository: { full_name: 'org/repo' },
      });

      const output = run(
        `test github-push --data '${payload}' --skip-auth`,
        { HOOKPIPE_PIPELINES_DIR: './pipelines', HOOKPIPE_PLUGINS_DIR: './plugins' }
      );

      const result = JSON.parse(output);
      expect(result.steps.filter.status).toBe('drop');
      expect(result.steps.filter.reason).toContain('feature/xyz');
    });

    it('errors on unknown pipeline', () => {
      const { exitCode, stderr } = runWithError(
        'test nonexistent --data \'{}\'',
        { HOOKPIPE_PIPELINES_DIR: './pipelines', HOOKPIPE_PLUGINS_DIR: './plugins' }
      );
      expect(exitCode).not.toBe(0);
    });
  });

  describe('hookpipe logs', () => {
    it('returns empty results with --json', () => {
      const output = run('logs --limit 1 --json');
      expect(JSON.parse(output)).toEqual([]);
    });

    it('returns formatted message when no logs', () => {
      const output = run('logs --limit 1');
      expect(output).toContain('No delivery logs found');
    });
  });

  describe('hookpipe replay', () => {
    it('errors on unknown delivery ID', () => {
      const { exitCode } = runWithError('replay unknown-id --dry-run');
      expect(exitCode).not.toBe(0);
    });
  });
});

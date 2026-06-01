import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const formatPush = require('../../plugins/examples/github/format-push.cjs');
const filterBranch = require('../../plugins/examples/github/filter-branch.cjs');

const PUSH_PAYLOAD = {
  ref: 'refs/heads/main',
  pusher: { name: 'octocat' },
  commits: [
    { id: 'abc1234567890', message: 'feat: add login\n\nDetailed description', author: { name: 'octocat' } },
    { id: 'def4567890123', message: 'fix: typo', author: { name: 'contributor' } },
  ],
  repository: { full_name: 'octocat/hello-world' },
  compare: 'https://github.com/octocat/hello-world/compare/abc123...def456',
};

describe('format-push transform plugin', () => {
  it('produces expected shape from GitHub push payload', () => {
    const result = formatPush.transform(PUSH_PAYLOAD, {}, {});

    expect(result).toEqual({
      repository: 'octocat/hello-world',
      branch: 'main',
      pusher: 'octocat',
      commit_count: 2,
      commits: [
        { id: 'abc1234', message: 'feat: add login', author: 'octocat' },
        { id: 'def4567', message: 'fix: typo', author: 'contributor' },
      ],
      compare_url: 'https://github.com/octocat/hello-world/compare/abc123...def456',
    });
  });

  it('handles missing fields gracefully', () => {
    const result = formatPush.transform({}, {}, {});

    expect(result).toEqual({
      repository: 'unknown',
      branch: 'unknown',
      pusher: 'unknown',
      commit_count: 0,
      commits: [],
      compare_url: null,
    });
  });
});

describe('filter-branch filter plugin', () => {
  it('passes main branch with default config', () => {
    const result = filterBranch.filter({ ref: 'refs/heads/main' }, {}, {});
    expect(result).toEqual({ pass: true });
  });

  it('passes release/1.0 with wildcard pattern', () => {
    const result = filterBranch.filter(
      { ref: 'refs/heads/release/1.0' },
      {},
      { branches: ['main', 'release/*'] }
    );
    expect(result).toEqual({ pass: true });
  });

  it('blocks feature/xyz branch', () => {
    const result = filterBranch.filter({ ref: 'refs/heads/feature/xyz' }, {}, {});
    expect(result).toEqual({
      pass: false,
      reason: "Branch 'feature/xyz' not in allowed list: main",
    });
  });
});

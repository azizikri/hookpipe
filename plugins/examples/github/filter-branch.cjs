// Filter plugin: only pass events for configured branches
module.exports.filter = function(payload, headers, config) {
  const ref = payload.ref || '';
  const branch = ref.replace('refs/heads/', '');
  const allowedBranches = config?.branches || ['main'];

  // Support glob-like patterns (e.g., 'release/*')
  const matches = allowedBranches.some(pattern => {
    if (pattern.includes('*')) {
      const prefix = pattern.replace('*', '');
      return branch.startsWith(prefix);
    }
    return branch === pattern;
  });

  if (!matches) {
    return { pass: false, reason: `Branch '${branch}' not in allowed list: ${allowedBranches.join(', ')}` };
  }
  return { pass: true };
};

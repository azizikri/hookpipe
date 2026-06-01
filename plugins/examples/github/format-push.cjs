// Transform plugin: formats GitHub push payload for notifications
module.exports.transform = function(payload, headers, config) {
  const { ref, pusher, commits, repository, compare } = payload;
  const branch = ref ? ref.replace('refs/heads/', '') : 'unknown';
  return {
    repository: repository?.full_name || 'unknown',
    branch,
    pusher: pusher?.name || 'unknown',
    commit_count: commits?.length || 0,
    commits: (commits || []).slice(0, 5).map(c => ({
      id: c.id?.substring(0, 7),
      message: c.message?.split('\n')[0],
      author: c.author?.name
    })),
    compare_url: compare || null
  };
};

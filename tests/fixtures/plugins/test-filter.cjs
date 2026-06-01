module.exports.filter = function(payload, headers, config) {
  if (payload.action === 'ignore') return { pass: false, reason: 'Action is ignore' };
  return { pass: true };
};

module.exports.transform = function(payload, headers, config) {
  return { ...payload, transformed: true, by: config?.name || 'test' };
};

const deepMerge = require('deepmerge');

const uiConfig = require('./tailwind.config.cjs');

function wrapper(tailwindConfig) {
  return deepMerge({ ...tailwindConfig }, uiConfig);
}

module.exports = wrapper;

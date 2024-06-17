const deepMerge = require('deepmerge');

const uiConfig = require('./tailwind.config');

function wrapper(tailwindConfig) {
  return deepMerge({ ...tailwindConfig }, uiConfig);
}

module.exports = wrapper;

const CopyPlugin = require('copy-webpack-plugin');

module.exports = function (options) {
  return {
    ...options,
    plugins: [
      new CopyPlugin({
        patterns: [{ from: 'src/features/mail-sender/templates', to: 'templates' }],
      }),
    ],
  };
};

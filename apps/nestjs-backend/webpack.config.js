const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const glob = require('glob');

module.exports = function (options) {
  const workerFiles = glob.sync(path.join(__dirname, 'src/worker/**.ts'));
  const workerEntries = workerFiles.reduce((acc, file) => {
    const relativePath = path.relative(path.join(__dirname, 'src/worker'), file);
    const entryName = `worker/${path.dirname(relativePath)}/${path.basename(relativePath, '.ts')}`;
    acc[entryName] = file;
    return acc;
  }, {});

  return {
    ...options,
    entry: {
      index: options.entry,
      ...workerEntries,
    },
    output: {
      path: path.join(__dirname, 'dist'),
      filename: '[name].js',
    },
    plugins: [
      new CopyPlugin({
        patterns: [{ from: 'src/features/mail-sender/templates', to: 'templates' }],
      }),
    ],
  };
};

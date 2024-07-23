const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const glob = require('glob');

module.exports = function (options) {
  const workerFiles = glob.sync(path.join(__dirname, 'src/worker/**.ts'));

  return {
    ...options,
    entry: {
      index: options.entry,
      worker: workerFiles,
    },
    output: {
      path: path.join(__dirname, 'dist'),
      filename: (pathData) => {
        if (pathData.chunk.name === 'worker') {
          return 'worker/[name].js';
        }
        return '[name]-[hash].js';
      },
    },
    optimization: {
      ...options.optimization,
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          workers: {
            test: /[\\/]worker[\\/]/,
            name(module) {
              const matchedPath = module.resource.match(/[\\/]worker[\\/](.*?)\.(ts|js)$/);
              return matchedPath ? `worker/${matchedPath[1]}` : 'worker/unknown';
            },
            enforce: true,
          },
        },
      },
    },
    plugins: [
      new CopyPlugin({
        patterns: [{ from: 'src/features/mail-sender/templates', to: 'templates' }],
      }),
    ],
  };
};

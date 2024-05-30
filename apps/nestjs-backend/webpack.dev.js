const CopyPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    mode: 'development',
    devtool: 'source-map',
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100', /^@teable/],
      }),
    ],
    // ignore tests hot reload
    watchOptions: {
      ignored: ['**/test/**', '**/*.spec.ts', '**/node_modules/**'],
      poll: 1000,
    },
    module: {
      rules: [
        {
          test: /\.ts?$/,
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            happyPackMode: true,
          },
          exclude: [/node_modules/, /.e2e-spec.ts$/],
        },
      ],
    },
    cache: {
      type: 'filesystem',
      allowCollectingMemory: true,
      buildDependencies: {
        // This makes all dependencies of this file - build dependencies
        config: [__filename],
      },
    },
    plugins: [
      // filter default ForkTsCheckerWebpackPlugin to rewrite the ts config file path
      // nest default tsconfig path is tsconfig.build.json
      ...options.plugins.filter((plugin) => !(plugin instanceof ForkTsCheckerWebpackPlugin)),
      new webpack.HotModuleReplacementPlugin(),
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          configFile: 'tsconfig.json',
        },
      }),
      new CopyPlugin({
        patterns: [{ from: 'src/features/mail-sender/templates', to: 'templates' }],
      }),
    ],
  };
};

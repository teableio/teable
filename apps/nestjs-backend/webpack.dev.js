const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options, webpack) {
  return {
    ...options,
    entry: ['webpack/hot/poll?100', options.entry],
    mode: 'development',
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100', /^@teable-group/],
      }),
    ],
    module: {
      rules: [
        {
          test: /\.ts?$/,
          use: ['cache-loader', 'ts-loader'],
          exclude: /node_modules/,
        },
      ],
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
    ],
  };
};

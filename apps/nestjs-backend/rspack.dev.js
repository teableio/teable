const path = require('path');
const { rspack } = require('@rspack/core');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const nodeExternals = require('webpack-node-externals');
const {
  collectWorkerEntries,
  withSourceConditions,
  withLenientExportsPresence,
  mailTemplatePatterns,
  esmExtensionAlias,
  createImportMetaShim,
} = require('./rspack.shared');

module.exports = function (options) {
  return {
    ...options,
    entry: {
      index: ['@rspack/core/hot/poll?100', options.entry],
      ...collectWorkerEntries(),
    },
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    output: {
      path: path.join(__dirname, 'dist'),
      filename: '[name].js',
    },
    module: withLenientExportsPresence(options.module),
    externals: [
      nodeExternals({
        allowlist: ['@rspack/core/hot/poll?100', /^@teable/],
      }),
    ],
    // ignore tests hot reload
    watchOptions: {
      ignored: [
        '**/test/**',
        '**/*.spec.ts',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/i18n.generated.ts',
      ],
      aggregateTimeout: 200,
    },
    cache: {
      type: 'persistent',
      buildDependencies: [__filename],
      storage: { directory: path.resolve(__dirname, '.rspack-cache') },
    },
    plugins: [
      createImportMetaShim(rspack),
      // filter default ForkTsCheckerWebpackPlugin to rewrite the ts config file path
      // nest default tsconfig path is tsconfig.build.json
      ...options.plugins.filter((plugin) => !(plugin instanceof ForkTsCheckerWebpackPlugin)),
      new rspack.HotModuleReplacementPlugin(),
      new ForkTsCheckerWebpackPlugin({
        typescript: {
          configFile: 'tsconfig.json',
          memoryLimit: 4096,
        },
      }),
      new rspack.CopyRspackPlugin({ patterns: mailTemplatePatterns }),
    ],
    resolve: {
      ...options.resolve,
      extensionAlias: { ...(options.resolve?.extensionAlias ?? {}), ...esmExtensionAlias },
      conditionNames: withSourceConditions(options.resolve?.conditionNames),
      tsConfig: path.resolve(__dirname, 'tsconfig.json'),
      plugins: [],
    },
  };
};

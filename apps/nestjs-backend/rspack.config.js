const path = require('path');
const { rspack } = require('@rspack/core');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
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
      index: options.entry,
      ...collectWorkerEntries(),
    },
    output: {
      path: path.join(__dirname, 'dist'),
      filename: '[name].js',
    },
    module: withLenientExportsPresence(options.module),
    plugins: [
      createImportMetaShim(rspack),
      // Keep Nest's defaults (IgnorePlugin for optional peers) but give the type checker the
      // memory this program needs; the 2 GB default aborts.
      // NEST_BUILD_TYPE_CHECK=0 skips it for a transpile-only build (what the Docker image
      // build does, as the webpack build was transpile-only too); CI type-checks separately.
      ...options.plugins.filter((plugin) => !(plugin instanceof ForkTsCheckerWebpackPlugin)),
      ...(process.env.NEST_BUILD_TYPE_CHECK === '0'
        ? []
        : [
            new ForkTsCheckerWebpackPlugin({
              typescript: { configFile: 'tsconfig.build.json', memoryLimit: 6144 },
            }),
          ]),
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

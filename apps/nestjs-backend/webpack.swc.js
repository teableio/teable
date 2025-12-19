const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const glob = require('glob');
const nodeExternals = require('webpack-node-externals');

module.exports = function (options, webpack) {
  const workerFiles = glob.sync(path.join(__dirname, 'src/worker/**.ts'));
  const workerEntries = workerFiles.reduce((acc, file) => {
    const relativePath = path.relative(path.join(__dirname, 'src/worker'), file);
    const entryName = `worker/${path.dirname(relativePath)}/${path.basename(relativePath, '.ts')}`;
    acc[entryName] = file;
    return acc;
  }, {});

  return {
    ...options,
    resolve: {
      ...options.resolve,
      conditionNames: (() => {
        const base = options.resolve?.conditionNames ?? ['require', 'node', 'default'];
        if (base.includes('import')) return base;
        const next = [...base];
        const defaultIndex = next.indexOf('default');
        if (defaultIndex === -1) {
          next.push('import');
        } else {
          next.splice(defaultIndex, 0, 'import');
        }
        return next;
      })(),
    },
    entry: {
      index: ['webpack/hot/poll?100', options.entry],
      ...workerEntries,
    },
    output: {
      path: path.join(__dirname, 'dist'),
      filename: '[name].js',
    },
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    externals: [
      nodeExternals({
        allowlist: ['webpack/hot/poll?100', /^@teable/, /^@orpc/],
      }),
    ],
    // ignore tests hot reload
    watchOptions: {
      ignored: ['**/test/**', '**/*.spec.ts', '**/node_modules/**', '**/*.d.ts'],
      poll: false,
      aggregateTimeout: 200,
    },
    module: {
      rules: [
        {
          test: /\.ts?$/,
          exclude: [/node_modules/, /.e2e-spec.ts$/],
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: {
                  syntax: 'typescript',
                  tsx: false,
                  decorators: true,
                  dynamicImport: true,
                },
                transform: {
                  legacyDecorator: true,
                  decoratorMetadata: true,
                },
                target: 'es2020',
                keepClassNames: true,
                loose: false,
              },
              module: {
                type: 'commonjs',
                strict: false,
                strictMode: true,
                lazy: false,
                noInterop: false,
              },
              sourceMaps: 'inline',
            },
          },
        },
      ],
    },
    cache: {
      type: 'filesystem',
      allowCollectingMemory: true,
      maxMemoryGenerations: 1,
      buildDependencies: {
        config: [__filename],
      },
      cacheDirectory: path.resolve(__dirname, '.webpack-cache'),
    },
    plugins: [
      // filter default ForkTsCheckerWebpackPlugin to disable type checking for faster builds
      ...options.plugins.filter((plugin) => !(plugin instanceof ForkTsCheckerWebpackPlugin)),
      new webpack.HotModuleReplacementPlugin(),
      new CopyPlugin({
        patterns: [{ from: 'src/features/mail-sender/templates', to: 'templates' }],
      }),
    ],
  };
};

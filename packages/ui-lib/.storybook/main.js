const path = require('path');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

module.exports = {
  framework: '@storybook/react-webpack5',
  core: {
    builder: {
      name: 'webpack5',
      options: {
        fsCache: true,
      },
    },
  },
  // Keep react 17 render, till mdx 2 is fully supported
  // - https://github.com/mdx-js/mdx/issues/1945
  // - https://github.com/storybookjs/storybook/issues/18094
  // @link https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#react18-new-root-api
  reactOptions: { legacyRootApi: true },
  stories: ['../src/**/*.stories.@(ts|tsx|js|jsx)'],
  babel: (config) => {
    // config.presets.push(require.resolve('@emotion/babel-preset-css-prop'));
    return config;
  },
  webpackFinal: async (config) => {
    config.resolve.plugins = config.resolve.plugins || [];
    config.resolve.plugins.push(
      new TsconfigPathsPlugin({
        configFile: path.resolve(__dirname, '../tsconfig.json'),
      })
    );
    config.resolve.extensions = Array.from(
      new Set([...(config.resolve.extensions || []), '.ts', '.tsx'])
    );
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.cache/**'],
    };
    config.module.rules.push({
      test: /\.(ts|tsx)$/,
      include: path.resolve(__dirname, '../src'),
      use: [
        {
          loader: require.resolve('babel-loader'),
          options: {
            presets: [
              [require.resolve('@babel/preset-react'), { runtime: 'automatic' }],
              require.resolve('@babel/preset-typescript'),
            ],
          },
        },
      ],
    });
    return config;
  },
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    {
      name: '@storybook/addon-postcss',
      options: {
        postcssLoaderOptions: {
          implementation: require('postcss'),
        },
      },
    },
  ],
};

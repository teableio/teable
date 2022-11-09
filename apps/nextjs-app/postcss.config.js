// Customized postcss
// @link https://nextjs.org/docs/advanced-features/customizing-postcss-config
// @link https://tailwindcss.com/docs/using-with-preprocessors

const isProd = process.env.NODE_ENV === 'production';
const supportsIE11 = false;
const enableCssGrid = false;
const path = require('path');

module.exports = {
  plugins: {
    tailwindcss: {
      config: path.join(__dirname, 'tailwind.config.js'),
    },
    ...(isProd
      ? {
          'postcss-flexbugs-fixes': {},
          'postcss-preset-env': {
            autoprefixer: {
              flexbox: 'no-2009',
              // https://github.com/postcss/autoprefixer#does-autoprefixer-polyfill-grid-layout-for-ie
              ...(enableCssGrid
                ? {
                    grid: 'autoplace',
                  }
                : {}),
            },
            stage: 3,
            features: {
              'custom-properties': supportsIE11,
            },
          },
        }
      : {}),
  },
};

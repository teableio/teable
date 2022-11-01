// Customized postcss
// @link https://nextjs.org/docs/advanced-features/customizing-postcss-config
// @link https://tailwindcss.com/docs/using-with-preprocessors

const isProd = process.env.NODE_ENV === 'production';
const supportsIE11 = false;
const enableCssGrid = false;

module.exports = {
  plugins: {
    tailwindcss: {},
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

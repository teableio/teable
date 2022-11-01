const tailwindColors = require('tailwindcss/colors');
const defaultTheme = require('tailwindcss/defaultTheme');

/**
 * Return tailwind v3 non-deprecated colors
 * PS: code is dirty cause tailwind colors have getters on them
 *     that will log a warning when accessing the object key
 * @type {Record<string, string | Record<string, string>>}
 */
const tailwindV3Colors = Object.entries(
  Object.getOwnPropertyDescriptors(tailwindColors)
)
  .filter(
    ([, desc]) =>
      Object.prototype.hasOwnProperty.call(desc, 'value') &&
      typeof desc.value !== 'function'
  )
  .reduce((acc, [key]) => {
    if (
      !['coolGray', 'lightBlue', 'warmGray', 'trueGray', 'blueGray'].includes(
        key
      )
    ) {
      acc[key] = tailwindColors[key];
    }
    return acc;
  }, {});

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      ...defaultTheme.screens,
    },
    colors: {
      ...tailwindV3Colors,
      bermuda: '#78dcca',
      tahiti: {
        100: '#cffafe',
        200: '#a5f3fc',
        300: '#67e8f9',
        400: '#22d3ee',
        500: '#06b6d4',
        600: '#0891b2',
        700: '#0e7490',
        800: '#155e75',
        900: '#164e63',
      },
    },
    fontFamily: {
      sans: ['Inter', ...defaultTheme.fontFamily.sans],
      serif: [...defaultTheme.fontFamily.serif],
      mono: [...defaultTheme.fontFamily.mono],
    },
    extend: {
      /**
       spacing: {
        128: '32rem',
      },
       */
    },
  },
  plugins: [
    require('@tailwindcss/line-clamp'),
    require('@tailwindcss/aspect-ratio'),
  ],
};

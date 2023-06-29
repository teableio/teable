const { merge } = require('lodash');
const { join } = require('path');
const shadcnuiConfig = require('./tailwind.shadcnui.config');

const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [filePath],
  darkMode: ['class'],
  theme: merge({}, shadcnuiConfig.theme),
  plugins: [...shadcnuiConfig.plugins],
};

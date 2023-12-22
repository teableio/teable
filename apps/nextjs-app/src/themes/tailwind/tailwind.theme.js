// @ts-check
// Keep this file as '.js' as it's included in tailwind.config.js

const { browserFonts } = require('../shared/browser-fonts');

module.exports = {
  fontFamily: {
    sans: ['Inter Variable', ...browserFonts.sans],
  },
};

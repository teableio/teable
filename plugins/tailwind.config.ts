import type { Config } from 'tailwindcss';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const uiConfig = require('@teable/sdk/ui.config.cjs');

const config: Config = uiConfig({
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  plugins: [],
});
export default config;

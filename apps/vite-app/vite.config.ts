import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const testFiles = ['./src/**/*.test.{js,jsx,ts,tsx}'];

export default defineConfig({
  plugins: [
    react({
      jsxImportSource: '@emotion/react',
      babel: {
        plugins: ['@emotion/babel-plugin'],
      },
    }),
    tsconfigPaths(),
    svgr({
      // Set it to `true` to export React component as default.
      // Notice that it will override the default behavior of Vite.
      exportAsDefault: true,
      // svgr options: https://react-svgr.com/docs/options/
      svgrOptions: {},
    }),
  ],
  test: {
    globals: true,
    environment: 'happy-dom',
    passWithNoTests: true,
    cache: {
      dir: '../../.cache/vitest/vite-app',
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'clover'],
      extension: ['js', 'jsx', 'ts', 'tsx'],
    },
    include: testFiles,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});

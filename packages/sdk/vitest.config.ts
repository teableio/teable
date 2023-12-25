import react from '@vitejs/plugin-react-swc';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,jsx,ts,tsx}'];
export default defineConfig({
  plugins: [
    react({
      devTarget: 'es2022',
    }),
    tsconfigPaths(),
    svgr({
      // svgr options: https://react-svgr.com/docs/options/
      svgrOptions: {},
    }),
  ],
  test: {
    globals: true,
    environment: 'happy-dom',
    typecheck: {
      enabled: false,
    },
    passWithNoTests: false,
    setupFiles: './config/tests/setupVitest.ts',
    cache: {
      dir: '../../.cache/vitest/sdk',
    },
    coverage: {
      provider: 'v8',
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

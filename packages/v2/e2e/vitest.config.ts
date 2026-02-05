/* eslint-disable @typescript-eslint/naming-convention */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, configDefaults } from 'vitest/config';

const testFiles = ['./src/**/*.{test,spec}.{js,ts}'];
const rootDir = dirname(fileURLToPath(import.meta.url));

// V2 packages to collect coverage from during e2e tests
const v2PackagesForCoverage = [
  'core',
  'formula-sql-pg',
  'adapter-repository-postgres',
  'adapter-table-repository-postgres',
  'container-node',
  'container-node-test',
  'field-dependency-core',
  'utils',
];

// Package names for Vite to inline (so V8 can track coverage)
const v2PackageNames = v2PackagesForCoverage.map((pkg) => `@teable/v2-${pkg.replace(/-/g, '-')}`);

// Resolve absolute paths for coverage includes (construct glob pattern correctly)
const v2CoverageIncludes = v2PackagesForCoverage.map(
  (pkg) => `${resolve(rootDir, '..', pkg, 'src')}/**/*`
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@teable/formula': resolve(rootDir, '../../formula/src/index.ts'),
    },
  },
  cacheDir: '../../../.cache/vitest/v2-e2e',
  // Inline v2 packages so Vite transforms them (helps with source map accuracy)
  server: {
    deps: {
      inline: v2PackageNames,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    passWithNoTests: true,
    setupFiles: ['./src/shared/vitest.setup.ts'],
    typecheck: {
      enabled: false,
    },
    pool: 'forks',
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // Only report coverage for files actually imported during tests
      // (avoids Rollup parse errors on TypeScript-only syntax like `import type`)
      all: false,
      // Allow coverage collection from files outside the e2e package (other v2 packages)
      allowExternal: true,
      // Include both e2e test code and v2 packages being tested (using absolute paths)
      include: [`${resolve(rootDir, 'src')}/**/*`, ...v2CoverageIncludes],
      // Exclude test files and non-code files from coverage
      exclude: [
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/testkit/**',
        '**/test/**',
        '**/__tests__/**',
        '**/*.md',
      ],
      // Generate reports in multiple formats
      reporter: ['text', 'json', 'lcov', 'html'],
      // Output directory for coverage reports
      reportsDirectory: './coverage',
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    include: testFiles,
    exclude: [...configDefaults.exclude, '**/.next/**'],
  },
});

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Compiles the embedded-PGlite single-file binary. PGlite's wasm/data assets are
 * resolved from the installed package and embedded into the executable, so the
 * binary does not need `pglite.wasm` or `pglite.data` beside it at runtime.
 */
const require = createRequire(import.meta.url);
const packageDir = path.resolve(import.meta.dirname, '..');
const pgliteAdapterDir = path.resolve(packageDir, '..', 'adapter-db-postgres-pglite');

const pgliteEntry = require.resolve('@electric-sql/pglite', { paths: [pgliteAdapterDir] });
const pgliteDistDir = path.dirname(pgliteEntry);
const assets = ['pglite.wasm', 'pglite.data'].map((name) => path.join(pgliteDistDir, name));

for (const asset of assets) {
  if (!existsSync(asset)) {
    throw new Error(`Missing PGlite asset: ${asset}`);
  }
}

const result = spawnSync(
  'bun',
  [
    'build',
    '--compile',
    path.join(packageDir, 'bin', 'teable-headless-pglite.cjs'),
    '--outfile',
    path.join(packageDir, 'dist', 'teable-headless-pglite'),
    ...assets.flatMap((asset) => ['--asset', asset]),
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);

import type { IHeadlessRuntimeBackend } from '@teable/v2-headless-runtime';

import { runHeadlessCli } from './cli-main';
import { loadEmbeddedPgliteAssets } from './embedded-pglite-assets';
import { resolveBackendFromEnv } from './index';

/**
 * PGlite backend for the single-file binary. The wasm module and Postgres data
 * bundle are read from the executable itself, so no `pglite.wasm`/`pglite.data`
 * files need to sit beside the binary.
 */
export const resolveEmbeddedPgliteBackend = async (
  env: NodeJS.ProcessEnv
): Promise<IHeadlessRuntimeBackend> => {
  const dataDir = env.TEABLE_PGLITE_DIR;
  if (!dataDir) {
    return resolveBackendFromEnv(env);
  }

  const { wasmModule, fsBundle } = await loadEmbeddedPgliteAssets();
  return {
    kind: 'pglite',
    dataDir,
    pglite: { wasmModule, fsBundle },
    bootstrap: env.TEABLE_BOOTSTRAP !== 'false',
  };
};

export const runEmbeddedPgliteCli = async (): Promise<void> => {
  await runHeadlessCli({ resolveBackend: resolveEmbeddedPgliteBackend });
};

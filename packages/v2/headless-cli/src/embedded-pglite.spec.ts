import { describe, expect, it, vi } from 'vitest';

vi.mock('./embedded-pglite-assets', () => ({
  loadEmbeddedPgliteAssets: vi.fn(),
}));

import { resolveEmbeddedPgliteBackend } from './embedded-pglite';
import { loadEmbeddedPgliteAssets } from './embedded-pglite-assets';

describe('resolveEmbeddedPgliteBackend', () => {
  it('forwards the embedded wasm module and data bundle to the PGlite backend', async () => {
    const wasmModule = new WebAssembly.Module(
      new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    );
    const fsBundle = new Blob(['pglite-data']);
    vi.mocked(loadEmbeddedPgliteAssets).mockResolvedValue({ wasmModule, fsBundle });

    const backend = await resolveEmbeddedPgliteBackend({ TEABLE_PGLITE_DIR: '/tmp/pglite' });

    expect(backend).toEqual({
      kind: 'pglite',
      dataDir: '/tmp/pglite',
      pglite: { wasmModule, fsBundle },
      bootstrap: true,
    });
  });

  it('falls back to environment resolution when TEABLE_PGLITE_DIR is absent', async () => {
    await expect(resolveEmbeddedPgliteBackend({})).rejects.toThrow('Set TEABLE_PGLITE_DIR');
    expect(loadEmbeddedPgliteAssets).not.toHaveBeenCalled();
  });
});

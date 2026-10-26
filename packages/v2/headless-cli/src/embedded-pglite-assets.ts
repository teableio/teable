/**
 * PGlite ships `pglite.wasm` and `pglite.data` next to its JS entry point and
 * loads them with `new URL(..., import.meta.url)`. That lookup cannot work from
 * a single-file Bun binary, so the PGlite flavor embeds both files with
 * `bun build --compile --asset <file>` and hands them to PGlite explicitly.
 */
export interface IEmbeddedPgliteAssets {
  wasmModule: WebAssembly.Module;
  fsBundle: Blob;
}

const PGLITE_WASM_ASSET = 'pglite.wasm';
const PGLITE_DATA_ASSET = 'pglite.data';

interface IEmbeddedFile extends Blob {
  readonly name: string;
}

const isEmbeddedFile = (value: unknown): value is IEmbeddedFile =>
  value instanceof Blob && 'name' in value && typeof value.name === 'string';

const getEmbeddedFiles = (): IEmbeddedFile[] => {
  const runtime: unknown = globalThis;
  if (typeof runtime !== 'object' || runtime === null || !('Bun' in runtime)) {
    return [];
  }
  const bun: unknown = runtime.Bun;
  if (typeof bun !== 'object' || bun === null || !('embeddedFiles' in bun)) {
    return [];
  }
  const { embeddedFiles } = bun;
  return Array.isArray(embeddedFiles) ? embeddedFiles.filter(isEmbeddedFile) : [];
};

export const loadEmbeddedPgliteAssets = async (): Promise<IEmbeddedPgliteAssets> => {
  const files = getEmbeddedFiles();
  const wasm = files.find((file) => file.name === PGLITE_WASM_ASSET);
  const data = files.find((file) => file.name === PGLITE_DATA_ASSET);

  if (!wasm || !data) {
    throw new Error(
      `Embedded PGlite assets are missing (${PGLITE_WASM_ASSET}, ${PGLITE_DATA_ASSET}). ` +
        'Build this entry with `pnpm build:bun:pglite` so Bun embeds them.'
    );
  }

  return {
    wasmModule: await WebAssembly.compile(await wasm.arrayBuffer()),
    fsBundle: data,
  };
};

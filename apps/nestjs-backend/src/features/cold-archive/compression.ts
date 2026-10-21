import * as zlib from 'node:zlib';

const zlibWithZstd = zlib as typeof zlib & {
  createZstdCompress?: (options?: unknown) => zlib.Gzip;
  createZstdDecompress?: (options?: unknown) => zlib.Gunzip;
};

export const hasZstd = typeof zlibWithZstd.createZstdCompress === 'function';

/**
 * Writing prefers zstd when the runtime has it (node >= 22.15); reading always
 * handles both formats. A `.zst` KEY still needs a zstd-capable reader, so a
 * fleet on mixed node versions forces gzip through the subsystem's
 * `..._COMPRESSION=gzip`.
 *
 * `envName` is a parameter so each subsystem keeps its own variable, and the
 * read stays per call: env files may load after module evaluation.
 */
const writeZstd = (envName: string) => hasZstd && process.env[envName] !== 'gzip';

export const partFileSuffixFor = (envName: string) =>
  writeZstd(envName) ? '.ndjson.zst' : '.ndjson.gz';

export const createPartCompressorFor = (envName: string) => {
  if (writeZstd(envName)) {
    return zlibWithZstd.createZstdCompress!({
      params: {
        [zlib.constants.ZSTD_c_compressionLevel]: 3,
      },
    });
  }
  return zlib.createGzip({ level: 6 });
};

export const createPartDecompressor = (key: string) => {
  if (key.endsWith('.zst')) {
    if (!hasZstd) {
      throw new Error(`cannot decompress ${key}: node runtime lacks zstd support`);
    }
    return zlibWithZstd.createZstdDecompress!();
  }
  return zlib.createGunzip();
};

import { createHash } from 'node:crypto';

import type { AppBundleChecksums } from './schema';

export interface IBundleSectionFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export const sha256Hex = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

const comparePaths = (left: IBundleSectionFile, right: IBundleSectionFile): number => {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
};

/**
 * Deterministic section digest. Files are sorted by archive path and hashed as
 * `path "\0" sha256(bytes) "\n"`. An empty section hashes to sha256 of "".
 */
export const checksumSection = (files: ReadonlyArray<IBundleSectionFile>): string => {
  const hash = createHash('sha256');
  for (const file of [...files].sort(comparePaths)) {
    hash.update(file.path, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(sha256Hex(file.bytes), 'utf8');
    hash.update('\n', 'utf8');
  }
  return hash.digest('hex');
};

/**
 * Stable identity of the bundle payload. The install table stores this value so
 * that re-uploading the same `version` with different content is rejected while
 * a rebuilt-but-identical bundle stays idempotent.
 */
export const computeBundleChecksum = (checksums: AppBundleChecksums): string =>
  sha256Hex(
    `structure:${checksums.structure}\nseed:${checksums.seed}\nmigrations:${checksums.migrations}\n`
  );

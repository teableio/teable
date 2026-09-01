import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { createPartDecompressor } from './compression';
import { iterateNdjsonLines } from './ndjson';

export interface IPartFooter {
  t: 'f';
  rows: number;
  sha256: string;
}

export const serializeFooter = (rows: number, sha256: string): string =>
  JSON.stringify({ t: 'f', rows, sha256 } satisfies IPartFooter);

export const createRowHasher = () => {
  const hash = createHash('sha256');
  return {
    update(rowLine: string) {
      hash.update(rowLine);
      hash.update('\n');
    },
    digest() {
      return hash.digest('hex');
    },
  };
};

const parsePartLine = <TRow>(
  line: string
): { header?: unknown; footer?: IPartFooter; row?: TRow; raw: string } | undefined => {
  if (!line) return undefined;
  const value = JSON.parse(line) as { t?: string };
  if (value.t === 'h') return { header: value, raw: line };
  if (value.t === 'f') return { footer: value as IPartFooter, raw: line };
  return { row: value as unknown as TRow, raw: line };
};

/**
 * Stream-decode a compressed part into rows: download stream → decompressor →
 * NDJSON line splitter, so memory stays O(line) however large the part is. The
 * caller may stop early by breaking out of the async iterator.
 */
export async function* decodePartRows<TRow>(
  key: string,
  compressed: Readable
): AsyncGenerator<{ row?: TRow; footer?: IPartFooter; rowLine?: string }> {
  const decompressor = createPartDecompressor(key);
  // a bare zlib error names no part and is undebuggable
  decompressor.on('error', (error: Error & { partKey?: string }) => {
    error.partKey = key;
    error.message = `${error.message} (part ${key})`;
  });
  try {
    for await (const line of iterateNdjsonLines(compressed.pipe(decompressor))) {
      const parsed = parsePartLine<TRow>(line);
      if (!parsed) continue;
      if (parsed.header) continue;
      if (parsed.footer) {
        yield { footer: parsed.footer };
        continue;
      }
      yield { row: parsed.row, rowLine: parsed.raw };
    }
  } finally {
    compressed.destroy();
  }
}

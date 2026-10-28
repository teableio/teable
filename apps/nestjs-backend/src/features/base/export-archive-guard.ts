import { Stream } from 'node:stream';
import type { PassThrough, Readable } from 'node:stream';
import type archiver from 'archiver';

/**
 * Level 6 is zlib's default: level 9 costs far more CPU on multi-GB CSVs for a
 * marginally smaller file.
 */
export const EXPORT_ZIP_OPTIONS: archiver.ArchiverOptions = { zlib: { level: 6 } };

export interface IExportArchiveGuard {
  /** Races `work` against the first export failure, so callers never wait on a dead archive. */
  run<T>(work: Promise<T>): Promise<T>;
  fail(error: unknown): void;
}

/**
 * archiver never settles `finalize()` when an entry source errors or closes early, or
 * when its output is gone (e.g. the S3 upload failed and destroyed it). The export then
 * hung forever: no failure notification, and SSE heartbeats kept the client waiting.
 *
 * The guard wraps `archive.append` so every entry source is watched. The first failure
 * rejects `run()`, aborts the archive, destroys pending sources (stopping their DB reads)
 * and the output, and makes later `append` calls throw so remaining export work unwinds.
 *
 * Every entry is deflated, including already-compressed formats. A stored (uncompressed)
 * entry written from a stream gets a data descriptor, and importers that stream-parse the
 * .tea find its end by scanning for the descriptor signature, which zip-based formats
 * (docx/pptx/xlsx/zip) contain in their own bytes, so the import read past the entry.
 */
export const guardExportArchive = (
  archive: archiver.Archiver,
  output: PassThrough
): IExportArchiveGuard => {
  const sources = new Set<Readable>();
  let failure: Error | undefined;
  let rejectFailed!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    rejectFailed = reject;
  });
  // Observed through run(); this keeps an unobserved failure from being "unhandled".
  failed.catch(() => undefined);

  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    rejectFailed(failure);
    archive.abort();
    for (const source of sources) {
      source.destroy(failure);
    }
    sources.clear();
    output.destroy(failure);
  };

  const watchSource = (source: Readable, name: string) => {
    sources.add(source);
    source.on('error', (error: Error) => {
      fail(new Error(`Export entry ${name} failed: ${error.message}`));
    });
    source.once('close', () => {
      sources.delete(source);
      if (!source.readableEnded) {
        fail(new Error(`Export entry ${name} closed before it finished`));
      }
    });
  };

  const append = archive.append.bind(archive);
  archive.append = ((source, data) => {
    if (failure) throw failure;
    const name = data?.name ?? 'unknown';
    if (source instanceof Stream) {
      watchSource(source as Readable, name);
    }
    return append(source, data);
  }) as typeof archive.append;

  archive.on('error', fail);
  archive.on('warning', (error: archiver.ArchiverError) => {
    if (error.code !== 'ENOENT') fail(error);
  });
  output.on('error', fail);

  return {
    run: <T>(work: Promise<T>) => Promise.race([work, failed]),
    fail,
  };
};

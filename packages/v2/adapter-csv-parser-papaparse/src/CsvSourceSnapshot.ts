import type { ReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import {
  CSV_SOURCE_INTERRUPTED_CODE,
  CSV_SOURCE_SNAPSHOT_IO_FAILED_CODE,
  CSV_SOURCE_TOO_LARGE_CODE,
  domainError,
  isDomainError,
  type DomainError,
} from '@teable/v2-core';
import { safeFetch } from '@teable/v2-utils/fetch';
import { err, ok, type Result } from 'neverthrow';

/**
 * Node-side snapshot of a URL CSV source.
 *
 * A URL body is a network dependency. Reading it while rows are inserted couples
 * that read to the write transaction, so an interrupted body can fail an import
 * after an arbitrary number of batches. Downloading the source once and parsing
 * the snapshot keeps the network read separate from the writes: an interruption
 * ends before the write transaction opens, and the import transaction rolls back
 * with no committed rows.
 *
 * Snapshots are bounded by `TEABLE_CSV_SOURCE_MAX_BYTES` (default 512 MiB) so an
 * external URL cannot fill the host's disk. There is no automatic reattempt; the
 * caller retries the whole file.
 */
export const CSV_SOURCE_MAX_BYTES_ENV = 'TEABLE_CSV_SOURCE_MAX_BYTES';
export const DEFAULT_CSV_SOURCE_MAX_BYTES = 512 * 1024 * 1024;

/** Snapshotting needs request-owned disk space, which only the Node host provides. */
export const canSnapshotCsvSource = (): boolean =>
  typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function';

export type CsvSourceSnapshot = {
  /** Replayable byte stream over the immutable snapshot. */
  read(): AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
};

const formatMebibytes = (bytes: number): string =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;

const tooLargeError = (maxBytes: number, receivedBytes: number): DomainError =>
  domainError.validation({
    code: CSV_SOURCE_TOO_LARGE_CODE,
    message: `CSV source exceeds the ${formatMebibytes(
      maxBytes
    )} single-file snapshot limit (read ${formatMebibytes(
      receivedBytes
    )}); split the file into smaller imports or raise ${CSV_SOURCE_MAX_BYTES_ENV}`,
    details: { maxBytes, receivedBytes },
  });

/**
 * Public source-interruption error. Transport text is deliberately omitted: an
 * upstream message can contain a presigned URL or token, so only the stable code,
 * observed byte count and retryability are exposed. The thrown value stays
 * available non-enumerably for server-side diagnosis.
 */
const sourceReadError = (receivedBytes: number, maxBytes: number, cause: unknown): DomainError =>
  domainError.infrastructure({
    code: CSV_SOURCE_INTERRUPTED_CODE,
    message:
      receivedBytes === 0
        ? `CSV source could not be read from its origin within the ${formatMebibytes(
            maxBytes
          )} single-file limit; nothing was written, retry the whole import.`
        : `CSV source stream was interrupted after ${receivedBytes} byte(s) while reading up to the ${formatMebibytes(
            maxBytes
          )} single-file limit; nothing was written, retry the whole import.`,
    details: { receivedBytes, maxBytes, retryable: true },
    cause,
  });

/** Local staging failure, distinct from a source interruption. */
const snapshotStorageError = (cause: unknown): DomainError =>
  domainError.infrastructure({
    code: CSV_SOURCE_SNAPSHOT_IO_FAILED_CODE,
    message:
      'Could not stage the CSV source on the host; this is a local storage failure, not a source interruption.',
    details: { retryable: false },
    cause,
  });

export async function snapshotCsvSource(
  url: string
): Promise<Result<CsvSourceSnapshot, DomainError>> {
  const configuredMaxBytes = Number(process.env[CSV_SOURCE_MAX_BYTES_ENV]);
  const maxBytes =
    Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
      ? configuredMaxBytes
      : DEFAULT_CSV_SOURCE_MAX_BYTES;
  const { promises: fsp } = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  let directory = '';
  try {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'teable-csv-source-'));
    await fsp.chmod(directory, 0o700);
  } catch (error) {
    if (directory.length > 0) {
      await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
    return err(snapshotStorageError(error));
  }
  const filePath = path.join(directory, 'source');
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposed ??= fsp.rm(directory, { recursive: true, force: true });
    return disposed;
  };
  let receivedBytes = 0;
  try {
    let response: Response;
    try {
      response = await safeFetch(url);
    } catch (error) {
      throw sourceReadError(0, maxBytes, error);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw domainError.infrastructure({
        code: 'csv.fetch_error',
        message: `Failed to fetch CSV from URL: ${response.status} ${response.statusText}`,
        details: { retryable: false },
      });
    }
    if (!response.body) {
      throw domainError.infrastructure({
        code: 'csv.no_stream',
        message: 'Response body is not available for streaming',
      });
    }
    const body = response.body;
    let file: FileHandle;
    try {
      file = await fsp.open(filePath, 'wx+', 0o600);
    } catch (error) {
      // A local file error must not leak the response body.
      await body.cancel().catch(() => undefined);
      throw snapshotStorageError(error);
    }
    try {
      await writeSnapshot(body, file, maxBytes, (bytes) => {
        receivedBytes = bytes;
      });
      await file.close();
    } catch (error) {
      await file.close().catch(() => undefined);
      throw error;
    }
    return ok({
      read: () => readSnapshot(filePath),
      dispose,
    });
  } catch (error) {
    await dispose().catch(() => undefined);
    return err(isDomainError(error) ? error : snapshotStorageError(error));
  }
}

async function writeSnapshot(
  body: ReadableStream<Uint8Array>,
  file: FileHandle,
  maxBytes: number,
  onBytesRead: (receivedBytes: number) => void
): Promise<void> {
  const reader = body.getReader();
  let receivedBytes = 0;
  let position = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      receivedBytes += chunk.value.byteLength;
      onBytesRead(receivedBytes);
      if (receivedBytes > maxBytes) {
        throw tooLargeError(maxBytes, receivedBytes);
      }
      let written = 0;
      while (written < chunk.value.byteLength) {
        let bytesWritten = 0;
        try {
          ({ bytesWritten } = await file.write(
            chunk.value,
            written,
            chunk.value.byteLength - written,
            position + written
          ));
        } catch (error) {
          throw snapshotStorageError(error);
        }
        if (bytesWritten === 0) {
          throw snapshotStorageError(new Error('CSV source snapshot write made no progress'));
        }
        written += bytesWritten;
      }
      position += chunk.value.byteLength;
      chunk = await reader.read();
    }
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw sourceReadError(receivedBytes, maxBytes, error);
  } finally {
    // Never leave the response body open, including after a local file error.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function* readSnapshot(filePath: string): AsyncIterable<Uint8Array> {
  let stream: ReadStream | undefined;
  try {
    stream = process.getBuiltinModule('node:fs').createReadStream(filePath, {
      highWaterMark: 64 * 1024,
    });
    yield* stream;
  } catch (error) {
    throw snapshotStorageError(error);
  } finally {
    stream?.destroy();
  }
}

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { domainError, type DomainError, type IImportSource } from '@teable/v2-core';
import { safeFetch } from '@teable/v2-utils';
import { err, ok, type Result } from 'neverthrow';

export class ExcelSourceError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

type PreparedSource = {
  path: string;
  disposed: boolean;
  readers: Set<TemporaryWorkbook>;
};

// Identity, not user-supplied file paths, grants access to a prepared snapshot.
const preparedSources = new WeakMap<IImportSource, PreparedSource>();

async function download(source: IImportSource, path: string): Promise<void> {
  let input: AsyncIterable<Uint8Array | string>;
  if (source.data !== undefined) {
    input = Readable.from([source.data]);
  } else if (source.url) {
    let response: Response;
    try {
      response = await safeFetch(source.url);
    } catch (cause) {
      throw new ExcelSourceError(
        `Failed to download Excel: ${cause}`,
        'import.excel.download_failed'
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ExcelSourceError(
        `Failed to fetch Excel: ${response.status}`,
        'import.excel.fetch_failed'
      );
    }
    if (!response.body)
      throw new ExcelSourceError('Empty Excel response', 'import.excel.download_failed');
    input = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  } else if (source.stream) {
    input = source.stream;
  } else {
    throw new ExcelSourceError(
      'Excel source must have url, stream, or data',
      'import.excel.invalid_source'
    );
  }
  await pipeline(Readable.from(input), createWriteStream(path, { mode: 0o600 }));
}

export function excelError(cause: unknown): DomainError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof ExcelSourceError ? cause.code : 'import.excel.parse_failed';
  return code === 'import.excel.invalid_source'
    ? domainError.validation({ message, code })
    : domainError.infrastructure({ message: `Excel parsing failed: ${message}`, code });
}

export type PreparedExcelImportSource = {
  readonly source: IImportSource;
  dispose(): Promise<void>;
};

/** Downloads one immutable disk snapshot for analysis and all sheets of an import. */
export async function prepareExcelImportSource(
  source: IImportSource
): Promise<Result<PreparedExcelImportSource, DomainError>> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'teable-excel-source-'));
    const path = join(directory, 'source');
    await download(source, path);
    const prepared: PreparedSource = { path, disposed: false, readers: new Set() };
    const snapshot: IImportSource = {
      type: source.type,
      fileName: source.fileName,
      options: source.options,
      stream: {
        async *[Symbol.asyncIterator]() {
          if (prepared.disposed) throw new Error('Prepared Excel source is disposed');
          const stream = createReadStream(path);
          try {
            yield* stream;
          } finally {
            stream.destroy();
          }
        },
      },
    };
    preparedSources.set(snapshot, prepared);
    const ownedDirectory = directory;
    let disposing: Promise<void> | undefined;
    return ok({
      source: snapshot,
      dispose() {
        disposing ??= (async () => {
          prepared.disposed = true;
          try {
            await Promise.all([...prepared.readers].map((reader) => reader.close()));
          } finally {
            await rm(ownedDirectory, { recursive: true, force: true });
          }
        })();
        return disposing;
      },
    });
  } catch (cause) {
    if (directory) await rm(directory, { recursive: true, force: true });
    return err(excelError(cause));
  }
}

export type PhysicalExcelRow = {
  index: number;
  values: string[];
};

export type StreamingWorkbook = {
  sheets: ReadonlyArray<{ name: string; index: number }>;
  rows(sheet: string): AsyncIterable<PhysicalExcelRow>;
};

export class TemporaryWorkbook {
  private readonly closers: Array<() => void | Promise<void>> = [];
  private closing?: Promise<void>;

  private constructor(
    readonly directory: string,
    readonly path: string
  ) {}

  static async open(source: IImportSource): Promise<TemporaryWorkbook> {
    const prepared = preparedSources.get(source);
    if (prepared?.disposed) throw new Error('Prepared Excel source is disposed');
    const directory = await mkdtemp(join(tmpdir(), 'teable-excel-reader-'));
    const workbook = new TemporaryWorkbook(directory, prepared?.path ?? join(directory, 'source'));
    try {
      if (prepared) {
        prepared.readers.add(workbook);
        workbook.own(() => {
          prepared.readers.delete(workbook);
        });
      } else {
        await download(source, workbook.path);
      }
      return workbook;
    } catch (cause) {
      await workbook.close();
      throw cause;
    }
  }

  own(close: () => void | Promise<void>): void {
    this.closers.push(close);
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        // Always attempt every close, even when one reader reports an I/O error.
        const results = await Promise.allSettled(
          this.closers.reverse().map(async (close) => close())
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      } finally {
        this.closers.length = 0;
        await rm(this.directory, { recursive: true, force: true });
      }
    })();
    return this.closing;
  }
}

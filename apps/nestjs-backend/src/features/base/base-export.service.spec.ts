import { PassThrough, Readable } from 'node:stream';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { PrismaService, TableMeta } from '@teable/db-main-prisma';
import archiver from 'archiver';
import * as unzipper from 'unzipper';
import { describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type StorageAdapter from '../attachments/plugins/adapter';
import { BaseExportService } from './base-export.service';
import { guardExportArchive } from './export-archive-guard';

type LegacyAttachmentExport = {
  appendAttachments(
    filePath: string,
    tables: TableMeta[],
    archive: archiver.Archiver,
    signal?: AbortSignal
  ): Promise<void>;
};

const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

const createService = (prisma: PrismaService, storage: StorageAdapter) =>
  new BaseExportService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    storage,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  ) as unknown as LegacyAttachmentExport;

describe('legacy base attachment export', () => {
  it('finishes each bounded metadata page before reading the next and exports all 501 bodies', async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.txClient.mockReturnValue(prisma as never);
    const storage = mockDeep<StorageAdapter>();
    const refs = Array.from({ length: 501 }, (_, index) => ({
      id: `reference-${index.toString().padStart(4, '0')}`,
      token: `token-${index}`,
      name: `file-${index}.txt`,
    }));
    const metadata = refs.map(({ token }) => ({
      token,
      path: `files/${token}`,
      thumbnailPath: null,
    }));
    // Bodies and then thumbnails each traverse the refs independently, retaining one page.
    for (let pass = 0; pass < 2; pass++) {
      prisma.attachmentsTable.findMany
        .mockResolvedValueOnce(refs.slice(0, 500) as never)
        .mockResolvedValueOnce(refs.slice(500) as never)
        .mockResolvedValueOnce([]);
      prisma.attachments.findMany
        .mockResolvedValueOnce(metadata.slice(0, 500) as never)
        .mockResolvedValueOnce(metadata.slice(500) as never);
    }
    let readingFirstBody = false;
    const body = new Readable({
      read() {
        readingFirstBody = true;
      },
    });
    storage.downloadFile.mockResolvedValueOnce(body);
    storage.downloadFile.mockImplementation(async () => Readable.from(['synthetic body']));
    const archive = archiver('zip');
    const output = new PassThrough();
    archive.pipe(output);
    const zipBytes = output.toArray().then((chunks) => Buffer.concat(chunks));
    const service = createService(prisma, storage);
    const exporting = service.appendAttachments(
      'attachments',
      [{ id: 'table' }] as TableMeta[],
      archive,
      new AbortController().signal
    );
    try {
      await vi.waitFor(() => expect(readingFirstBody).toBe(true));
      expect(prisma.attachmentsTable.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.attachments.findMany).toHaveBeenCalledTimes(1);
      expect(storage.downloadFile).toHaveBeenCalledTimes(1);
      expect(prisma.attachmentsTable.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 500 })
      );
      body.push(Buffer.from('first body'));
      body.push(null);
      await exporting;
      await archive.finalize();
      const zip = await unzipper.Open.buffer(await zipBytes);
      expect(zip.files.map(({ path }) => path).sort()).toEqual(
        refs.map(({ token }) => `attachments/${token}.txt`).sort()
      );
      expect(storage.downloadFile).toHaveBeenCalledTimes(501);
      expect(prisma.attachments.findMany.mock.calls.map(([args]) => args?.where?.token)).toEqual([
        { in: refs.slice(0, 500).map(({ token }) => token) },
        { in: [refs[500].token] },
        { in: refs.slice(0, 500).map(({ token }) => token) },
        { in: [refs[500].token] },
      ]);
    } finally {
      body.destroy();
      archive.abort();
      archive.destroy();
      output.destroy();
      await Promise.allSettled([exporting, zipBytes]);
    }
  });

  it('waits for a pending legacy metadata read to settle before cancellation unwinds', async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.txClient.mockReturnValue(prisma as never);
    const storage = mockDeep<StorageAdapter>();
    const metadata = promiseWithResolvers.withResolvers<never[]>();
    prisma.attachmentsTable.findMany.mockReturnValueOnce(metadata.promise as never);
    const archive = archiver('zip');
    const output = new PassThrough();
    output.resume();
    archive.pipe(output);
    const guard = guardExportArchive(archive, output);
    const controller = new AbortController();
    const service = createService(prisma, storage);
    const exporting = service.appendAttachments(
      'attachments',
      [{ id: 'table' }] as TableMeta[],
      archive,
      controller.signal
    );
    let settled = false;
    const reason = new DOMException('All export subscribers left', 'AbortError');
    const result = exporting.finally(() => {
      settled = true;
    });
    const rejected = expect(result).rejects.toBe(reason);
    try {
      expect(prisma.attachmentsTable.findMany).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      guard.fail(reason);
      await yieldToEventLoop();
      expect(settled).toBe(false);
      metadata.resolve([]);
      await rejected;
      expect(prisma.attachments.findMany).not.toHaveBeenCalled();
      expect(storage.downloadFile).not.toHaveBeenCalled();
      expect(prisma.attachmentsTable.findMany).toHaveBeenCalledTimes(1);
    } finally {
      metadata.resolve([]);
      archive.abort();
      archive.destroy();
      output.destroy();
      await Promise.allSettled([result]);
    }
  });
});

describe('legacy base export failure notice', () => {
  it('holds the failure notice until the export transaction has unwound', async () => {
    const prisma = mockDeep<PrismaService>();
    prisma.base.findFirstOrThrow.mockResolvedValue({ name: 'Base' } as never);
    // A table read keeps the export transaction open after the upload has failed.
    const transaction = promiseWithResolvers.withResolvers<void>();
    let transactionOpen = false;
    prisma.$tx.mockImplementation((async () => {
      transactionOpen = true;
      try {
        await transaction.promise;
      } finally {
        transactionOpen = false;
      }
    }) as never);
    const storage = mockDeep<StorageAdapter>();
    const uploadFailure = new Error('S3 upload failed');
    storage.uploadFileStream.mockRejectedValue(uploadFailure);
    let notifiedInsideTransaction: boolean | undefined;
    const sendExportBaseResultNotify = vi.fn(async () => {
      notifiedInsideTransaction = transactionOpen;
    });
    const service = new BaseExportService(
      prisma,
      { get: () => 'usrTest' } as never,
      { sendExportBaseResultNotify } as never,
      { emit: vi.fn() } as never,
      {} as never,
      {} as never,
      storage,
      { tokenExpireIn: '7d' } as never,
      { bigTransactionTimeout: 60_000 } as never,
      {} as never,
      {
        run: (_options: unknown, job: (...args: unknown[]) => Promise<unknown>) =>
          job(
            new AbortController().signal,
            () => undefined,
            () => true
          ),
      } as never
    );

    const exporting = service.exportBaseZip('bseTest');
    const rejected = expect(exporting).rejects.toBe(uploadFailure);
    try {
      await vi.waitFor(() => expect(prisma.$tx).toHaveBeenCalled());
      await yieldToEventLoop();
      // The transaction client sits in the request's CLS store, so a notice sent now would
      // read through a transaction that is about to roll back.
      expect(sendExportBaseResultNotify).not.toHaveBeenCalled();
      transaction.reject(uploadFailure);
      await rejected;
      expect(notifiedInsideTransaction).toBe(false);
    } finally {
      transaction.resolve();
      await Promise.allSettled([exporting, rejected]);
    }
  });
});

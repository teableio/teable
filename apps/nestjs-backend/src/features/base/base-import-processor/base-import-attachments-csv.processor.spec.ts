import type { Attachments } from '@teable/db-main-prisma';
import { describe, expect, it, vi } from 'vitest';
import { BaseImportAttachmentsCsvQueueProcessor } from './base-import-attachments-csv.processor';

const row = (overrides: Partial<Attachments>) =>
  ({
    id: 'att1',
    token: 'tok123',
    hash: 'h',
    size: 12,
    mimetype: 'image/png',
    path: 'table/tok123',
    width: null,
    height: null,
    thumbnailPath: null,
    ...overrides,
  }) as Attachments;

const createProcessor = () => {
  const create = vi.fn().mockResolvedValue({});
  const prismaService = { attachments: { findUnique: vi.fn().mockResolvedValue(null), create } };
  const processor = new BaseImportAttachmentsCsvQueueProcessor(
    prismaService as never,
    {} as never,
    {} as never
  );
  const handleChunk = (rows: Attachments[]) =>
    (
      processor as unknown as {
        handleChunk: (rows: Attachments[], userId: string) => Promise<void>;
      }
    ).handleChunk(rows, 'usr1');
  return { create, handleChunk };
};

describe('BaseImportAttachmentsCsvQueueProcessor', () => {
  it('stores the path of the uploaded object, not the one the archive wrote', async () => {
    const { create, handleChunk } = createProcessor();

    await handleChunk([
      row({
        path: 'record-history/v1/tblVictim/_stats.json',
        thumbnailPath: JSON.stringify({ lg: '/etc/hostname' }),
      }),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      token: 'tok123',
      path: 'table/tok123',
      thumbnailPath: JSON.stringify({ lg: 'table/hostname' }),
      createdBy: 'usr1',
    });
  });

  it('skips a row whose token is not a single file name', async () => {
    const { create, handleChunk } = createProcessor();

    await handleChunk([row({ id: 'att2', token: '../record-history/v1/tblVictim/_stats.json' })]);

    expect(create).not.toHaveBeenCalled();
  });
});

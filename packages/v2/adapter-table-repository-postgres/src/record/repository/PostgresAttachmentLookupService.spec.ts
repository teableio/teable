import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { PostgresAttachmentLookupService } from './PostgresAttachmentLookupService';

describe('PostgresAttachmentLookupService', () => {
  it('returns early for empty token and attachment id inputs', async () => {
    const db = {
      selectFrom: vi.fn(),
    } as unknown as Kysely<unknown>;
    const service = new PostgresAttachmentLookupService(db as never);

    await expect(service.listAttachmentsByTokens(['', ''])).resolves.toMatchObject({
      value: [],
    });
    await expect(service.listAttachmentsByAttachmentIds(['', ''])).resolves.toMatchObject({
      value: [],
    });
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('deduplicates attachment tokens and maps attachment rows', async () => {
    const execute = vi.fn(async () => [
      {
        id: 1,
        token: 'tok_1',
        path: '/tmp/file-1.png',
        size: '42',
        mimetype: 'image/png',
      },
    ]);
    const where = vi.fn((_column: string, _op: string, values: unknown[]) => {
      expect(values).toEqual(['tok_1', 'tok_2']);
      return { execute };
    });
    const select = vi.fn(() => ({ where }));
    const db = {
      selectFrom: vi.fn(() => ({ select })),
    } as unknown as Kysely<unknown>;
    const service = new PostgresAttachmentLookupService(db as never);

    const result = await service.listAttachmentsByTokens(['tok_1', 'tok_2', 'tok_1']);

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: '1',
        token: 'tok_1',
        path: '/tmp/file-1.png',
        size: 42,
        mimetype: 'image/png',
      },
    ]);
  });

  it('joins attachment tables and maps attachmentId lookups', async () => {
    const execute = vi.fn(async () => [
      {
        attachmentId: 'att_1',
        name: 'Contract',
        token: 'tok_9',
        path: '/tmp/contract.pdf',
        size: '512',
        mimetype: 'application/pdf',
      },
    ]);
    const where = vi.fn((_column: string, _op: string, values: unknown[]) => {
      expect(values).toEqual(['att_1', 'att_2']);
      return { execute };
    });
    const select = vi.fn(() => ({ where }));
    const innerJoin = vi.fn(() => ({ select }));
    const db = {
      selectFrom: vi.fn(() => ({ innerJoin })),
    } as unknown as Kysely<unknown>;
    const service = new PostgresAttachmentLookupService(db as never);

    const result = await service.listAttachmentsByAttachmentIds(['att_1', 'att_2', 'att_1']);

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'att_1',
        attachmentId: 'att_1',
        name: 'Contract',
        token: 'tok_9',
        path: '/tmp/contract.pdf',
        size: 512,
        mimetype: 'application/pdf',
      },
    ]);
  });

  it('wraps token and attachmentId lookup failures as infrastructure errors', async () => {
    const select = vi.fn(() => ({
      where: () => ({
        execute: async () => {
          throw new Error('attachment lookup failed');
        },
      }),
    }));
    const dbForTokens = {
      selectFrom: vi.fn(() => ({ select })),
    } as unknown as Kysely<unknown>;
    const tokenService = new PostgresAttachmentLookupService(dbForTokens as never);

    const tokenResult = await tokenService.listAttachmentsByTokens(['tok_1']);

    expect(tokenResult.isErr()).toBe(true);
    expect(tokenResult._unsafeUnwrapErr()).toMatchObject({
      tags: ['infrastructure'],
      message: 'Failed to lookup attachments',
    });

    const dbForAttachmentIds = {
      selectFrom: vi.fn(() => ({
        innerJoin: () => ({
          select: () => ({
            where: () => ({
              execute: async () => {
                throw new Error('attachmentId lookup failed');
              },
            }),
          }),
        }),
      })),
    } as unknown as Kysely<unknown>;
    const attachmentIdService = new PostgresAttachmentLookupService(dbForAttachmentIds as never);

    const attachmentIdResult = await attachmentIdService.listAttachmentsByAttachmentIds(['att_1']);

    expect(attachmentIdResult.isErr()).toBe(true);
    expect(attachmentIdResult._unsafeUnwrapErr()).toMatchObject({
      tags: ['infrastructure'],
      message: 'Failed to lookup attachments by attachmentId',
    });
  });
});

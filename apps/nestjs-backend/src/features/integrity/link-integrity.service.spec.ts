import 'reflect-metadata';
import { HttpErrorCode } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { LinkIntegrityService } from './link-integrity.service';

describe('LinkIntegrityService tableId scoping', () => {
  const makeService = (findMany: ReturnType<typeof vi.fn>) => {
    const prismaService = {
      base: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'bse1', name: 'Base One' }) },
      tableMeta: { findMany },
    };
    // Only prismaService is reached before the scope guard throws; the rest of
    // the constructor deps are irrelevant for this path.
    return new LinkIntegrityService(
      prismaService as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
  };

  it('rejects a tableId that does not belong to the base (cross-base access)', async () => {
    // The base holds only tblMine; the caller points tableId at another base's table.
    const findMany = vi.fn().mockResolvedValue([{ id: 'tblMine', name: 'Mine', fields: [] }]);
    const service = makeService(findMany);

    const error = await service.linkIntegrityCheck('bse1', 'tblOther').catch((e) => e);

    // A localizable CustomHttpException (NOT_FOUND), not a raw-string NotFoundException.
    expect(error).toBeInstanceOf(CustomHttpException);
    expect(error.code).toBe(HttpErrorCode.NOT_FOUND);
    expect(error.data?.localization?.i18nKey).toBe('httpErrors.table.notFound');
    // The guard reuses the base-scoped findMany; it must not issue a separate lookup.
    expect(findMany).toHaveBeenCalledWith({
      where: { baseId: 'bse1', deletedTime: null },
      select: expect.objectContaining({ id: true }),
    });
  });
});

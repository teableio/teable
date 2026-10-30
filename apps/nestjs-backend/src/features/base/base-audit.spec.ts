/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditBaseCreated } from './base-create-audit';
import { BaseService } from './base.service';

describe('BaseService audit rows', () => {
  const audit = {
    emitAtomic: vi.fn(async () => undefined),
    withOperation: vi.fn(async (_input: unknown, fn: () => Promise<unknown>) => fn()),
  };
  const prismaService: any = {
    $tx: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(prismaService)),
    txClient: vi.fn(() => prismaService),
    base: { findUnique: vi.fn() },
    template: { findFirst: vi.fn(), update: vi.fn() },
    userLastVisit: { upsert: vi.fn(() => Promise.resolve()) },
  };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? 'usr1' : undefined)) };
  const baseDuplicateService = { duplicateBase: vi.fn() };
  const baseDuplicateV2Service = { duplicateBase: vi.fn() };
  const permissionService = { validPermissions: vi.fn() };
  const eventEmitterService = { emit: vi.fn() };
  const baseDataDbMoveService = {
    resolveDataDbCheck: vi.fn(),
    startPhysicalMove: vi.fn(),
  };

  const createService = () =>
    new BaseService(
      prismaService as never,
      {} as never,
      cls as never,
      {} as never,
      baseDuplicateService as never,
      baseDuplicateV2Service as never,
      permissionService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { bigTransactionTimeout: 1000 } as never,
      audit as never,
      eventEmitterService as never,
      undefined,
      baseDataDbMoveService as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('base.move', () => {
    it('records both spaces, scoped to the space the base left', async () => {
      prismaService.base.findUnique.mockResolvedValueOnce({ name: 'CRM', spaceId: 'spcFrom' });
      baseDataDbMoveService.resolveDataDbCheck.mockResolvedValueOnce({
        requiresPhysicalMove: false,
      });
      const service = createService();
      const applyMeta = vi.spyOn(service, 'applyMetaMoveBase').mockResolvedValue(undefined);

      await expect(service.moveBase('bse1', { spaceId: 'spcTo' })).resolves.toEqual({});

      expect(applyMeta).toHaveBeenCalledWith('bse1', 'spcTo');
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.move',
        resourceId: 'bse1',
        params: {
          baseId: 'bse1',
          spaceId: 'spcFrom',
          name: 'CRM',
          fromSpaceId: 'spcFrom',
          toSpaceId: 'spcTo',
        },
      });
    });

    it('records a cross data-database move when its job starts', async () => {
      prismaService.base.findUnique.mockResolvedValueOnce({ name: 'CRM', spaceId: 'spcFrom' });
      baseDataDbMoveService.resolveDataDbCheck.mockResolvedValueOnce({
        requiresPhysicalMove: true,
      });
      baseDataDbMoveService.startPhysicalMove.mockResolvedValueOnce({ jobId: 'job1', async: true });

      await createService().moveBase('bse1', { spaceId: 'spcTo' });

      expect(audit.emitAtomic).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'base.move',
          params: expect.objectContaining({ toSpaceId: 'spcTo', dataDbMoveJobId: 'job1' }),
        })
      );
    });

    it('writes nothing when the move fails', async () => {
      prismaService.base.findUnique.mockResolvedValueOnce({ name: 'CRM', spaceId: 'spcFrom' });
      baseDataDbMoveService.resolveDataDbCheck.mockResolvedValueOnce({
        requiresPhysicalMove: false,
      });
      const service = createService();
      vi.spyOn(service, 'applyMetaMoveBase').mockRejectedValue(new Error('conversion failed'));

      await expect(service.moveBase('bse1', { spaceId: 'spcTo' })).rejects.toThrow();
      expect(audit.emitAtomic).not.toHaveBeenCalled();
    });
  });

  describe('base.create on routes without a controller event', () => {
    const duplicateRo = { fromBaseId: 'bseSrc', spaceId: 'spc1', withRecords: true };
    const newBase = { id: 'bseNew', name: 'Copy', spaceId: 'spc1' };

    it('writes base.create for the duplicate stream (v1) only when asked to', async () => {
      baseDuplicateService.duplicateBase.mockResolvedValue({ base: newBase });
      const service = createService();

      await service.duplicateBase(duplicateRo as never);
      expect(audit.emitAtomic).not.toHaveBeenCalled();

      await service.duplicateBase(duplicateRo as never, { auditBaseCreate: true });
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.create',
        resourceId: 'bseNew',
        params: { baseId: 'bseNew', spaceId: 'spc1' },
        payload: { base: newBase },
      });
    });

    it('opens base.duplicate and writes base.create for the duplicate stream (v2)', async () => {
      baseDuplicateV2Service.duplicateBase.mockResolvedValueOnce({ base: newBase });

      await createService().duplicateBaseV2WithProgress(duplicateRo as never);

      expect(audit.withOperation).toHaveBeenCalledWith(
        expect.objectContaining({ rootAction: 'base.duplicate', resourceId: 'bseSrc' }),
        expect.any(Function)
      );
      expect(audit.emitAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'base.create', resourceId: 'bseNew' })
      );
    });
  });

  describe('auditBaseCreated', () => {
    it('keeps the icon and extra params, and never throws', async () => {
      await auditBaseCreated(
        audit as never,
        { id: 'bse1', name: 'Imported', spaceId: 'spc1', icon: '📦' },
        { importSource: 'airtable' }
      );
      expect(audit.emitAtomic).toHaveBeenCalledWith({
        action: 'base.create',
        resourceId: 'bse1',
        params: { baseId: 'bse1', spaceId: 'spc1', importSource: 'airtable' },
        payload: { base: { id: 'bse1', name: 'Imported', spaceId: 'spc1', icon: '📦' } },
      });

      audit.emitAtomic.mockRejectedValueOnce(new Error('bus down'));
      await expect(
        auditBaseCreated(audit as never, { id: 'bse2', name: 'X', spaceId: 'spc1' })
      ).resolves.toBeUndefined();
    });
  });
});

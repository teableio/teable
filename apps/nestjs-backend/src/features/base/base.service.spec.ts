import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Role } from '@teable/core';
import { CollaboratorType } from '@teable/openapi';
import { GlobalModule } from '../../global/global.module';
import { BaseModule } from './base.module';
import { BaseService } from './base.service';

describe('BaseService', () => {
  let service: BaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseModule],
    }).compile();

    service = module.get<BaseService>(BaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enrichBaseListV2Status', () => {
    const createService = () => {
      const canaryService = {
        shouldUseV2WithReason: vi.fn().mockResolvedValue({ useV2: true, reason: 'space_feature' }),
        isSpaceInCanary: vi.fn().mockResolvedValue(true),
      };

      return {
        service: new BaseService(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          canaryService as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never
        ),
        canaryService,
      };
    };

    it('adds canary-space v2 status for list items that are not new-base v2', async () => {
      const { service, canaryService } = createService();

      const result = await service.enrichBaseListV2Status([
        { id: 'bse1', spaceId: 'spc1', v2Enabled: false },
      ]);

      expect(canaryService.shouldUseV2WithReason).toHaveBeenCalledTimes(1);
      expect(canaryService.shouldUseV2WithReason).toHaveBeenCalledWith('spc1', 'getRecords');
      expect(canaryService.isSpaceInCanary).toHaveBeenCalledWith('spc1');
      expect(result[0]).toMatchObject({
        id: 'bse1',
        isCanary: true,
        v2Status: { useV2: true, reason: 'space_feature' },
      });
    });

    it('keeps new-base v2 status while batching space-level canary checks', async () => {
      const { service, canaryService } = createService();

      const result = await service.enrichBaseListV2Status([
        { id: 'bse1', spaceId: 'spc1', v2Enabled: true },
        { id: 'bse2', spaceId: 'spc1', v2Enabled: false },
      ]);

      expect(canaryService.shouldUseV2WithReason).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject([
        {
          id: 'bse1',
          v2Status: { useV2: true, reason: 'new_base' },
        },
        {
          id: 'bse2',
          v2Status: { useV2: true, reason: 'space_feature' },
        },
      ]);
    });
  });

  describe('getAllBaseList', () => {
    const spaceId = 'spc1';
    const createdTime = new Date('2026-06-13T00:00:00.000Z');

    const createService = (overrides?: {
      createdBy?: string;
      userList?: { id: string; name: string; avatar: string | null }[];
      spaceOwnerMap?: Map<string, string>;
    }) => {
      const base = {
        id: 'bse1',
        name: 'Base',
        order: 1,
        spaceId,
        icon: null,
        createdBy: overrides?.createdBy ?? 'usr1',
        createdTime,
        lastModifiedTime: createdTime,
        v2Enabled: false,
      };
      const prismaService = {
        base: {
          findMany: vi.fn().mockResolvedValue([base]),
        },
        user: {
          findMany: vi
            .fn()
            .mockResolvedValue(
              overrides?.userList ?? [{ id: base.createdBy, name: 'Nee', avatar: null }]
            ),
        },
        baseShare: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const collaboratorService = {
        getCurrentUserCollaboratorsBaseAndSpaceArray: vi.fn().mockResolvedValue({
          spaceIds: [spaceId],
          baseIds: [],
          roleMap: { [spaceId]: Role.Owner },
        }),
        buildSpaceOwnerContext: vi.fn().mockResolvedValue({
          validCreatorSet: new Set(),
          spaceOwnerMap: overrides?.spaceOwnerMap ?? new Map([[spaceId, base.createdBy]]),
        }),
      };
      const canaryService = {
        shouldUseV2WithReason: vi.fn().mockResolvedValue({ useV2: true, reason: 'space_feature' }),
        isSpaceInCanary: vi.fn().mockResolvedValue(true),
      };
      const service = new BaseService(
        prismaService as never,
        {} as never,
        {} as never,
        collaboratorService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        canaryService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      return { service, canaryService, base };
    };

    it('includes v2 status for canary-space bases from the all-base list endpoint', async () => {
      const { service, canaryService, base } = createService();

      const result = await service.getAllBaseList();

      expect(canaryService.shouldUseV2WithReason).toHaveBeenCalledWith(spaceId, 'getRecords');
      expect(result[0]).toMatchObject({
        id: base.id,
        role: Role.Owner,
        isCanary: true,
        v2Status: { useV2: true, reason: 'space_feature' },
      });
      expect(result[0]).not.toHaveProperty('v2Enabled');
    });

    it('shows the real base creator even when the creator is not a space owner', async () => {
      const { service, base } = createService({
        createdBy: 'usrCreator',
        userList: [
          { id: 'usrCreator', name: 'Creator', avatar: null },
          { id: 'usrOwner', name: 'Owner', avatar: null },
        ],
        spaceOwnerMap: new Map([[spaceId, 'usrOwner']]),
      });

      const result = await service.getAllBaseList();

      expect(result[0].createdUser?.id).toBe(base.createdBy);
      expect(result[0].createdUser?.id).toBe('usrCreator');
    });

    it('falls back to a space owner when the creator user record is unresolvable', async () => {
      const { service } = createService({
        createdBy: 'usrGone',
        userList: [{ id: 'usrOwner', name: 'Owner', avatar: null }],
        spaceOwnerMap: new Map([[spaceId, 'usrOwner']]),
      });

      const result = await service.getAllBaseList();

      expect(result[0].createdUser?.id).toBe('usrOwner');
    });
  });

  describe('getBaseById', () => {
    const createService = (params: {
      base: {
        id: string;
        name: string;
        icon: string | null;
        spaceId: string;
        v2Enabled: boolean;
        createdBy: string;
      };
      decision: { useV2: boolean; reason: 'new_base' | 'space_feature' | 'feature_not_enabled' };
    }) => {
      const prismaService = {
        base: {
          findFirstOrThrow: vi.fn().mockResolvedValue(params.base),
        },
      };
      const cls = {
        get: vi.fn((key: string) => {
          if (key === 'template') {
            return { id: 'tpl1', baseId: params.base.id };
          }
          return undefined;
        }),
      };
      const permissionService = {
        generateTemplateHeader: vi.fn().mockReturnValue('template-header'),
      };
      const canaryService = {
        shouldUseV2ForBaseWithReason: vi.fn().mockResolvedValue(params.decision),
        isSpaceInCanary: vi.fn().mockResolvedValue(params.decision.reason === 'space_feature'),
      };

      return {
        service: new BaseService(
          prismaService as never,
          {} as never,
          cls as never,
          {} as never,
          {} as never,
          {} as never,
          permissionService as never,
          {} as never,
          {} as never,
          {} as never,
          canaryService as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never
        ),
        canaryService,
      };
    };

    it('returns the unified v2 status for new bases without exposing v2Enabled', async () => {
      const base = {
        id: 'bse1',
        name: 'Base',
        icon: null,
        spaceId: 'spc1',
        v2Enabled: true,
        createdBy: 'usr1',
      };
      const { service, canaryService } = createService({
        base,
        decision: { useV2: true, reason: 'new_base' },
      });

      const result = await service.getBaseById(base.id);

      expect(canaryService.shouldUseV2ForBaseWithReason).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'spc1', v2Enabled: true }),
        'getRecords'
      );
      expect(canaryService.isSpaceInCanary).toHaveBeenCalledWith('spc1');
      expect(result).toMatchObject({
        id: base.id,
        role: Role.Viewer,
        collaboratorType: CollaboratorType.Base,
        v2Status: { useV2: true, reason: 'new_base' },
      });
      expect(result.isCanary).toBeUndefined();
      expect(result).not.toHaveProperty('v2Enabled');
    });

    it('returns a v1 decision reason when the unified decision disables v2', async () => {
      const base = {
        id: 'bse1',
        name: 'Base',
        icon: null,
        spaceId: 'spc1',
        v2Enabled: false,
        createdBy: 'usr1',
      };
      const { service } = createService({
        base,
        decision: { useV2: false, reason: 'feature_not_enabled' },
      });

      const result = await service.getBaseById(base.id);

      expect(result.isCanary).toBeUndefined();
      expect(result.v2Status).toEqual({ useV2: false, reason: 'feature_not_enabled' });
    });

    it('keeps the legacy isCanary flag for canary rollout decisions', async () => {
      const base = {
        id: 'bse1',
        name: 'Base',
        icon: null,
        spaceId: 'spc1',
        v2Enabled: false,
        createdBy: 'usr1',
      };
      const { service } = createService({
        base,
        decision: { useV2: true, reason: 'space_feature' },
      });

      const result = await service.getBaseById(base.id);

      expect(result.isCanary).toBe(true);
      expect(result.v2Status).toEqual({ useV2: true, reason: 'space_feature' });
    });
  });

  describe('dropBase', () => {
    it('runs base-level data DDL through the routed BYODB data client', async () => {
      const defaultDataPrisma = {
        $executeRawUnsafe: vi.fn(),
      };
      const routedTxClient = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      };
      const routedDataPrisma = {
        txClient: vi.fn().mockReturnValue(routedTxClient),
        $executeRawUnsafe: vi.fn(),
      };
      const dataDbClientManager = {
        dataPrismaForBase: vi.fn().mockResolvedValue(routedDataPrisma),
      };
      const dbProvider = {
        dropSchema: vi.fn().mockReturnValue('DROP SCHEMA "bse1" CASCADE'),
      };
      const tableOpenApiService = {
        dropTables: vi.fn(),
      };
      const { service } = {
        service: new BaseService(
          {} as never,
          dataDbClientManager as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          tableOpenApiService as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          dbProvider as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never
        ),
      };

      await service.dropBase('bse1', ['tbl1']);

      expect(dataDbClientManager.dataPrismaForBase).toHaveBeenCalledWith('bse1', {
        useTransaction: true,
      });
      expect(routedTxClient.$executeRawUnsafe).toHaveBeenCalledWith('DROP SCHEMA "bse1" CASCADE');
      expect(routedDataPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(defaultDataPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(tableOpenApiService.dropTables).not.toHaveBeenCalled();
    });

    it('falls back to table-level routed drops when the provider has no base schema DDL', async () => {
      const tableOpenApiService = {
        dropTables: vi.fn().mockResolvedValue(undefined),
      };
      const service = new BaseService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        tableOpenApiService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { dropSchema: vi.fn().mockReturnValue('') } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );

      await service.dropBase('bse1', ['tbl1', 'tbl2']);

      expect(tableOpenApiService.dropTables).toHaveBeenCalledWith(['tbl1', 'tbl2']);
    });
  });
});

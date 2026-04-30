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
          cls as never,
          {} as never,
          {} as never,
          permissionService as never,
          {} as never,
          {} as never,
          {} as never,
          canaryService as never,
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
});

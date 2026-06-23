import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Role } from '@teable/core';
import { GlobalModule } from '../../global/global.module';
import { SpaceModule } from './space.module';
import { SpaceService } from './space.service';

describe('SpaceService', () => {
  let service: SpaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, SpaceModule],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBaseListBySpaceId', () => {
    it('returns v2 status for canary-space bases even when the base is not new-base v2', async () => {
      const spaceId = 'spc1';
      const createdTime = new Date('2026-06-13T00:00:00.000Z');
      const base = {
        id: 'bse1',
        name: 'Base',
        order: 1,
        spaceId,
        icon: null,
        createdBy: 'usr1',
        lastModifiedTime: createdTime,
        createdTime,
        v2Enabled: false,
      };
      const prismaService = {
        base: {
          findMany: vi.fn().mockResolvedValue([base]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([{ id: 'usr1', name: 'Nee', avatar: null }]),
        },
        baseShare: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const collaboratorService = {
        getCurrentUserCollaboratorsBaseAndSpaceArray: vi.fn().mockResolvedValue({
          spaceIds: [spaceId],
          roleMap: { [spaceId]: Role.Owner },
        }),
      };
      const baseService = {
        enrichBaseListV2Status: vi.fn(async (baseList: (typeof base)[]) =>
          baseList.map((base) => ({
            ...base,
            isCanary: true,
            v2Status: { useV2: true, reason: 'space_feature' as const },
          }))
        ),
      };
      const testService = new SpaceService(
        prismaService as never,
        {} as never,
        baseService as never,
        collaboratorService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );

      const result = await testService.getBaseListBySpaceId(spaceId);

      expect(baseService.enrichBaseListV2Status).toHaveBeenCalledWith([base]);
      expect(result[0]).toMatchObject({
        id: base.id,
        role: Role.Owner,
        isCanary: true,
        v2Status: { useV2: true, reason: 'space_feature' },
      });
      expect(result[0]).not.toHaveProperty('v2Enabled');
    });
  });
});

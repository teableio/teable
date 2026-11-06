import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { HttpErrorCode, Role } from '@teable/core';
import type { ITestLLMRo } from '@teable/openapi';
import { GlobalModule } from '../../global/global.module';
import { decryptAiIntegrationConfig, maskAiIntegrationConfig } from './ai-integration-secrets';
import { SpaceModule } from './space.module';
import { SpaceService } from './space.service';

describe('SpaceService', () => {
  let service: SpaceService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, SpaceModule],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
  });

  // GlobalModule opens Redis-backed queues; close them before the file is torn down.
  afterEach(() => module.close());

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

  describe('integrations of another space', () => {
    const createService = (integrationSpaceId: string) => {
      const row = { id: 'int1', resourceId: integrationSpaceId, type: 'AI', config: '{}' };
      const prismaService = {
        integration: {
          findFirst: vi.fn(async ({ where }: { where: { id: string; resourceId: string } }) =>
            where.id === row.id && where.resourceId === row.resourceId ? { id: row.id } : null
          ),
          update: vi.fn().mockResolvedValue(row),
          delete: vi.fn().mockResolvedValue(row),
        },
      };
      const performanceCacheService = { del: vi.fn() };
      const testService = new SpaceService(
        prismaService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        performanceCacheService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      return { testService, prismaService, performanceCacheService };
    };

    it('refuses to update an integration that belongs to a different space', async () => {
      const { testService, prismaService } = createService('spcVictim');

      await expect(
        testService.updateIntegration('int1', { enable: false }, 'spcAttacker')
      ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND });
      expect(prismaService.integration.update).not.toHaveBeenCalled();
    });

    it('refuses to delete an integration that belongs to a different space', async () => {
      const { testService, prismaService } = createService('spcVictim');

      await expect(testService.deleteIntegration('int1', 'spcAttacker')).rejects.toMatchObject({
        code: HttpErrorCode.NOT_FOUND,
      });
      expect(prismaService.integration.delete).not.toHaveBeenCalled();
    });

    it('updates and deletes an integration of the same space, scoped to that space', async () => {
      const { testService, prismaService, performanceCacheService } = createService('spcOwn');

      await testService.updateIntegration('int1', { enable: false }, 'spcOwn');
      await testService.deleteIntegration('int1', 'spcOwn');

      expect(prismaService.integration.update).toHaveBeenCalledWith({
        where: { id: 'int1', resourceId: 'spcOwn' },
        data: { enable: false },
      });
      expect(prismaService.integration.delete).toHaveBeenCalledWith({
        where: { id: 'int1', resourceId: 'spcOwn' },
      });
      expect(performanceCacheService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('masked integration secrets', () => {
    const storedConfig = {
      llmProviders: [
        { type: 'openai', name: 'p1', apiKey: 'sk-stored', baseUrl: 'https://llm.example/v1' },
      ],
    };
    const createService = () => {
      const row = { id: 'int1', resourceId: 'spc1', type: 'AI' };
      const prismaService = {
        integration: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'int1', config: JSON.stringify(storedConfig) }),
          update: vi.fn(async ({ data }: { data: { config: string } }) => ({ ...row, ...data })),
        },
      };
      const settingOpenApiService = { testLLM: vi.fn().mockResolvedValue({ success: true }) };
      const testService = new SpaceService(
        prismaService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        settingOpenApiService as never,
        { del: vi.fn() } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );
      return { testService, prismaService, settingOpenApiService };
    };
    const maskedProvider = () => maskAiIntegrationConfig(storedConfig).llmProviders[0];

    it('saves a round-tripped mask as the stored key, never as the mask', async () => {
      const { testService, prismaService } = createService();
      const { baseUrl: _baseUrl, ...provider } = maskedProvider();

      await testService.updateIntegration(
        'int1',
        { config: { llmProviders: [provider] } as never },
        'spc1'
      );

      const saved = JSON.parse(prismaService.integration.update.mock.calls[0][0].data.config);
      expect(decryptAiIntegrationConfig(saved).llmProviders[0].apiKey).toBe('sk-stored');
    });

    it("tests a masked key with the key this space stored, and refuses another space's", async () => {
      const { testService, settingOpenApiService } = createService();
      const { type, apiKey, baseUrl } = maskedProvider();
      const ro = { type, apiKey, baseUrl, models: 'gpt-4o' } as never as ITestLLMRo;

      await testService.testIntegrationLLM('spc1', ro);
      expect(settingOpenApiService.testLLM).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-stored', baseUrl })
      );

      settingOpenApiService.testLLM.mockClear();
      const otherSpaceMask = maskAiIntegrationConfig({
        llmProviders: [{ ...storedConfig.llmProviders[0], apiKey: 'sk-other-space' }],
      }).llmProviders[0].apiKey;
      await expect(
        testService.testIntegrationLLM('spc1', { ...ro, apiKey: otherSpaceMask })
      ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
      expect(settingOpenApiService.testLLM).not.toHaveBeenCalled();
    });
  });
});

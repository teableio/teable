import { SettingKey } from '@teable/openapi';
import { CanaryService } from './canary.service';

describe('CanaryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const createService = (params?: {
    canaryHeader?: string;
    config?: { enabled: boolean; spaceIds?: string[]; forceV2All?: boolean };
  }) => {
    const settingService = {
      getSetting: vi.fn().mockResolvedValue({
        [SettingKey.CANARY_CONFIG]: params?.config ?? null,
      }),
    };
    const cls = {
      get: vi.fn((key: string) => (key === 'canaryHeader' ? params?.canaryHeader : undefined)),
    };

    return {
      service: new CanaryService(settingService as never, cls as never),
      settingService,
      cls,
    };
  };

  it('forces v2 for a marked new base before disabled canary, config, or header decisions', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'false';
    process.env.FORCE_V2_ALL = 'false';
    const { service, settingService, cls } = createService({
      canaryHeader: 'false',
      config: { enabled: false, spaceIds: [], forceV2All: false },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: true },
      'createRecord'
    );

    expect(decision).toEqual({ useV2: true, reason: 'new_base' });
    expect(settingService.getSetting).not.toHaveBeenCalled();
    expect(cls.get).not.toHaveBeenCalled();
  });

  it('reports new_base for a marked new base even when force v2 all is enabled', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'true';
    process.env.FORCE_V2_ALL = 'true';
    const { service, settingService, cls } = createService({
      canaryHeader: 'false',
      config: { enabled: true, spaceIds: ['spc1'], forceV2All: true },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: true },
      'createRecord'
    );

    expect(decision).toEqual({ useV2: true, reason: 'new_base' });
    expect(settingService.getSetting).not.toHaveBeenCalled();
    expect(cls.get).not.toHaveBeenCalled();
  });

  it('falls back to rollout decisions for unmarked bases', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'true';
    process.env.FORCE_V2_ALL = 'false';
    const { service } = createService({
      config: { enabled: true, spaceIds: ['spc1'], forceV2All: false },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: false },
      'createRecord'
    );

    expect(decision).toEqual({ useV2: true, reason: 'space_feature' });
  });

  it('reports env_force_v2_all before rollout config for unmarked bases', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'false';
    process.env.FORCE_V2_ALL = 'true';
    const { service } = createService({
      config: { enabled: false, spaceIds: [], forceV2All: false },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: false },
      'getRecords'
    );

    expect(decision).toEqual({ useV2: true, reason: 'env_force_v2_all' });
  });

  it('reports config_force_v2_all before request header override for unmarked bases', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'true';
    process.env.FORCE_V2_ALL = 'false';
    const { service } = createService({
      canaryHeader: 'false',
      config: { enabled: true, spaceIds: [], forceV2All: true },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: false },
      'getRecords'
    );

    expect(decision).toEqual({ useV2: true, reason: 'config_force_v2_all' });
  });

  it('reports header_override when request header controls an unmarked base', async () => {
    process.env.ENABLE_CANARY_FEATURE = 'true';
    process.env.FORCE_V2_ALL = 'false';
    const { service } = createService({
      canaryHeader: 'true',
      config: { enabled: true, spaceIds: [], forceV2All: false },
    });

    const decision = await service.shouldUseV2ForBaseWithReason(
      { spaceId: 'spc1', v2Enabled: false },
      'getRecords'
    );

    expect(decision).toEqual({ useV2: true, reason: 'header_override' });
  });
});

import { SettingKey } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import type { ISsaConfig } from '../../configs/ssa.config';
import { SsaBootstrapService } from './ssa-bootstrap.service';

const makeService = (options: {
  singleTenant: boolean;
  brand?: { name: string; logo: string };
  currentSettings?: Record<string, unknown>;
}) => {
  const upsert = vi.fn().mockResolvedValue({});
  const getSetting = vi.fn().mockResolvedValue(options.currentSettings ?? {});
  const prismaService = {
    txClient: () => ({ setting: { upsert } }),
  };

  const service = new SsaBootstrapService(
    {
      singleTenant: options.singleTenant,
      brand: options.brand ?? { name: '', logo: '' },
    } as ISsaConfig,
    { getSetting } as never,
    prismaService as never
  );

  return { service, upsert, getSetting };
};

describe('SsaBootstrapService (env-driven settings)', () => {
  it('does nothing when all features are off', async () => {
    const { service, upsert, getSetting } = makeService({ singleTenant: false });

    await service.onApplicationBootstrap();

    expect(getSetting).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('forces disallowSignUp and disables the waitlist when not yet enforced', async () => {
    const { service, upsert } = makeService({
      singleTenant: true,
      currentSettings: { [SettingKey.ENABLE_WAITLIST]: true },
    });

    await service.onApplicationBootstrap();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: SettingKey.DISALLOW_SIGN_UP },
        create: expect.objectContaining({
          name: SettingKey.DISALLOW_SIGN_UP,
          content: 'true',
          createdBy: 'system',
        }),
      })
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: SettingKey.ENABLE_WAITLIST },
        update: expect.objectContaining({ content: 'false', lastModifiedBy: 'system' }),
      })
    );
  });

  it('is idempotent when the settings are already enforced', async () => {
    const { service, upsert } = makeService({
      singleTenant: true,
      brand: { name: 'SSA', logo: '' },
      currentSettings: {
        [SettingKey.DISALLOW_SIGN_UP]: true,
        [SettingKey.ENABLE_WAITLIST]: false,
        [SettingKey.BRAND_NAME]: 'SSA',
      },
    });

    await service.onApplicationBootstrap();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('mirrors the operator brand into the instance settings', async () => {
    const { service, upsert } = makeService({
      singleTenant: false,
      brand: { name: 'SSA', logo: '/ssa-logo.svg' },
    });

    await service.onApplicationBootstrap();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: SettingKey.BRAND_NAME },
        create: expect.objectContaining({ content: '"SSA"', createdBy: 'system' }),
      })
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: SettingKey.BRAND_LOGO },
        update: expect.objectContaining({ content: '"/ssa-logo.svg"' }),
      })
    );
  });

  it('never throws when the database is unavailable', async () => {
    const upsert = vi.fn();
    const service = new SsaBootstrapService(
      { singleTenant: true, brand: { name: '', logo: '' } } as ISsaConfig,
      { getSetting: vi.fn().mockRejectedValue(new Error('db down')) } as never,
      { txClient: () => ({ setting: { upsert } }) } as never
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });
});

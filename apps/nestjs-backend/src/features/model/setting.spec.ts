import { SettingKey } from '@teable/openapi';
import { stripCanarySpaceIdsFromSettingCache } from './setting';

describe('stripCanarySpaceIdsFromSettingCache', () => {
  it('clears canary spaceIds for the shared setting cache', () => {
    const content = { enabled: true, spaceIds: ['spc1', 'spc2'], forceV2All: false };

    expect(stripCanarySpaceIdsFromSettingCache(SettingKey.CANARY_CONFIG, content)).toEqual({
      enabled: true,
      spaceIds: [],
      forceV2All: false,
    });
  });

  it('does not alter other settings', () => {
    const content = { brandName: 'Teable' };

    expect(stripCanarySpaceIdsFromSettingCache(SettingKey.BRAND_NAME, content)).toBe(content);
  });
});

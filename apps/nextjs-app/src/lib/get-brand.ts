import { BillingProductLevel } from '@teable/openapi';
import type { SsrApi } from '@/backend/api/rest/ssr-api';

export async function getBrand(ssrApi: SsrApi) {
  if (process.env.NEXT_BUILD_ENV_EDITION?.toLowerCase() === 'ee') {
    const [usage, publicSetting] = await Promise.all([
      ssrApi.getInstanceUsage(),
      ssrApi.getPublicSetting(),
    ]);

    if (usage.level === BillingProductLevel.Enterprise) {
      return {
        brandName: publicSetting.brandName,
        logoUrl: publicSetting.brandLogo,
      };
    }
  }
}

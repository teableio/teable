import type { ConfigService } from '@nestjs/config';

export const helpers = (config: ConfigService) => {
  const publicOrigin = config.get<string>('PUBLIC_ORIGIN');
  const brandName = config.get<string>('BRAND_NAME');

  return {
    publicOrigin: function () {
      return publicOrigin;
    },
    brandName: function () {
      return brandName;
    },
    currentYear: function () {
      return new Date().getFullYear();
    },
  };
};

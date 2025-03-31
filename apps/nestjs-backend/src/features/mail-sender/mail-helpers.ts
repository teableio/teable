import type { ConfigService } from '@nestjs/config';

export const helpers = (config: ConfigService) => {
  const publicOrigin = config.get<string>('PUBLIC_ORIGIN');
  return {
    publicOrigin: function () {
      return publicOrigin;
    },
    currentYear: function () {
      return new Date().getFullYear();
    },
  };
};

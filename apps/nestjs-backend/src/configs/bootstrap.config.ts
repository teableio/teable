/* eslint-disable @typescript-eslint/naming-convention */
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const nextJsConfig = registerAs('nextJs', () => ({
  dir: process.env.NEXTJS_DIR ?? '../nextjs-app',
  disable: process.env.NEXTJS_DISABLE === 'true',
}));

export const securityWebConfig = registerAs('security.web', () => ({
  cors: {
    enabled: true,
  },
}));

export const swaggerConfig = registerAs('swagger', () => ({
  disabled: process.env.SWAGGER_DISABLED === 'true',
}));

export type INextJsConfig = ConfigType<typeof nextJsConfig>;
export type ISecurityWebConfig = ConfigType<typeof securityWebConfig>;
export type ISwaggerConfig = ConfigType<typeof swaggerConfig>;

export const bootstrapConfigs = [nextJsConfig, securityWebConfig, swaggerConfig];

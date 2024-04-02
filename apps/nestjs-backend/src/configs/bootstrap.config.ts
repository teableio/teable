/* eslint-disable @typescript-eslint/naming-convention */
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const nextJsConfig = registerAs('nextJs', () => ({
  dir: process.env.NEXTJS_DIR ?? '../nextjs-app',
}));

export const securityWebConfig = registerAs('security.web', () => ({
  cors: {
    enabled: true,
  },
}));

export const tracingConfig = registerAs('tracing', () => ({
  enabled: process.env.TRACING_ENABLED === 'true',
}));

export const apiDocConfig = registerAs('apiDoc', () => ({
  disabled: process.env.API_DOC_DISENABLED === 'true',
  enabledSnippet: process.env.API_DOC_ENABLED_SNIPPET === 'true',
}));

export type INextJsConfig = ConfigType<typeof nextJsConfig>;
export type ISecurityWebConfig = ConfigType<typeof securityWebConfig>;
export type IApiDocConfig = ConfigType<typeof apiDocConfig>;
export const bootstrapConfigs = [nextJsConfig, securityWebConfig, apiDocConfig];

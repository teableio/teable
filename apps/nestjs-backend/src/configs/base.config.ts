/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';
import { resolveSecret } from './secrets/resolve-secret';
import { SECRET_SPECS } from './secrets/secret-specs';

export const baseConfig = registerAs('base', () => ({
  isCloud: process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() === 'CLOUD',
  publicOrigin: process.env.PUBLIC_ORIGIN,
  storagePrefix: process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN,
  secretKey: resolveSecret(SECRET_SPECS.secretKey),
  // HKDF root for EE app env-variable encryption (the one purpose with no
  // dedicated var historically) — resolves dedicated var → SECRET_KEY
  // umbrella → public dev default, exactly like jwtSecret. _OLD is
  // decrypt-only while a rotation is in flight (jwt oldSecret pattern).
  envVariableSecret: resolveSecret(SECRET_SPECS.envVariableSecret),
  envVariableSecretOld: process.env.BACKEND_ENV_VARIABLE_SECRET_OLD || undefined,
  publicDatabaseProxy: process.env.PUBLIC_DATABASE_PROXY,
  defaultMaxBaseDBConnections: Number(process.env.DEFAULT_MAX_BASE_DB_CONNECTIONS ?? 20),
  templateSpaceId: process.env.TEMPLATE_SPACE_ID,
  recordHistoryDisabled: process.env.RECORD_HISTORY_DISABLED === 'true',
  pluginServerPort: process.env.PLUGIN_SERVER_PORT || '3002',
  enableEmailCodeConsole: process.env.ENABLE_EMAIL_CODE_CONSOLE === 'true',
  emailCodeExpiresIn: process.env.BACKEND_EMAIL_CODE_EXPIRES_IN ?? '30m',
  chatContextAttachmentSize: Number(process.env.CHAT_CONTEXT_ATTACHMENT_SIZE ?? 10),
}));

export const BaseConfig = () => Inject(baseConfig.KEY);

export type IBaseConfig = ConfigType<typeof baseConfig>;

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
  // HMAC key of invitation codes: dedicated var → SECRET_KEY → the public dev default.
  // Transitional like the other dedicated secrets: it lets the key change on its own, with
  // _OLD still accepted while links sent before the change are in use, and converges back
  // into SECRET_KEY once that is done.
  invitationSecret: resolveSecret(SECRET_SPECS.invitationSecret),
  invitationSecretOld: process.env.BACKEND_INVITATION_SECRET_OLD || undefined,
  // HKDF root for EE app env-variable encryption (the one purpose with no
  // dedicated var historically) — resolves dedicated var → SECRET_KEY
  // umbrella → public dev default, exactly like jwtSecret. _OLD is
  // decrypt-only while a rotation is in flight (jwt oldSecret pattern).
  envVariableSecret: resolveSecret(SECRET_SPECS.envVariableSecret),
  envVariableSecretOld: process.env.BACKEND_ENV_VARIABLE_SECRET_OLD || undefined,
  // HMAC key of the welcome reward's per-inbox dedupe key (cloud): dedicated var →
  // SECRET_KEY → the public dev default. Transitional: _OLD still counts while stored keys
  // are re-signed by the key convergence, then it converges back into SECRET_KEY.
  welcomeRewardSecret: resolveSecret(SECRET_SPECS.welcomeRewardSecret),
  welcomeRewardSecretOld: process.env.BACKEND_WELCOME_REWARD_SECRET_OLD || undefined,
  templateSpaceId: process.env.TEMPLATE_SPACE_ID,
  recordHistoryDisabled: process.env.RECORD_HISTORY_DISABLED === 'true',
  pluginServerPort: process.env.PLUGIN_SERVER_PORT || '3002',
  enableEmailCodeConsole: process.env.ENABLE_EMAIL_CODE_CONSOLE === 'true',
  emailCodeExpiresIn: process.env.BACKEND_EMAIL_CODE_EXPIRES_IN ?? '30m',
  chatContextAttachmentSize: Number(process.env.CHAT_CONTEXT_ATTACHMENT_SIZE ?? 10),
}));

export const BaseConfig = () => Inject(baseConfig.KEY);

export type IBaseConfig = ConfigType<typeof baseConfig>;

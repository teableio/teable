/* eslint-disable @typescript-eslint/naming-convention */
import { createHmac } from 'node:crypto';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';
import { resolveSecret } from './secrets/resolve-secret';
import { ALL_SECRET_SPECS, SECRET_SPECS } from './secrets/secret-specs';
import { resolveStoredSecretRoots, STORED_SECRET_PURPOSES } from './secrets/stored-secret-roots';

const resolveDataQueryCursorSigningKey = (): string | undefined => {
  // Keep the root first so existing cursors and root rotation retain their behavior.
  // Rootless hosts already configure private JWT/session secrets through this resolver.
  for (const spec of [SECRET_SPECS.secretKey, SECRET_SPECS.jwtSecret, SECRET_SPECS.sessionSecret]) {
    const secret = resolveSecret(spec);
    if (ALL_SECRET_SPECS.some((candidate) => candidate.legacyDefault === secret)) continue;
    // Full, purpose-separated HMAC; rotating the selected secret expires its cursors.
    return createHmac('sha256', secret).update('teable:data-query:cursor:v2').digest('hex');
  }
  return undefined;
};

export const baseConfig = registerAs('base', () => ({
  isCloud: process.env.NEXT_BUILD_ENV_EDITION?.toUpperCase() === 'CLOUD',
  publicOrigin: process.env.PUBLIC_ORIGIN,
  storagePrefix: process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN,
  secretKey: resolveSecret(SECRET_SPECS.secretKey),
  // Every replica must use the same private root, JWT or session secret. Public
  // legacy defaults never enable cursor signing, even when explicitly pinned.
  dataQueryCursorSigningKey: resolveDataQueryCursorSigningKey(),
  // HMAC key of invitation codes: dedicated var → SECRET_KEY → the public dev default.
  // Transitional like the other dedicated secrets: it lets the key change on its own, with
  // _OLD still accepted while links sent before the change are in use, and converges back
  // into SECRET_KEY once that is done.
  invitationSecret: resolveSecret(SECRET_SPECS.invitationSecret),
  invitationSecretOld: process.env.BACKEND_INVITATION_SECRET_OLD || undefined,
  // HKDF roots for EE app env-variable encryption, a purpose of the stored credential root
  // (resolveStoredSecretRoots): the first encrypts, the rest only decrypt what an earlier
  // configuration wrote.
  envVariableRoots: resolveStoredSecretRoots(STORED_SECRET_PURPOSES.envVariable),
  // HMAC keys of the welcome reward's per-inbox dedupe key (cloud), resolved the same way:
  // the first signs, the rest still count while the key convergence re-signs the stored keys.
  welcomeRewardRoots: resolveStoredSecretRoots(STORED_SECRET_PURPOSES.welcomeReward),
  templateSpaceId: process.env.TEMPLATE_SPACE_ID,
  recordHistoryDisabled: process.env.RECORD_HISTORY_DISABLED === 'true',
  pluginServerPort: process.env.PLUGIN_SERVER_PORT || '3002',
  enableEmailCodeConsole: process.env.ENABLE_EMAIL_CODE_CONSOLE === 'true',
  emailCodeExpiresIn: process.env.BACKEND_EMAIL_CODE_EXPIRES_IN ?? '30m',
  chatContextAttachmentSize: Number(process.env.CHAT_CONTEXT_ATTACHMENT_SIZE ?? 10),
}));

export const BaseConfig = () => Inject(baseConfig.KEY);

export type IBaseConfig = ConfigType<typeof baseConfig>;

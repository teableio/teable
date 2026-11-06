import { createHmac, hkdfSync } from 'node:crypto';
import { HttpErrorCode } from '@teable/core';
import { MASKED_SECRET_PREFIX, SettingKey, isMaskedSecret } from '@teable/openapi';
import { mapValues } from 'lodash';
import { resolveSecret } from '../../configs/secrets/resolve-secret';
import { SECRET_SPECS } from '../../configs/secrets/secret-specs';
import { CustomHttpException } from '../../custom.exception';
import {
  decryptAiConfigSecrets,
  encryptAiConfigSecrets,
  mapAiConfigSecrets,
} from '../../utils/ai-config-encryption';
import type { ISecretMapper, ISecretSlotMapper } from '../../utils/secret-value-codec';
import type { ISecretPath } from '../../utils/third-party-credential-encryption';
import {
  decryptThirdPartyCredential,
  encryptThirdPartyCredential,
  mapSecretPaths,
} from '../../utils/third-party-credential-encryption';

/** Secret slots of the instance imConfig setting. Ids, bot names and usernames are not secrets. */
const IM_CONFIG_SECRET_PATHS: readonly ISecretPath[] = [
  ['telegram', 'botToken'],
  ['feishu', 'appSecret'],
  ['slack', 'clientSecret'],
  ['slack', 'signingSecret'],
];

export const mapImConfigSecrets = <T>(config: T, fn: ISecretMapper): T =>
  mapSecretPaths(config, IM_CONFIG_SECRET_PATHS, fn);

/** An SMTP transport config (notify / automation mail settings, app email OTP). */
const MAIL_TRANSPORT_SECRET_PATHS: readonly ISecretPath[] = [['auth', 'pass']];

export const mapMailTransportConfigSecrets = <T>(config: T, fn: ISecretMapper): T =>
  mapSecretPaths(config, MAIL_TRANSPORT_SECRET_PATHS, fn);

/**
 * The app-builder config: setting.appConfig, and the appConfig a space AI
 * integration embeds (ai-integration-secrets.ts). Secrets: the Vercel deploy
 * token, the Google and OIDC client secrets of app sign-in and the email-OTP SMTP password.
 */
export const APP_CONFIG_SECRET_PATHS: readonly ISecretPath[] = [
  ['vercelToken'],
  ['appAuth', 'google', 'clientSecret'],
  ['appAuth', 'oidc', 'clientSecret'],
  ...MAIL_TRANSPORT_SECRET_PATHS.map((path) => ['appAuth', 'emailOtp', 'smtp', ...path]),
];

export const mapAppConfigSecrets = <T>(config: T, fn: ISecretMapper): T =>
  mapSecretPaths(config, APP_CONFIG_SECRET_PATHS, fn);

/**
 * The settings holding third-party credentials, each with the mapper of its secret slots.
 * Encrypted on write and decrypted on read below, and walked by the cipher re-encrypt
 * backfill, so a new credential-bearing setting is added here only.
 */
export const THIRD_PARTY_CREDENTIAL_SETTINGS: Record<string, ISecretSlotMapper> = {
  [SettingKey.IM_CONFIG]: mapImConfigSecrets,
  [SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG]: mapMailTransportConfigSecrets,
  [SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG]: mapMailTransportConfigSecrets,
  [SettingKey.APP_CONFIG]: mapAppConfigSecrets,
};

interface ISettingSecretCodec {
  encrypt: (value: unknown) => unknown;
  decrypt: (value: unknown, logLabel: string) => unknown;
}

const thirdPartyCredentialSettingCodec = (mapSlots: ISecretSlotMapper): ISettingSecretCodec => ({
  encrypt: (value) => mapSlots(value, encryptThirdPartyCredential),
  decrypt: (value, logLabel) =>
    mapSlots(value, (secret) => decryptThirdPartyCredential(secret, logLabel)),
});

/**
 * Settings whose secret slots are stored encrypted: encrypted on write, decrypted
 * on read. aiConfig uses the AI-config codec; the rest the third-party credential
 * codec (its encryption follows BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED).
 */
const SETTING_SECRET_CODECS: Partial<Record<string, ISettingSecretCodec>> = {
  [SettingKey.AI_CONFIG]: { encrypt: encryptAiConfigSecrets, decrypt: decryptAiConfigSecrets },
  ...mapValues(THIRD_PARTY_CREDENTIAL_SETTINGS, thirdPartyCredentialSettingCodec),
};

/** Settings whose content can hold a stored secret. */
export const SECRET_BEARING_SETTINGS = Object.keys(SETTING_SECRET_CODECS);

/** A setting value as stored: its secret slots encrypted; any other setting as is. */
export const encryptSettingSecrets = (name: string, value: unknown): unknown =>
  SETTING_SECRET_CODECS[name]?.encrypt(value) ?? value;

/** A stored setting value with its secret slots decrypted; any other setting as is. */
export const decryptSettingSecrets = (name: string, value: unknown): unknown =>
  SETTING_SECRET_CODECS[name]?.decrypt(value, `setting.${name}`) ?? value;

/**
 * Admin APIs never return a stored secret: each secret slot comes back as a mask
 * (MASKED_SECRET_PREFIX + a fingerprint). Writing a mask back resolves it to the stored
 * secret with that fingerprint, so a client can round-trip a whole config (reordered or
 * trimmed provider lists included) without ever holding the secrets.
 */
const SECRET_SLOT_MAPPERS: Record<string, ISecretSlotMapper> = {
  [SettingKey.AI_CONFIG]: mapAiConfigSecrets,
  ...THIRD_PARTY_CREDENTIAL_SETTINGS,
};

let maskKey: Buffer | undefined;

// Keyed, so a mask offers no offline guess at a weak secret such as an SMTP password, and
// derived from a configured root, so every pod computes the same mask.
const getMaskKey = (): Buffer =>
  (maskKey ??= Buffer.from(
    hkdfSync(
      'sha256',
      resolveSecret(SECRET_SPECS.thirdPartyCredentialEncryptionSecret),
      '',
      'teable:setting-secret-mask',
      32
    )
  ));

const maskSecret: ISecretMapper = (secret) =>
  MASKED_SECRET_PREFIX +
  createHmac('sha256', getMaskKey()).update(secret).digest('base64url').slice(0, 22);

/** Resolves a mask to the secret it fingerprints among the slots of each [stored, mapSlots]. */
const maskResolver = (sources: [stored: unknown, mapSlots: ISecretSlotMapper][]): ISecretMapper => {
  const secretsByMask = new Map<string, string>();
  for (const [stored, mapSlots] of sources) {
    mapSlots(stored, (secret) => {
      secretsByMask.set(maskSecret(secret), secret);
      return secret;
    });
  }
  return (value) => {
    if (!isMaskedSecret(value)) {
      return value;
    }
    const secret = secretsByMask.get(value);
    if (secret === undefined) {
      // The secret changed since the client read it: saving the mask would lose it.
      throw new CustomHttpException(
        'A masked secret no longer matches the saved value, enter it again',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return secret;
  };
};

/** `value` as an API returns it: each secret slot `mapSlots` walks replaced by its mask. */
export const maskSecrets = <T>(value: T, mapSlots: ISecretSlotMapper): T =>
  mapSlots(value, maskSecret);

/**
 * An incoming `value` with each mask resolved to the secret with that fingerprint among
 * the slots of `stored` (the current value); plaintext passes, an unknown mask is refused.
 */
export const unmaskSecrets = <T>(value: T, stored: unknown, mapSlots: ISecretSlotMapper): T =>
  mapSlots(value, maskResolver([[stored, mapSlots]]));

/** A setting value as admin APIs return it: each secret slot masked; any other setting as is. */
export const maskSettingSecrets = <T>(name: string, value: T): T => {
  const mapSlots = SECRET_SLOT_MAPPERS[name];
  return mapSlots ? maskSecrets(value, mapSlots) : value;
};

/** maskSettingSecrets over every setting of a settings object. */
export const maskSettingsSecrets = <T extends object>(settings: T): T =>
  mapValues(settings, (value, name) => maskSettingSecrets(name, value)) as T;

/** An incoming setting value with every mask resolved against the stored value. */
export const unmaskSettingSecrets = <T>(name: string, value: T, stored: unknown): T => {
  const mapSlots = SECRET_SLOT_MAPPERS[name];
  return mapSlots ? unmaskSecrets(value, stored, mapSlots) : value;
};

/** One incoming secret, a mask resolved against any of the stored settings (name → value). */
export const unmaskSecret = (value: string, storedSettings: Record<string, unknown>): string =>
  maskResolver(
    Object.entries(storedSettings).flatMap(([name, stored]) => {
      const mapSlots = SECRET_SLOT_MAPPERS[name];
      return mapSlots ? [[stored, mapSlots] as [unknown, ISecretSlotMapper]] : [];
    })
  )(value);

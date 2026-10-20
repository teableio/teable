import { SettingKey } from '@teable/openapi';
import { mapValues } from 'lodash';
import { decryptAiConfigSecrets, encryptAiConfigSecrets } from '../../utils/ai-config-encryption';
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
 * token, the Google client secret of app sign-in and the email-OTP SMTP password.
 */
export const APP_CONFIG_SECRET_PATHS: readonly ISecretPath[] = [
  ['vercelToken'],
  ['appAuth', 'google', 'clientSecret'],
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

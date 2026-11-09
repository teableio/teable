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
import type { ISecretEndpointField, ISecretSlot } from './secret-binding';
import { assertSecretsReentered, maskSecrets, unmaskSecrets } from './secret-binding';

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
 * Where an SMTP password goes, and how: its server, the account it signs in as, and whether the
 * connection is TLS from the start (turning that off may send the password as plain AUTH).
 */
const SMTP_ENDPOINT: readonly ISecretEndpointField[] = [
  { path: ['host'], match: 'strict' },
  { path: ['port'], match: 'strict' },
  { path: ['auth', 'user'], match: 'strict' },
  { path: ['secure'], match: 'strict', unset: false },
];

/** The notify / automation mail transport settings. */
export const MAIL_TRANSPORT_SECRET_SLOTS: readonly ISecretSlot[] = [
  { secret: ['auth', 'pass'], endpoint: SMTP_ENDPOINT },
];

/** Where gateway credentials go: aiGatewayBaseUrl (left empty: the official gateway). */
const AI_GATEWAY_ENDPOINT: readonly ISecretEndpointField[] = [
  { path: ['aiGatewayBaseUrl'], match: 'orDefault' },
];

/**
 * The gateway API keys (main, pool, concurrency groups) are one kind of credential and may stand
 * in for each other, as a key test does. The Vertex private key goes to the same gateway but is
 * another kind: its mask resolves only to itself, never sent as a gateway API key.
 */
const AI_GATEWAY_API_KEY: Pick<ISecretSlot, 'group' | 'endpoint'> = {
  group: 'aiGatewayApiKey',
  endpoint: AI_GATEWAY_ENDPOINT,
};

/** setting.aiConfig, and the AI part of a space AI integration. */
export const AI_CONFIG_SECRET_SLOTS: readonly ISecretSlot[] = [
  {
    anchor: ['llmProviders', '*'],
    secret: ['apiKey'],
    endpoint: [
      { path: ['type'], match: 'strict' },
      { path: ['baseUrl'], match: 'orDefault' },
    ],
  },
  { secret: ['aiGatewayApiKey'], ...AI_GATEWAY_API_KEY },
  { secret: ['aiGatewayApiKeys', '*'], ...AI_GATEWAY_API_KEY },
  { secret: ['concurrencyGroups', '*', 'keys', '*', 'apiKey'], ...AI_GATEWAY_API_KEY },
  {
    secret: ['vertexByokCredential', 'googleCredentials', 'privateKey'],
    endpoint: AI_GATEWAY_ENDPOINT,
  },
  {
    anchor: ['realtimeTranscription'],
    secret: ['apiKey'],
    endpoint: [{ path: ['endpoint'], match: 'orDefault' }],
  },
];

/** setting.appConfig, and the appConfig a space AI integration embeds. */
export const APP_CONFIG_SECRET_SLOTS: readonly ISecretSlot[] = [
  // The deploy token only goes to the Vercel API. No saved field names another base URL, so
  // a test call pointed at one (its `vercelApiBaseUrl`) has to carry the token itself.
  { secret: ['vercelToken'], endpoint: [{ path: ['vercelApiBaseUrl'], match: 'orDefault' }] },
  { secret: ['appAuth', 'google', 'clientSecret'] },
  {
    anchor: ['appAuth', 'oidc'],
    secret: ['clientSecret'],
    endpoint: [{ path: ['tokenUrl'], match: 'strict' }],
  },
  { anchor: ['appAuth', 'emailOtp', 'smtp'], secret: ['auth', 'pass'], endpoint: SMTP_ENDPOINT },
];

/** setting.imConfig: every credential goes to its platform's fixed endpoints. */
export const IM_CONFIG_SECRET_SLOTS: readonly ISecretSlot[] = IM_CONFIG_SECRET_PATHS.map(
  (secret) => ({ secret })
);

/**
 * The secrets of each secret-bearing setting, for masking: the same slots the codecs above
 * encrypt (setting-secrets.spec.ts holds them to that).
 */
const SETTING_SECRET_SLOTS: Record<string, readonly ISecretSlot[]> = {
  [SettingKey.AI_CONFIG]: AI_CONFIG_SECRET_SLOTS,
  [SettingKey.APP_CONFIG]: APP_CONFIG_SECRET_SLOTS,
  [SettingKey.IM_CONFIG]: IM_CONFIG_SECRET_SLOTS,
  [SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG]: MAIL_TRANSPORT_SECRET_SLOTS,
  [SettingKey.AUTOMATION_MAIL_TRANSPORT_CONFIG]: MAIL_TRANSPORT_SECRET_SLOTS,
};

/** A setting value as admin APIs return it: each secret masked; any other setting as is. */
export const maskSettingSecrets = <T>(name: string, value: T): T => {
  const slots = SETTING_SECRET_SLOTS[name];
  return slots ? maskSecrets(value, slots) : value;
};

/** maskSettingSecrets over every setting of a settings object. */
export const maskSettingsSecrets = <T extends object>(settings: T): T =>
  mapValues(settings, (value, name) => maskSettingSecrets(name, value)) as T;

/**
 * An incoming setting value with its masks resolved against the stored value (secret-binding's
 * unmaskSecrets). `root` is the value about to be stored, when a section patch is merged over it.
 */
export const unmaskSettingSecrets = <T>(
  name: string,
  value: T,
  stored: unknown,
  root: unknown = value
): T => {
  const slots = SETTING_SECRET_SLOTS[name];
  return slots ? unmaskSecrets(value, [stored], slots, root) : value;
};

/** A section patch of a setting must not carry stored secrets to a moved endpoint. */
export const assertSettingSecretsReentered = (name: string, stored: unknown, patch: unknown) => {
  const slots = SETTING_SECRET_SLOTS[name];
  if (slots) assertSecretsReentered(stored, patch, slots);
};

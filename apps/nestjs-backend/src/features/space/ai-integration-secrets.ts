import { decryptAiConfigSecrets, encryptAiConfigSecrets } from '../../utils/ai-config-encryption';
import type { ISecretMapper } from '../../utils/secret-value-codec';
import type { ISecretPath } from '../../utils/third-party-credential-encryption';
import {
  decryptThirdPartyCredential,
  encryptThirdPartyCredential,
  mapSecretPaths,
} from '../../utils/third-party-credential-encryption';
import type { ISecretSlot } from '../setting/secret-binding';
import { maskSecrets, unmaskSecrets } from '../setting/secret-binding';
import {
  AI_CONFIG_SECRET_SLOTS,
  APP_CONFIG_SECRET_PATHS,
  APP_CONFIG_SECRET_SLOTS,
} from '../setting/setting-secrets';

/**
 * A space AI integration config embeds an appConfig. Its secrets use the
 * third-party credential codec (and its write switch), like setting.appConfig —
 * the AI-config codec only covers the AI slots and encrypts unconditionally, so
 * folding these into mapAiConfigSecrets would start writing ciphertext that a
 * build predating this change cannot open (staging and prod share one DB).
 */
const AI_INTEGRATION_APP_CONFIG_SECRET_PATHS: readonly ISecretPath[] = APP_CONFIG_SECRET_PATHS.map(
  (path) => ['appConfig', ...path]
);

export const mapAiIntegrationAppConfigSecrets = <T>(config: T, fn: ISecretMapper): T =>
  mapSecretPaths(config, AI_INTEGRATION_APP_CONFIG_SECRET_PATHS, fn);

/** Encrypt a space AI integration config: the AI slots and the embedded appConfig. */
export const encryptAiIntegrationConfig = <T>(config: T): T =>
  mapAiIntegrationAppConfigSecrets(encryptAiConfigSecrets(config), encryptThirdPartyCredential);

/** Decrypt a space AI integration config: the AI slots and the embedded appConfig. */
export const decryptAiIntegrationConfig = <T>(config: T, logLabel = 'integration'): T =>
  mapAiIntegrationAppConfigSecrets(decryptAiConfigSecrets(config, logLabel), (value) =>
    decryptThirdPartyCredential(value, logLabel)
  );

/**
 * Every secret of a space AI integration config, under the instance settings' rules: the AI
 * slots as setting.aiConfig, the embedded appConfig as setting.appConfig.
 */
export const AI_INTEGRATION_SECRET_SLOTS: readonly ISecretSlot[] = [
  ...AI_CONFIG_SECRET_SLOTS,
  ...APP_CONFIG_SECRET_SLOTS.map((slot) => ({
    ...slot,
    anchor: ['appConfig', ...(slot.anchor ?? [])],
  })),
];

/** A space AI integration config as the API returns it: each secret masked. */
export const maskAiIntegrationConfig = <T>(config: T): T =>
  maskSecrets(config, AI_INTEGRATION_SECRET_SLOTS);

/**
 * An incoming config with each mask resolved against `stored` (secret-binding): a saved secret
 * only resolves while the endpoint it goes to is unchanged. The config is replaced whole, so a
 * secret the client leaves out is dropped, never carried to a new endpoint.
 */
export const unmaskAiIntegrationConfig = <T>(config: T, stored: unknown): T =>
  unmaskSecrets(config, stored ? [stored] : [], AI_INTEGRATION_SECRET_SLOTS);

/** An integration row as the API returns it: the secret slots of its JSON config masked. */
export const maskAiIntegrationRow = <T extends { config: string }>(row: T): T => ({
  ...row,
  config: JSON.stringify(maskAiIntegrationConfig(JSON.parse(row.config))),
});

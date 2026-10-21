import { decryptAiConfigSecrets, encryptAiConfigSecrets } from '../../utils/ai-config-encryption';
import type { ISecretMapper } from '../../utils/secret-value-codec';
import type { ISecretPath } from '../../utils/third-party-credential-encryption';
import {
  decryptThirdPartyCredential,
  encryptThirdPartyCredential,
  mapSecretPaths,
} from '../../utils/third-party-credential-encryption';
import { APP_CONFIG_SECRET_PATHS } from '../setting/setting-secrets';

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

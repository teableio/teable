import { describe, expect, it, vi } from 'vitest';
import { getAiConfigValueCodec } from '../../utils/ai-config-encryption';
import { getThirdPartyCredentialCodec } from '../../utils/third-party-credential-encryption';
import { decryptAiIntegrationConfig, encryptAiIntegrationConfig } from './ai-integration-secrets';

describe('space AI integration secrets', () => {
  it('round-trips a space AI integration config through both codecs', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', 'true');
    try {
      const config = {
        llmProviders: [{ type: 'openai', name: 'p1', apiKey: 'sk-1' }],
        appConfig: { vercelToken: 'vt', customDomain: 'apps.x' },
      };
      const stored = encryptAiIntegrationConfig(config);

      // AI slots under the AI-config codec, appConfig under the third-party credential codec
      expect(getAiConfigValueCodec().decryptValueStrict(stored.llmProviders[0].apiKey)).toBe(
        'sk-1'
      );
      expect(getThirdPartyCredentialCodec().decryptValueStrict(stored.appConfig.vercelToken)).toBe(
        'vt'
      );
      expect(stored.appConfig.customDomain).toBe('apps.x');
      expect(decryptAiIntegrationConfig(stored)).toEqual(config);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the embedded appConfig plaintext while the switch is off', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', '');
    try {
      const stored = encryptAiIntegrationConfig({
        llmProviders: [],
        appConfig: { vercelToken: 'vt' },
      });
      expect(stored.appConfig.vercelToken).toBe('vt');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

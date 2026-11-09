import { HttpErrorCode } from '@teable/core';
import { isMaskedSecret } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { getAiConfigValueCodec } from '../../utils/ai-config-encryption';
import { getThirdPartyCredentialCodec } from '../../utils/third-party-credential-encryption';
import {
  decryptAiIntegrationConfig,
  encryptAiIntegrationConfig,
  maskAiIntegrationConfig,
  unmaskAiIntegrationConfig,
} from './ai-integration-secrets';

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

  describe('masking for the API', () => {
    const stored = {
      llmProviders: [
        { type: 'openai', name: 'p1', apiKey: 'sk-one', baseUrl: 'https://a.example/v1' },
        { type: 'openai', name: 'p2', apiKey: 'sk-two', baseUrl: 'https://b.example/v1' },
      ],
      aiGatewayApiKey: 'gw-key',
      appConfig: { vercelToken: 'vercel-token', customDomain: 'apps.x' },
    };

    it('masks every secret slot, the embedded appConfig included', () => {
      const masked = maskAiIntegrationConfig(stored);

      expect(JSON.stringify(masked)).not.toMatch(/sk-one|sk-two|gw-key|vercel-token/);
      expect(isMaskedSecret(masked.llmProviders[0].apiKey)).toBe(true);
      expect(isMaskedSecret(masked.appConfig.vercelToken)).toBe(true);
      expect(masked.llmProviders[0].baseUrl).toBe('https://a.example/v1');
      expect(masked.appConfig.customDomain).toBe('apps.x');
    });

    it('resolves a round-tripped config back to the stored secrets, keeping new plaintext', () => {
      const masked = maskAiIntegrationConfig(stored);
      // A client reorders the providers, drops one and adds a fresh key.
      const incoming = {
        ...masked,
        llmProviders: [
          masked.llmProviders[1],
          { type: 'openai', name: 'p3', apiKey: 'sk-new', baseUrl: 'https://c.example/v1' },
        ],
      };

      expect(unmaskAiIntegrationConfig(incoming, stored)).toEqual({
        ...stored,
        llmProviders: [
          stored.llmProviders[1],
          { type: 'openai', name: 'p3', apiKey: 'sk-new', baseUrl: 'https://c.example/v1' },
        ],
      });
    });

    it('refuses a mask that matches no stored secret instead of saving it as the key', () => {
      const masked = maskAiIntegrationConfig(stored);
      const rotated = { ...stored, aiGatewayApiKey: 'gw-rotated' };

      expect(() => unmaskAiIntegrationConfig(masked, rotated)).toThrow(
        expect.objectContaining({ code: HttpErrorCode.VALIDATION_ERROR })
      );
      expect(() => unmaskAiIntegrationConfig(masked, undefined)).toThrow(
        expect.objectContaining({ code: HttpErrorCode.VALIDATION_ERROR })
      );
    });
  });
});

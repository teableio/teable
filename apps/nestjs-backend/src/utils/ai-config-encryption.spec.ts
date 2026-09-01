import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_CIPHER_PREFIX,
  AiConfigValueCodec,
  collectAiConfigSecrets,
  decryptAiConfigSecrets,
  encryptAiConfigSecrets,
  isEncryptedAiConfigValue,
  mapAiConfigSecrets,
} from './ai-config-encryption';

const codec = new AiConfigValueCodec({ BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'unit-test-root' });

describe('AiConfigValueCodec', () => {
  it('round-trips a value under the cipher prefix with a random IV', () => {
    const first = codec.encryptValue('sk-live-123');
    const second = codec.encryptValue('sk-live-123');

    expect(first.startsWith(AI_CONFIG_CIPHER_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(codec.decryptValueStrict(first)).toBe('sk-live-123');
    expect(codec.decryptValueStrict(second)).toBe('sk-live-123');
  });

  it('passes plaintext through decryption and never double-encrypts', () => {
    expect(codec.decryptValueStrict('sk-legacy-plain')).toBe('sk-legacy-plain');

    const cipher = codec.encryptValue('sk-live-123');
    expect(codec.encryptValue(cipher)).toBe(cipher);
  });

  it('decrypts via the _OLD root tail and reports such values as not current', () => {
    const oldCodec = new AiConfigValueCodec({
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'previous-root',
    });
    const oldCipher = oldCodec.encryptValue('sk-rotated');

    const rotating = new AiConfigValueCodec({
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'unit-test-root',
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD: 'previous-root',
    });
    expect(rotating.decryptValueStrict(oldCipher)).toBe('sk-rotated');
    expect(rotating.isCurrentValue(oldCipher)).toBe(false);
    expect(rotating.isCurrentValue(rotating.encryptValue('sk-rotated'))).toBe(true);
  });

  it('throws on a ciphertext no configured root opens', () => {
    const foreign = new AiConfigValueCodec({
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'some-other-root',
    }).encryptValue('sk-live-123');

    expect(() => codec.decryptValueStrict(foreign)).toThrow('AI config secret decryption failed');
    expect(codec.isCurrentValue(foreign)).toBe(false);
  });

  it('flags the publicly known zero-config root', () => {
    expect(new AiConfigValueCodec({}).usesPublicDefaultRoot).toBe(true);
    expect(codec.usesPublicDefaultRoot).toBe(false);
    // SECRET_KEY umbrella is private material, not the public default
    expect(new AiConfigValueCodec({ SECRET_KEY: 'instance-root' }).usesPublicDefaultRoot).toBe(
      false
    );
  });
});

describe('mapAiConfigSecrets', () => {
  const fullConfig = {
    llmProviders: [
      { type: 'openai', name: 'p1', apiKey: 'k1', baseUrl: 'https://api.openai.com' },
      { type: 'anthropic', name: 'p2' },
    ],
    aiGatewayApiKey: 'gw',
    aiGatewayApiKeys: ['gw1', 'gw2'],
    concurrencyGroups: [{ id: 'g1', name: 'text', keys: [{ apiKey: 'ck', status: 'verified' }] }],
    vertexByokCredential: {
      project: 'proj',
      location: 'us',
      googleCredentials: { privateKey: 'pem', clientEmail: 'a@b' },
    },
    realtimeTranscription: { enabled: true, apiKey: 'rt' },
    chatModel: { lg: 'openai@gpt@p1' },
  };

  it('visits exactly the secret slots and leaves everything else untouched', () => {
    const mapped = mapAiConfigSecrets(fullConfig, (value) => `enc(${value})`);

    expect(mapped).toEqual({
      ...fullConfig,
      llmProviders: [
        { type: 'openai', name: 'p1', apiKey: 'enc(k1)', baseUrl: 'https://api.openai.com' },
        { type: 'anthropic', name: 'p2' },
      ],
      aiGatewayApiKey: 'enc(gw)',
      aiGatewayApiKeys: ['enc(gw1)', 'enc(gw2)'],
      concurrencyGroups: [
        { id: 'g1', name: 'text', keys: [{ apiKey: 'enc(ck)', status: 'verified' }] },
      ],
      vertexByokCredential: {
        project: 'proj',
        location: 'us',
        googleCredentials: { privateKey: 'enc(pem)', clientEmail: 'a@b' },
      },
      realtimeTranscription: { enabled: true, apiKey: 'enc(rt)' },
    });
    // pure: the input object is never mutated
    expect(fullConfig.llmProviders[0].apiKey).toBe('k1');
    // absent slots are not materialized as undefined properties
    expect('aiGatewayApiKey' in mapAiConfigSecrets({ llmProviders: [] }, (v) => v)).toBe(false);
  });

  it('tolerates non-object configs and malformed slot shapes', () => {
    expect(mapAiConfigSecrets(null, (v) => `x${v}`)).toBeNull();
    expect(mapAiConfigSecrets('raw-string', (v) => `x${v}`)).toBe('raw-string');
    expect(
      mapAiConfigSecrets(
        { llmProviders: ['weird', null], realtimeTranscription: 7 },
        (v) => `x${v}`
      )
    ).toEqual({ llmProviders: ['weird', null], realtimeTranscription: 7 });
  });

  it('collects every secret value for convergence checks', () => {
    expect(collectAiConfigSecrets(fullConfig).sort()).toEqual([
      'ck',
      'gw',
      'gw1',
      'gw2',
      'k1',
      'pem',
      'rt',
    ]);
  });
});

describe('encrypt/decryptAiConfigSecrets (process.env funnels)', () => {
  it('round-trips through the storage shape', () => {
    const stored = encryptAiConfigSecrets({
      llmProviders: [{ type: 'openai', name: 'p1', apiKey: 'sk-plain' }],
    });
    expect(isEncryptedAiConfigValue(stored.llmProviders[0].apiKey)).toBe(true);

    const restored = decryptAiConfigSecrets(stored);
    expect(restored.llmProviders[0].apiKey).toBe('sk-plain');
  });

  it('returns an unopenable ciphertext verbatim instead of failing the read', () => {
    const broken = `${AI_CONFIG_CIPHER_PREFIX}${Buffer.from('garbage-bytes-here-123456').toString('base64')}`;
    const restored = decryptAiConfigSecrets({ aiGatewayApiKey: broken });
    expect(restored.aiGatewayApiKey).toBe(broken);
  });
});

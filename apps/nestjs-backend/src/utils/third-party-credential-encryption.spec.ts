import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiConfigValueCodec } from './ai-config-encryption';
import { SECRET_CIPHER_PREFIX } from './secret-value-codec';
import {
  decryptThirdPartyCredential,
  decryptOptionalThirdPartyCredential,
  encryptThirdPartyCredential,
  encryptOptionalThirdPartyCredential,
  getThirdPartyCredentialCodec,
  ThirdPartyCredentialCodec,
  isThirdPartyCredentialEncryptionEnabled,
  mapSecretPaths,
} from './third-party-credential-encryption';

describe('ThirdPartyCredentialCodec', () => {
  it('round-trips a token under the shared cipher prefix', () => {
    const codec = new ThirdPartyCredentialCodec({
      BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET: 'unit-test-root',
    });
    const cipher = codec.encryptValue('xoxb-123');

    expect(cipher.startsWith(SECRET_CIPHER_PREFIX)).toBe(true);
    expect(codec.decryptValueStrict(cipher)).toBe('xoxb-123');
  });

  it('never shares key material with the AI-config codec, even on the same SECRET_KEY', () => {
    const env = { SECRET_KEY: 'instance-root' };
    const credentialCipher = new ThirdPartyCredentialCodec(env).encryptValue('google-token');
    const aiCipher = new AiConfigValueCodec(env).encryptValue('sk-live-123');

    expect(() => new AiConfigValueCodec(env).decryptValueStrict(credentialCipher)).toThrow();
    expect(() => new ThirdPartyCredentialCodec(env).decryptValueStrict(aiCipher)).toThrow(
      'Third-party credential decryption failed'
    );
  });

  it('decrypts via its own _OLD root during a rotation', () => {
    const oldCipher = new ThirdPartyCredentialCodec({ SECRET_KEY: 'previous-root' }).encryptValue(
      'google-rotated'
    );
    const rotating = new ThirdPartyCredentialCodec({
      BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET: 'new-root',
      BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET_OLD: 'previous-root',
      // The AI-config tail must not open third-party credentials.
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD: 'unrelated',
    });

    expect(rotating.decryptValueStrict(oldCipher)).toBe('google-rotated');
    expect(rotating.isCurrentValue(oldCipher)).toBe(false);
  });

  it('flags the publicly known zero-config root', () => {
    expect(new ThirdPartyCredentialCodec({}).usesPublicDefaultRoot).toBe(true);
    expect(
      new ThirdPartyCredentialCodec({ SECRET_KEY: 'instance-root' }).usesPublicDefaultRoot
    ).toBe(false);
  });
});

describe('decryptThirdPartyCredential', () => {
  it('passes legacy plaintext through and opens ciphertext of the process codec', () => {
    expect(decryptThirdPartyCredential('xoxb-legacy')).toBe('xoxb-legacy');
    const cipher = getThirdPartyCredentialCodec().encryptValue('xoxb-123');
    expect(decryptThirdPartyCredential(cipher, 'im_oauth_installation:x')).toBe('xoxb-123');
  });

  it('returns a ciphertext no key opens verbatim instead of throwing', () => {
    const foreign = new ThirdPartyCredentialCodec({
      BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET: 'some-other-root',
    }).encryptValue('xoxb-123');

    expect(decryptThirdPartyCredential(foreign, 'im_oauth_installation:x')).toBe(foreign);
  });

  it('leaves empty optional columns alone', () => {
    expect(decryptOptionalThirdPartyCredential(null)).toBeNull();
    expect(decryptOptionalThirdPartyCredential(undefined)).toBeUndefined();
    expect(decryptOptionalThirdPartyCredential('')).toBe('');
    const cipher = getThirdPartyCredentialCodec().encryptValue('verify-token');
    expect(decryptOptionalThirdPartyCredential(cipher)).toBe('verify-token');
  });
});

describe('encrypt-on-write switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes plaintext while BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED is not true', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', '');
    expect(isThirdPartyCredentialEncryptionEnabled()).toBe(false);
    expect(encryptThirdPartyCredential('xoxb-123')).toBe('xoxb-123');
  });

  it('encrypts once switched on, and decryption works either way', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', 'true');
    const cipher = encryptThirdPartyCredential('xoxb-123');
    expect(cipher.startsWith(SECRET_CIPHER_PREFIX)).toBe(true);
    expect(encryptOptionalThirdPartyCredential(null)).toBeNull();
    // idempotent: re-saving a stored value never double-encrypts
    expect(encryptThirdPartyCredential(cipher)).toBe(cipher);

    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', 'false');
    expect(decryptThirdPartyCredential(cipher)).toBe('xoxb-123');
  });
});

describe('mapSecretPaths', () => {
  it('rewrites only non-empty strings at the given paths and copies along them', () => {
    const config = { a: { b: 'x', keep: 1 }, c: '', d: { e: 7 }, other: { f: 'y' } };
    const mapped = mapSecretPaths(
      config,
      [['a', 'b'], ['c'], ['d', 'e'], ['missing', 'z']],
      (v) => `enc(${v})`
    );

    expect(mapped).toEqual({ ...config, a: { b: 'enc(x)', keep: 1 } });
    expect(config.a.b).toBe('x');
    // untouched branches are shared, not copied
    expect(mapped.other).toBe(config.other);
    expect(mapSecretPaths(null, [['a']], (v) => v)).toBeNull();
  });
});

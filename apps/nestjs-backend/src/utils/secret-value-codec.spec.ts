import { describe, expect, it } from 'vitest';
import type { ISecretSpec } from '../configs/secrets/secret-specs';
import { SECRET_CIPHER_PREFIX, SecretValueCodec } from './secret-value-codec';

const spec: ISecretSpec = {
  envKey: 'TEST_ROOT',
  usedFor: 'tests',
  legacyDefault: 'public-default',
};

const codec = (env: Record<string, string | undefined>, syntheticIv?: boolean) =>
  new SecretValueCodec(
    { spec, oldEnvKey: 'TEST_ROOT_OLD', hkdfInfo: 'teable:test', label: 'Test', syntheticIv },
    env
  );

describe('SecretValueCodec', () => {
  it('draws a random IV by default, and has no fixed forms', () => {
    const random = codec({ TEST_ROOT: 'root' });
    const first = random.encryptValue('value');
    expect(first.startsWith(SECRET_CIPHER_PREFIX)).toBe(true);
    expect(random.encryptValue('value')).not.toBe(first);
    expect(random.decryptValueStrict(first)).toBe('value');
    expect(() => random.encryptedForms('value')).toThrow('has no fixed forms');
  });

  it('with a synthetic IV, gives one ciphertext per plaintext and key', () => {
    const synthetic = codec({ TEST_ROOT: 'root' }, true);
    const stored = synthetic.encryptValue('value');
    expect(synthetic.encryptValue('value')).toBe(stored);
    expect(synthetic.encryptValue('other')).not.toBe(stored);
    expect(synthetic.decryptValueStrict(stored)).toBe('value');
    // Same root and info, different IV mode: the random codec opens it too.
    expect(codec({ TEST_ROOT: 'root' }).decryptValueStrict(stored)).toBe('value');
  });

  it('lists the forms under the primary and the _OLD root, the primary first', () => {
    const rotating = codec({ TEST_ROOT: 'new', TEST_ROOT_OLD: 'old' }, true);
    expect(rotating.encryptedForms('value')).toEqual([
      codec({ TEST_ROOT: 'new' }, true).encryptValue('value'),
      codec({ TEST_ROOT: 'old' }, true).encryptValue('value'),
    ]);
  });
});

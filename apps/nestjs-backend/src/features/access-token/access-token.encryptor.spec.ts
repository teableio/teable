import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSecret } from '../../configs/secrets/resolve-secret';
import { SECRET_SPECS } from '../../configs/secrets/secret-specs';
import { Encryptor } from '../../utils/encryptor';

const PAT_KEY = 'BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY';
const PAT_IV = 'BACKEND_ACCESS_TOKEN_ENCRYPTION_IV';

// The encryptor and its entries are cached per module, so each env gets a fresh import.
const load = async (env: Record<string, string | undefined>) => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value as string);
  vi.resetModules();
  return import('./access-token.encryptor');
};

const PUBLIC_PAIR = {
  key: SECRET_SPECS.accessTokenEncryptionKey.legacyDefault!,
  iv: SECRET_SPECS.accessTokenEncryptionIv.legacyDefault!,
};
// What a deployment on the public default SECRET_KEY derived: public too, also kept decrypt-only.
const ON_PUBLIC_SECRET_KEY = { SECRET_KEY: SECRET_SPECS.secretKey.legacyDefault! };
const PUBLIC_SECRET_KEY_PAIR = {
  key: resolveSecret(SECRET_SPECS.accessTokenEncryptionKey, ON_PUBLIC_SECRET_KEY),
  iv: resolveSecret(SECRET_SPECS.accessTokenEncryptionIv, ON_PUBLIC_SECRET_KEY),
};

const sealWithPublicPair = (sign: string) =>
  new Encryptor<{ sign: string }>({
    entries: [{ algorithm: 'aes-128-cbc', ...PUBLIC_PAIR }],
    encoding: 'base64',
  }).encrypt({ sign });

describe('access token encryptor', () => {
  beforeEach(() => {
    vi.stubEnv('SECRET_KEY', '');
    vi.stubEnv(PAT_KEY, '');
    vi.stubEnv(PAT_IV, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues under the public pair while nothing is configured', async () => {
    const encryptor = await load({});
    expect(encryptor.signTags()).toEqual({
      current: [encryptor.signTagOf(PUBLIC_PAIR)],
      decryptOnly: [],
      pinned: [],
    });

    expect(encryptor.splitAccessToken(encryptor.getAccessToken('accA', 'signA'))).toEqual({
      prefix: 'teable',
      accessTokenId: 'accA',
      sign: 'signA',
    });
  });

  it('tells a token opened by the decrypt-only public pair after the switch', async () => {
    const encryptor = await load({ SECRET_KEY: 'a-strong-root-secret' });
    expect(encryptor.signTags().decryptOnly).toEqual([
      encryptor.signTagOf(PUBLIC_PAIR),
      encryptor.signTagOf(PUBLIC_SECRET_KEY_PAIR),
    ]);
    // kept for tokens issued before the switch, not pinned for a rotation
    expect(encryptor.signTags().pinned).toEqual([]);
    expect(encryptor.signTags().current).toEqual([encryptor.currentSignTag()]);

    // a new token is sealed by the pair derived from SECRET_KEY
    expect(encryptor.splitAccessToken(encryptor.getAccessToken('accN', 'signN'))?.sign).toBe(
      'signN'
    );
    // a token issued before the switch still opens, through the public pair
    expect(encryptor.splitAccessToken(`teable_accO_${sealWithPublicPair('signO')}`)).toEqual({
      prefix: 'teable',
      accessTokenId: 'accO',
      sign: 'signO',
    });
  });

  it('issues under a dedicated pair', async () => {
    const encryptor = await load({ [PAT_KEY]: '0123456789abcdef', [PAT_IV]: 'fedcba9876543210' });
    expect(encryptor.signTags()).toEqual({
      current: [encryptor.signTagOf({ key: '0123456789abcdef', iv: 'fedcba9876543210' })],
      decryptOnly: [],
      pinned: [],
    });
    expect(encryptor.splitAccessToken(encryptor.getAccessToken('accD', 'signD'))?.sign).toBe(
      'signD'
    );
  });

  it('opens a token the switched deployment issued', async () => {
    const switched = await load({ SECRET_KEY: 'a-strong-root-secret' });
    const token = switched.getAccessToken('accN', 'signN');
    // the same SECRET_KEY, still on the dedicated (public) pair: mid-rollout, or the other
    // deployment sharing the database
    const notYet = await load({
      SECRET_KEY: 'a-strong-root-secret',
      [PAT_KEY]: SECRET_SPECS.accessTokenEncryptionKey.legacyDefault,
      [PAT_IV]: SECRET_SPECS.accessTokenEncryptionIv.legacyDefault,
    });
    expect(notYet.splitAccessToken(token)).toEqual({
      prefix: 'teable',
      accessTokenId: 'accN',
      sign: 'signN',
    });
  });

  it('refuses a tagged sign sealed under a pair other than the one its tag names', async () => {
    const encryptor = await load({ SECRET_KEY: 'a-strong-root-secret' });
    const issued = `${encryptor.currentSignTag()}.abcdefghijklm`;
    // issued under the derived pair: opens
    expect(encryptor.splitAccessToken(encryptor.getAccessToken('accN', issued))?.sign).toBe(issued);
    // the same sign sealed under the public pair, which this deployment still accepts: refused
    expect(encryptor.splitAccessToken(`teable_accN_${sealWithPublicPair(issued)}`)).toBeNull();
    // a sign the public pair did issue, and a sign from before tags: both open as before
    const underPublic = `${encryptor.signTagOf(PUBLIC_PAIR)}.abcdefghijklm`;
    expect(encryptor.splitAccessToken(`teable_accP_${sealWithPublicPair(underPublic)}`)).toEqual({
      prefix: 'teable',
      accessTokenId: 'accP',
      sign: underPublic,
    });
    expect(
      encryptor.splitAccessToken(`teable_accU_${sealWithPublicPair('0123456789abcdef')}`)?.sign
    ).toBe('0123456789abcdef');
  });

  it('opens a tagged token after its pair moved to _OLD, and not once _OLD is gone', async () => {
    const before = await load({ [PAT_KEY]: '0123456789abcdef', [PAT_IV]: 'fedcba9876543210' });
    const sign = `${before.currentSignTag()}.abcdefghijklm`;
    const token = before.getAccessToken('accR', sign);

    // rotated: a new pair issues, the previous one stays in _OLD
    const rotated = await load({
      [PAT_KEY]: 'a1b2c3d4e5f6a7b8',
      [PAT_IV]: '8b7a6f5e4d3c2b1a',
      [`${PAT_KEY}_OLD`]: '0123456789abcdef',
      [`${PAT_IV}_OLD`]: 'fedcba9876543210',
    });
    expect(rotated.currentSignTag()).not.toBe(before.currentSignTag());
    expect(rotated.signTags().decryptOnly).toEqual([before.currentSignTag()]);
    expect(rotated.signTags().pinned).toEqual([before.currentSignTag()]);
    // _OLD opens it, and the tag names _OLD: accepted
    expect(rotated.splitAccessToken(token)).toEqual({
      prefix: 'teable',
      accessTokenId: 'accR',
      sign,
    });

    // _OLD removed: no entry opens it, tag check or not
    const cut = await load({ [`${PAT_KEY}_OLD`]: '', [`${PAT_IV}_OLD`]: '' });
    expect(cut.splitAccessToken(token)).toBeNull();
  });

  it('reads a tag only from a sign of the tagged shape', async () => {
    const { signTagIn } = await load({});
    expect(signTagIn('a1b2c3.abcdefghijklm')).toBe('a1b2c3');
    expect(signTagIn('0123456789abcdef')).toBeUndefined();
    // longer tags never shipped: such a sign is treated like one without a tag
    expect(signTagIn('a1b2c3d4.abcdefghijklmnop')).toBeUndefined();
  });

  it('keeps tokens as long as they were before signs carried a tag', async () => {
    const encryptor = await load({});
    const tagged = `${encryptor.currentSignTag()}.${'x'.repeat(encryptor.SIGN_RANDOM_LENGTH)}`;
    const sealed = (sign: string) => encryptor.getAccessToken('acc1', sign).split('_')[2];
    expect(sealed(tagged)).toHaveLength(sealed('y'.repeat(16)).length);
  });

  it('rejects a token no entry can open', async () => {
    const encryptor = await load({ [PAT_KEY]: '0123456789abcdef', [PAT_IV]: 'fedcba9876543210' });
    // the public pair is not kept decrypt-only while a dedicated pair is set
    expect(encryptor.splitAccessToken(`teable_accO_${sealWithPublicPair('signO')}`)).toBeNull();
    expect(encryptor.splitAccessToken('teable_accX_not-a-ciphertext')).toBeNull();
  });
});

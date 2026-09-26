import { describe, expect, it } from 'vitest';
import { collectChangedKeys, collectChangedPatchKeys } from './changed-setting-keys';

describe('collectChangedKeys', () => {
  it('names the changed leaves of nested objects as dot paths', () => {
    expect(
      collectChangedKeys(
        { host: 'a', auth: { user: 'u', pass: 'old' }, port: 25 },
        { host: 'a', auth: { user: 'u', pass: 'new' }, port: 465 }
      )
    ).toEqual(['auth.pass', 'port']);
  });

  it('compares arrays as a whole', () => {
    expect(
      collectChangedKeys({ llmProviders: [{ apiKey: 'a' }] }, { llmProviders: [{ apiKey: 'b' }] })
    ).toEqual(['llmProviders']);
  });

  it('treats a missing value like null and reports added or removed keys', () => {
    expect(collectChangedKeys({ a: null }, {})).toEqual([]);
    expect(collectChangedKeys(null, { telegram: { botToken: 't' } })).toEqual([
      'telegram.botToken',
    ]);
    expect(collectChangedKeys({ slack: { clientId: 'c' } }, { slack: undefined })).toEqual([
      'slack.clientId',
    ]);
  });
});

describe('collectChangedPatchKeys', () => {
  it('ignores keys the patch does not set and keys it leaves unchanged', () => {
    expect(
      collectChangedPatchKeys(
        { disallowSignUp: true, brandName: 'x' },
        { disallowSignUp: true, brandName: 'y', enableWaitlist: undefined }
      )
    ).toEqual(['brandName']);
  });
});

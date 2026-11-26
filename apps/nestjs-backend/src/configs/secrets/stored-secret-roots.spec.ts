import { describe, expect, it } from 'vitest';
import {
  isPublicDefaultStoredRoot,
  resolveStoredSecretRoots,
  STORED_SECRET_PURPOSES,
} from './stored-secret-roots';

const { aiConfig, dataDbUrl } = STORED_SECRET_PURPOSES;
const STORED = 'BACKEND_STORED_CREDENTIAL_ENCRYPTION_SECRET';

describe('resolveStoredSecretRoots', () => {
  it('runs on the public default with nothing set, and nothing else reads', () => {
    const roots = resolveStoredSecretRoots(aiConfig, {});
    expect(roots).toEqual({ primary: 'defaultSecretKey', decryptOnly: [] });
    expect(isPublicDefaultStoredRoot(roots.primary)).toBe(true);
  });

  it('follows SECRET_KEY alone, as before the stored credential root existed', () => {
    expect(resolveStoredSecretRoots(aiConfig, { SECRET_KEY: 'root' })).toEqual({
      primary: 'root',
      decryptOnly: [],
    });
  });

  it('keeps the superseded dedicated var writing while it is set', () => {
    expect(
      resolveStoredSecretRoots(aiConfig, {
        SECRET_KEY: 'root',
        BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'own',
        BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD: 'own-old',
      })
    ).toEqual({ primary: 'own', decryptOnly: ['root', 'own-old'] });
  });

  it('writes under the stored credential root once set, and still reads what SECRET_KEY wrote', () => {
    expect(resolveStoredSecretRoots(aiConfig, { SECRET_KEY: 'root', [STORED]: 'stored' })).toEqual({
      primary: 'stored',
      decryptOnly: ['root'],
    });
  });

  it("reads under the stored credential root's _OLD while the root itself is unset", () => {
    // The first of the two steps wherever processes share a database: every reader gets the
    // new root before anyone writes under it.
    expect(
      resolveStoredSecretRoots(aiConfig, { SECRET_KEY: 'root', [`${STORED}_OLD`]: 'stored' })
    ).toEqual({ primary: 'root', decryptOnly: ['stored'] });
  });

  it('opens each side of the switch from the other: no reader is left behind', () => {
    const before = resolveStoredSecretRoots(aiConfig, {
      SECRET_KEY: 'root',
      [`${STORED}_OLD`]: 'stored',
    });
    const after = resolveStoredSecretRoots(aiConfig, { SECRET_KEY: 'root', [STORED]: 'stored' });
    expect([before.primary, ...before.decryptOnly]).toContain(after.primary);
    expect([after.primary, ...after.decryptOnly]).toContain(before.primary);
  });

  it('does not list a root twice, nor the writing root among the readers', () => {
    expect(
      resolveStoredSecretRoots(aiConfig, {
        SECRET_KEY: 'same',
        [STORED]: 'same',
        [`${STORED}_OLD`]: 'same',
        BACKEND_AI_CONFIG_ENCRYPTION_SECRET_OLD: 'old',
      })
    ).toEqual({ primary: 'same', decryptOnly: ['old'] });
  });

  it('never reads under the public default on its own', () => {
    const roots = resolveStoredSecretRoots(aiConfig, { [STORED]: 'stored' });
    expect(roots).toEqual({ primary: 'stored', decryptOnly: [] });
  });

  it('treats an empty var as unset', () => {
    expect(
      resolveStoredSecretRoots(aiConfig, {
        SECRET_KEY: 'root',
        [STORED]: '',
        BACKEND_AI_CONFIG_ENCRYPTION_SECRET: '',
        [`${STORED}_OLD`]: '',
      })
    ).toEqual({ primary: 'root', decryptOnly: [] });
  });

  it('resolves each purpose from its own vars only', () => {
    const env = {
      SECRET_KEY: 'root',
      [STORED]: 'stored',
      BACKEND_DATA_DB_URL_ENCRYPTION_SECRET_OLD: 'previous',
      // another purpose's vars are not this one's
      BACKEND_AI_CONFIG_ENCRYPTION_SECRET: 'own',
    };

    expect(resolveStoredSecretRoots(dataDbUrl, env)).toEqual({
      primary: 'stored',
      decryptOnly: ['root', 'previous'],
    });
    // the BYODB URL format's superseded root resolves like the other dedicated vars
    expect(
      resolveStoredSecretRoots(dataDbUrl, {
        ...env,
        BACKEND_DATA_DB_URL_ENCRYPTION_SECRET: 'byodb',
      })
    ).toEqual({ primary: 'byodb', decryptOnly: ['stored', 'root', 'previous'] });
  });
});

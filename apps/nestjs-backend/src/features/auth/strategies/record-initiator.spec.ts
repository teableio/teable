import { ANONYMOUS_USER } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { AccessTokenStrategy } from './access-token.strategy';
import { AnonymousStrategy } from './anonymous/anonymous.strategy';
import { SessionStrategy } from './session.strategy';

const platformUser = {
  id: 'usrAuthenticated',
  name: 'Authenticated',
  email: 'person@example.com',
  isAdmin: false,
  isSystem: false,
  notifyMeta: '{}',
};

describe('Authenticated platform record initiators', () => {
  it('maps a validated interactive session to the actual user, not client attribution', async () => {
    const cls = { set: vi.fn() };
    const users = { getUserById: vi.fn(async () => platformUser) };
    const strategy = new SessionStrategy({} as never, users as never, cls as never);
    await strategy.validate({ id: platformUser.id });
    expect(cls.set).toHaveBeenCalledWith('recordInitiator', { type: 'user', id: platformUser.id });
  });

  it.each([false, true])(
    'maps PAT executor to a user only when the authenticated account is not technical (system=%s)',
    async (isSystem) => {
      const cls = { set: vi.fn() };
      const users = { getUserById: vi.fn(async () => ({ ...platformUser, isSystem })) };
      const tokens = {
        validate: vi.fn(async () => ({ userId: platformUser.id, accessTokenId: 'patPersisted' })),
      };
      const strategy = new AccessTokenStrategy(
        {} as never,
        users as never,
        cls as never,
        tokens as never
      );
      await strategy.validate({ accessTokenId: 'patPersisted', sign: 'proof' });
      expect(cls.set).toHaveBeenCalledWith('accessTokenId', 'patPersisted');
      expect(cls.set).toHaveBeenCalledWith(
        'recordInitiator',
        isSystem ? undefined : { type: 'user', id: platformUser.id }
      );
    }
  );

  it('explicitly clears any previous initiator when anonymous authentication replaces the executor', async () => {
    const cls = { set: vi.fn() };
    const strategy = new AnonymousStrategy(cls as never);
    await strategy.validate();
    expect(cls.set).toHaveBeenCalledWith('user', ANONYMOUS_USER);
    expect(cls.set).toHaveBeenCalledWith('recordInitiator', undefined);
  });
});

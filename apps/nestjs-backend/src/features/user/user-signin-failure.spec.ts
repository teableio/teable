import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { UserService } from './user.service';

const account = {
  id: 'usrAda',
  email: 'ada@example.com',
  password: 'hash',
  accounts: [],
  isSystem: null,
  deactivatedTime: null,
};

const createFixture = (user: Record<string, unknown> | null) => {
  const findUnique = vi.fn().mockResolvedValue(user);
  const prismaService = { txClient: () => ({ user: { findUnique } }) };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const service = new UserService(
    prismaService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([row]) => row);
  return { service, audit, findUnique, rows };
};

describe('UserService.recordSigninFailure', () => {
  it('writes user.signin-failed on the targeted account', async () => {
    const fixture = createFixture(account);

    await fixture.service.recordSigninFailure({
      email: 'Ada@Example.com',
      method: 'password',
      reason: 'wrong-password',
      attempts: 2,
    });

    expect(fixture.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ada@example.com', deletedTime: null } })
    );
    expect(fixture.rows()).toEqual([
      {
        action: 'user.signin-failed',
        resourceId: 'usrAda',
        userId: 'usrAda',
        params: { reason: 'wrong-password', method: 'password', attempts: 2 },
      },
    ]);
  });

  it('attributes attempts on an unknown address to anonymous with only an email hash', async () => {
    const fixture = createFixture(null);

    await fixture.service.recordSigninFailure({ email: ' Who@Example.com ', method: 'password' });

    const emailHash = createHash('sha256').update('who@example.com').digest('hex');
    expect(fixture.rows()).toEqual([
      {
        action: 'user.signin-failed',
        resourceId: 'anonymous',
        userId: 'anonymous',
        params: { reason: 'not-registered', method: 'password', emailHash },
      },
    ]);
    expect(JSON.stringify(fixture.rows())).not.toMatch(/who@example\.com/i);
  });

  it('derives the reason from the account when the caller does not know it', async () => {
    const cases: [Record<string, unknown>, 'password' | 'email-code', string][] = [
      [{ ...account, password: null, accounts: [] }, 'password', 'not-registered'],
      [{ ...account, password: null, accounts: [{ id: 'acc1' }] }, 'password', 'password-not-set'],
      [{ ...account, isSystem: true }, 'password', 'system-user'],
      [{ ...account, deactivatedTime: new Date() }, 'email-code', 'deactivated'],
      [account, 'email-code', 'error'],
    ];
    for (const [user, method, reason] of cases) {
      const fixture = createFixture(user);
      await fixture.service.recordSigninFailure({ email: account.email, method });
      expect(fixture.rows()[0]).toMatchObject({ params: { reason, method } });
    }
  });

  it('also writes user.lockout when the failure locked the account', async () => {
    const fixture = createFixture(account);

    await fixture.service.recordSigninFailure({
      email: account.email,
      method: 'password',
      reason: 'wrong-password',
      attempts: 5,
      lockoutMinutes: 15,
    });

    expect(fixture.rows()).toEqual([
      expect.objectContaining({ action: 'user.signin-failed' }),
      {
        action: 'user.lockout',
        resourceId: 'usrAda',
        userId: 'usrAda',
        params: { lockoutMinutes: 15, attempts: 5 },
      },
    ]);
  });

  it('never throws, even when the account lookup fails', async () => {
    const fixture = createFixture(null);
    fixture.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      fixture.service.recordSigninFailure({ email: account.email, method: 'password' })
    ).resolves.toBeUndefined();
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });
});

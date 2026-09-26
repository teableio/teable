import * as bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';
import { LocalAuthService } from './local-auth.service';

const USER_ID = 'usrAda';
const EMAIL = 'ada@example.com';

const createFixture = async ({ password = 'old-password' }: { password?: string | null } = {}) => {
  const salt = await bcrypt.genSalt(4);
  const stored = password == null ? null : await bcrypt.hash(password, salt);
  const user = { id: USER_ID, email: EMAIL, password: stored, salt, accounts: [] };
  const update = vi.fn().mockResolvedValue(undefined);
  const prismaService = { txClient: () => ({ user: { update } }) };
  const userService = {
    getUserById: vi.fn().mockResolvedValue(user),
    getUserByEmail: vi.fn().mockResolvedValue(user),
    refreshLastSignTime: vi.fn().mockResolvedValue(undefined),
    recordSigninFailure: vi.fn().mockResolvedValue(undefined),
  };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? USER_ID : undefined)) };
  const sessionStoreService = { clearByUserId: vi.fn().mockResolvedValue(undefined) };
  const cacheStore = new Map<string, unknown>();
  const cacheService = {
    get: vi.fn(async (key: string) => cacheStore.get(key)),
    set: vi.fn(async (key: string, value: unknown) => void cacheStore.set(key, value)),
    del: vi.fn(async (key: string) => cacheStore.delete(key)),
    incr: vi.fn().mockResolvedValue(1),
  };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const service = new LocalAuthService(
    prismaService as never,
    userService as never,
    cls as never,
    sessionStoreService as never,
    {} as never,
    cacheService as never,
    {} as never,
    { signinVerificationExpiresIn: '10m', signinVerificationMaxAttempts: 5 } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([row]) => row);
  return { service, update, userService, sessionStoreService, cacheStore, audit, rows };
};

describe('LocalAuthService password audit', () => {
  it('writes user.password.change once the password is changed, never the password', async () => {
    const fixture = await createFixture();

    await fixture.service.changePassword({ password: 'old-password', newPassword: 'new-pass1' });

    expect(fixture.update).toHaveBeenCalled();
    expect(fixture.sessionStoreService.clearByUserId).toHaveBeenCalledWith(USER_ID);
    expect(fixture.rows()).toEqual([
      expect.objectContaining({ action: 'user.password.change', resourceId: USER_ID }),
    ]);
    expect(JSON.stringify(fixture.rows())).not.toMatch(/password"|new-pass1|old-password/);
  });

  it('writes nothing when the current password is wrong', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.service.changePassword({ password: 'guess', newPassword: 'new-pass1' })
    ).rejects.toThrow('Password is incorrect');
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes user.password.reset for the owner of the emailed code', async () => {
    const fixture = await createFixture();
    fixture.cacheStore.set('reset-password-email:code123', { userId: USER_ID });

    await fixture.service.resetPassword('code123', 'new-pass1');

    expect(fixture.rows()).toEqual([
      { action: 'user.password.reset', resourceId: USER_ID, userId: USER_ID },
    ]);
  });

  it('writes nothing for an invalid reset code', async () => {
    const fixture = await createFixture();

    await expect(fixture.service.resetPassword('nope', 'new-pass1')).rejects.toThrow(
      'Token is invalid'
    );
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes user.password.create when a social-only account sets a password', async () => {
    const fixture = await createFixture({ password: null });

    await fixture.service.addPassword('new-pass1');

    expect(fixture.rows()).toEqual([
      expect.objectContaining({ action: 'user.password.create', resourceId: USER_ID }),
    ]);
  });

  it('writes nothing when the account already has a password', async () => {
    const fixture = await createFixture();

    await expect(fixture.service.addPassword('new-pass1')).rejects.toThrow(
      'Password is already set'
    );
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });
});

describe('LocalAuthService.signinWithCode failure audit', () => {
  it('records a wrong code as bad-code', async () => {
    const fixture = await createFixture();
    fixture.cacheStore.set(`auth:signin-code:${EMAIL}`, { code: '123456', email: EMAIL });

    await expect(fixture.service.signinWithCode(EMAIL, '000000')).rejects.toThrow(
      'Verification code is invalid'
    );
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'email-code',
      reason: 'bad-code',
    });
    expect(fixture.userService.refreshLastSignTime).not.toHaveBeenCalled();
  });

  it('leaves the reason to the account state once the code was right', async () => {
    const fixture = await createFixture();
    fixture.userService.getUserByEmail.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: 'hash',
      accounts: [],
      deactivatedTime: new Date(),
    });
    fixture.cacheStore.set(`auth:signin-code:${EMAIL}`, { code: '123456', email: EMAIL });

    await expect(fixture.service.signinWithCode(EMAIL, '123456')).rejects.toThrow('deactivated');
    expect(fixture.userService.recordSigninFailure).toHaveBeenCalledWith({
      email: EMAIL,
      method: 'email-code',
      reason: undefined,
    });
  });

  it('records nothing on a successful code sign-in', async () => {
    const fixture = await createFixture();
    fixture.cacheStore.set(`auth:signin-code:${EMAIL}`, { code: '123456', email: EMAIL });

    await fixture.service.signinWithCode(EMAIL, '123456');

    expect(fixture.userService.refreshLastSignTime).toHaveBeenCalledWith(USER_ID);
    expect(fixture.userService.recordSigninFailure).not.toHaveBeenCalled();
  });
});

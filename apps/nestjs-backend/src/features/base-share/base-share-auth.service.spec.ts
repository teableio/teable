import { HttpErrorCode } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { BaseShareAuthService } from './base-share-auth.service';

const createFixture = (
  share: { password: string | null; enabled: boolean; baseId: string } | null,
  signedInUserId?: string
) => {
  const prismaService = {
    baseShare: {
      findUnique: vi.fn().mockResolvedValue(share && { shareId: 'shrBase', ...share }),
    },
  };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? signedInUserId : undefined)) };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const service = new BaseShareAuthService(
    prismaService as never,
    {} as never,
    cls as never,
    audit as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([row]) => row);
  return { service, audit, rows };
};

describe('BaseShareAuthService password audit', () => {
  it('writes share.base.auth-failed for a wrong password, attributed to anonymous', async () => {
    const fixture = createFixture({ password: 'secret', enabled: true, baseId: 'bseShared' });

    await expect(fixture.service.authBaseShare('shrBase', 'guess')).resolves.toBeNull();

    expect(fixture.rows()).toEqual([
      {
        action: 'share.base.auth-failed',
        resourceId: 'shrBase',
        userId: 'anonymous',
        params: { shareId: 'shrBase', baseId: 'bseShared' },
      },
    ]);
    expect(JSON.stringify(fixture.rows())).not.toContain('guess');
  });

  it('writes share.base.auth for the right password, attributed to the session user', async () => {
    const fixture = createFixture({ password: 'secret', enabled: true, baseId: 'bseShared' });

    await expect(fixture.service.authBaseShare('shrBase', 'secret', 'usrVisitor')).resolves.toBe(
      'shrBase'
    );

    expect(fixture.rows()).toEqual([
      {
        action: 'share.base.auth',
        resourceId: 'shrBase',
        userId: 'usrVisitor',
        params: { shareId: 'shrBase', baseId: 'bseShared' },
      },
    ]);
    expect(JSON.stringify(fixture.rows())).not.toContain('secret');
  });

  it('falls back to the CLS user when no session user is passed', async () => {
    const fixture = createFixture(
      { password: 'secret', enabled: true, baseId: 'bseShared' },
      'usrCls'
    );

    await fixture.service.authBaseShare('shrBase', 'secret');

    expect(fixture.rows()[0]).toMatchObject({ userId: 'usrCls' });
  });

  it('writes nothing for a missing or disabled share', async () => {
    const missing = createFixture(null);
    const disabled = createFixture({ password: 'secret', enabled: false, baseId: 'bseShared' });

    await expect(missing.service.authBaseShare('shrBase', 'secret')).resolves.toBeNull();
    await expect(disabled.service.authBaseShare('shrBase', 'secret')).resolves.toBeNull();

    expect(missing.audit.emitAtomic).not.toHaveBeenCalled();
    expect(disabled.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes nothing when the share has no password restriction', async () => {
    const fixture = createFixture({ password: null, enabled: true, baseId: 'bseShared' });

    await expect(fixture.service.authBaseShare('shrBase', 'secret')).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('does not audit the cookie check of an already unlocked share', async () => {
    const fixture = createFixture({ password: 'secret', enabled: true, baseId: 'bseShared' });

    await fixture.service.authBaseShareByHash('shrBase', 'whatever');

    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });
});

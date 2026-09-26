import { describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from './access-token.service';

const USER_ID = 'usrAda';
const TOKEN_ID = 'accToken1';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: TOKEN_ID,
  name: 'ci token',
  description: null,
  scopes: JSON.stringify(['record|read']),
  spaceIds: JSON.stringify(['spc1']),
  baseIds: null,
  hasFullAccess: null,
  ...overrides,
});

const createFixture = () => {
  const accessToken = {
    findFirst: vi.fn().mockResolvedValue(row()),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const prismaService = { accessToken };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? USER_ID : undefined)) };
  const performanceCacheService = { del: vi.fn().mockResolvedValue(undefined) };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const service = new AccessTokenService(
    prismaService as never,
    cls as never,
    {} as never,
    performanceCacheService as never,
    audit as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([call]) => call);
  return { service, accessToken, audit, rows };
};

describe('AccessTokenService audit', () => {
  it('writes access-token.update with each changed setting before and after', async () => {
    const fixture = createFixture();
    fixture.accessToken.update.mockResolvedValue(
      row({ scopes: JSON.stringify(['record|read', 'record|update']), hasFullAccess: true })
    );

    await fixture.service.updateAccessToken(TOKEN_ID, {
      name: 'ci token',
      scopes: ['record|read', 'record|update'],
      spaceIds: ['spc1'],
      hasFullAccess: true,
    });

    expect(fixture.accessToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TOKEN_ID, userId: USER_ID } })
    );
    expect(fixture.rows()).toEqual([
      {
        action: 'access-token.update',
        resourceId: TOKEN_ID,
        params: {
          accessTokenId: TOKEN_ID,
          name: 'ci token',
          changes: {
            scopes: { before: ['record|read'], after: ['record|read', 'record|update'] },
            hasFullAccess: { before: null, after: true },
          },
        },
      },
    ]);
  });

  it('writes nothing for an update that changed no setting', async () => {
    const fixture = createFixture();
    fixture.accessToken.update.mockResolvedValue(row());

    await fixture.service.updateAccessToken(TOKEN_ID, {
      name: 'ci token',
      scopes: ['record|read'],
      spaceIds: ['spc1'],
    });

    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes nothing when the update fails', async () => {
    const fixture = createFixture();
    fixture.accessToken.update.mockRejectedValue(new Error('Record to update not found'));

    await expect(
      fixture.service.updateAccessToken(TOKEN_ID, { name: 'x', scopes: ['record|read'] })
    ).rejects.toThrow('Record to update not found');
    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes access-token.refresh with the new expiry and never the token', async () => {
    const fixture = createFixture();
    const expiredTime = new Date('2027-01-01T00:00:00.000Z');
    fixture.accessToken.update.mockResolvedValue({ ...row(), expiredTime, lastUsedTime: null });

    const result = await fixture.service.refreshAccessToken(TOKEN_ID, {
      expiredTime: expiredTime.toISOString(),
    });

    expect(fixture.rows()).toEqual([
      {
        action: 'access-token.refresh',
        resourceId: TOKEN_ID,
        params: {
          accessTokenId: TOKEN_ID,
          name: 'ci token',
          expiredTime: '2027-01-01T00:00:00.000Z',
        },
      },
    ]);
    expect(JSON.stringify(fixture.rows())).not.toContain(result.token);
  });

  it('records the deleted token id on access-token.delete', async () => {
    const fixture = createFixture();

    await fixture.service.deleteAccessToken(TOKEN_ID);

    expect(fixture.rows()).toEqual([
      expect.objectContaining({
        action: 'access-token.delete',
        resourceId: USER_ID,
        params: { accessTokenId: TOKEN_ID },
      }),
    ]);
  });
});

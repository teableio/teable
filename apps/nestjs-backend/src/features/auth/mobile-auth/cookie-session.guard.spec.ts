import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { CookieSessionGuard } from './cookie-session.guard';

const contextFor = (req: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const guardWith = (entries: Array<[string, unknown]>) => {
  const cls = new Map(entries);
  return new CookieSessionGuard({
    get: (key: string) => cls.get(key),
  } as unknown as ClsService<IClsStore>);
};

describe('CookieSessionGuard', () => {
  const session = { passport: { user: { id: 'usr1' } } };

  it('accepts a request authenticated by the browser session cookie', () => {
    const guard = guardWith([['user.id', 'usr1']]);
    expect(guard.canActivate(contextFor({ headers: {}, session }))).toBe(true);
  });

  it('rejects bearer credentials, access tokens and base-scoped JWTs', () => {
    expect(() =>
      guardWith([['user.id', 'usr1']]).canActivate(
        contextFor({ headers: { authorization: 'Bearer x' }, session })
      )
    ).toThrow(ForbiddenException);
    expect(() =>
      guardWith([
        ['user.id', 'usr1'],
        ['accessTokenId', 'act1'],
      ]).canActivate(contextFor({ headers: {}, session }))
    ).toThrow(ForbiddenException);
    expect(() =>
      guardWith([
        ['user.id', 'usr1'],
        ['tempAuthBaseId', 'bse1'],
      ]).canActivate(contextFor({ headers: {}, session }))
    ).toThrow(ForbiddenException);
  });

  it('rejects requests whose session carries no user or a different user', () => {
    expect(() =>
      guardWith([['user.id', 'usr1']]).canActivate(contextFor({ headers: {}, session: {} }))
    ).toThrow(ForbiddenException);
    expect(() =>
      guardWith([['user.id', 'usr2']]).canActivate(contextFor({ headers: {}, session }))
    ).toThrow(ForbiddenException);
  });
});

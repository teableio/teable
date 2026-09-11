import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { MobileAuthController } from './mobile-auth.controller';
import type { MobileAuthService } from './mobile-auth.service';

const NATIVE_SID = 'sid-native';
const CHILD_SID = 'sid-child';
const CLIENT = 'mobile/0.1.0';
const user = { id: 'usr1', name: 'Ada', email: 'ada@example.com' };
const query = { code: 'one-time', redirect: '/base/bse1?embed=mobile' };

function makeController() {
  const service = {
    consumeWebSessionCode: vi.fn(async () => ({ user, parentSessionId: NATIVE_SID })),
    registerChildSession: vi.fn(async () => undefined),
  };
  const controller = new MobileAuthController(
    service as unknown as MobileAuthService,
    { get: vi.fn() } as unknown as ClsService<IClsStore>
  );
  return { controller, service };
}

/** A request whose `login` behaves like passport ≥ 0.6: the session is regenerated under a new id. */
function makeRequest(session?: Record<string, unknown>, sessionID = NATIVE_SID) {
  const req = {
    session,
    sessionID,
    headers: Object.fromEntries([
      ['x-teable-client', CLIENT],
      ['user-agent', 'Teable/0.1.0 (iOS 26.6)'],
    ]),
    login: vi.fn((next: unknown, done: (err?: unknown) => void) => {
      req.sessionID = CHILD_SID;
      req.session = { passport: { user: next } };
      done();
    }),
  };
  return req;
}

const makeResponse = () => ({ redirect: vi.fn() });
const asReq = (req: unknown) => req as Request;
const asRes = (res: unknown) => res as Response;

describe('MobileAuthController.webSession', () => {
  it('signs a browser context without a session in as a child of the native session', async () => {
    const { controller, service } = makeController();
    const req = makeRequest(undefined, 'sid-anonymous');
    const res = makeResponse();

    await controller.webSession(query, CLIENT, asReq(req), asRes(res));

    expect(req.login).toHaveBeenCalledTimes(1);
    expect(req.session).toHaveProperty('client');
    expect(service.registerChildSession).toHaveBeenCalledWith(NATIVE_SID, CHILD_SID);
    expect(res.redirect).toHaveBeenCalledWith(query.redirect);
  });

  it('leaves a browser context that already shares the native session on it', async () => {
    const { controller, service } = makeController();
    const req = makeRequest({ passport: { user: { id: user.id } } }, NATIVE_SID);
    const res = makeResponse();

    await controller.webSession(query, CLIENT, asReq(req), asRes(res));

    // `req.login` would regenerate — destroy — the native session the app is still using.
    expect(req.login).not.toHaveBeenCalled();
    expect(req.sessionID).toBe(NATIVE_SID);
    expect(service.registerChildSession).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(query.redirect);
  });

  it('re-parents a stale same-user session that is not the native one', async () => {
    const { controller, service } = makeController();
    // e.g. a child session left over from an earlier native sign-in of the same user
    const req = makeRequest({ passport: { user: { id: user.id } } }, 'sid-stale-child');
    const res = makeResponse();

    await controller.webSession(query, CLIENT, asReq(req), asRes(res));

    expect(req.login).toHaveBeenCalledTimes(1);
    expect(service.registerChildSession).toHaveBeenCalledWith(NATIVE_SID, CHILD_SID);
    expect(res.redirect).toHaveBeenCalledWith(query.redirect);
  });

  it('refuses a browser context signed in as somebody else', async () => {
    const { controller, service } = makeController();
    const req = makeRequest({ passport: { user: { id: 'usr2' } } }, 'sid-other');

    await expect(
      controller.webSession(query, CLIENT, asReq(req), asRes(makeResponse()))
    ).rejects.toThrow(ForbiddenException);
    expect(req.login).not.toHaveBeenCalled();
    expect(service.registerChildSession).not.toHaveBeenCalled();
  });

  it('cannot be used as a link: the app client header is required', async () => {
    const { controller, service } = makeController();

    await expect(
      controller.webSession(query, undefined, asReq(makeRequest()), asRes(makeResponse()))
    ).rejects.toThrow(BadRequestException);
    expect(service.consumeWebSessionCode).not.toHaveBeenCalled();
  });

  it('lands on /space when the redirect is not a site-relative path', async () => {
    const { controller } = makeController();
    const res = makeResponse();

    await controller.webSession(
      { code: query.code, redirect: 'https://evil.example.com/' },
      CLIENT,
      asReq(makeRequest()),
      asRes(res)
    );

    expect(res.redirect).toHaveBeenCalledWith('/space');
  });
});

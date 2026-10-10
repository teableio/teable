/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { OAuthServerService } from './oauth-server.service';

const USER_ID = 'usrAda';
const CLIENT_ID = 'clientAbc';

const createFixture = () => {
  const prismaService = {
    oAuthAppAuthorized: { upsert: vi.fn().mockResolvedValue(undefined) },
  };
  const deviceService = { decide: vi.fn().mockResolvedValue({ clientId: CLIENT_ID }) };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? USER_ID : undefined)) };
  const service = new OAuthServerService(
    prismaService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    deviceService as never,
    audit as never,
    cls as never,
    {} as never
  );
  const rows = () => audit.emitAtomic.mock.calls.map(([row]) => row);
  return { service, audit, rows };
};

/** Stands in for oauth2orize's transaction loader + decision middleware pair. */
const stubDecision = (service: OAuthServerService) => {
  const decisionFn = vi.fn((_req: unknown, _res: unknown, next: () => void) => next());
  (service.server as any).decision = vi.fn(() => [
    (req: any, _res: unknown, next: (error?: unknown) => void) => {
      req.oauth2 = { transactionID: 'tx1', req: { clientID: CLIENT_ID } };
      next();
    },
    decisionFn,
  ]);
  return decisionFn;
};

const response = () => new EventEmitter() as unknown as Response;

describe('OAuthServerService consent denial audit', () => {
  it('writes oauth-app.authorize-denied when the consent page is cancelled', async () => {
    const fixture = createFixture();
    const decisionFn = stubDecision(fixture.service);

    await fixture.service.decision({ body: { cancel: 'Deny' } } as Request, response());

    expect(decisionFn).toHaveBeenCalled();
    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.authorize-denied',
        resourceId: CLIENT_ID,
        params: { clientId: CLIENT_ID, flow: 'authorization-code' },
      },
    ]);
  });

  it('writes no denial for an approved consent', async () => {
    const fixture = createFixture();
    stubDecision(fixture.service);

    await fixture.service.decision({ body: { transaction_id: 'tx1' } } as Request, response());

    expect(fixture.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('writes oauth-app.authorize-denied for a denied device code', async () => {
    const fixture = createFixture();

    await fixture.service.decideDevice({
      userCode: 'ABCD-EFGH',
      approve: false,
      user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
    });

    expect(fixture.rows()).toEqual([
      {
        action: 'oauth-app.authorize-denied',
        resourceId: CLIENT_ID,
        userId: USER_ID,
        params: { clientId: CLIENT_ID, flow: 'device' },
      },
    ]);
  });

  it('keeps writing oauth-app.authorize for an approved device code', async () => {
    const fixture = createFixture();

    await fixture.service.decideDevice({
      userCode: 'ABCD-EFGH',
      approve: true,
      user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
    });

    expect(fixture.rows()).toEqual([
      expect.objectContaining({ action: 'oauth-app.authorize', resourceId: CLIENT_ID }),
    ]);
  });
});

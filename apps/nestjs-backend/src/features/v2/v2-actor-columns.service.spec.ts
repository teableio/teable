import { AsyncLocalStorage } from 'node:async_hooks';
import { ForbiddenException } from '@nestjs/common';
import { APP_ROBOT_ID } from '@teable/core';
import { ActorId, ok, v2CoreTokens } from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { publishActorColumnsMetadata } from './v2-actor-columns-registration';
import { assertPlatformOperatorActor, V2ActorColumnsService } from './v2-actor-columns.service';

type AuthContext = Partial<Pick<IClsStore, 'user' | 'appId' | 'tempAuthBaseId' | 'accessTokenId'>>;
const operator: IClsStore['user'] = {
  id: 'usrOperator',
  name: 'Operator',
  email: 'operator@example.test',
};

const fixture = (values: AuthContext) => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const prisma = { tableMeta: { findFirst: vi.fn() } };
  const operations = { list: vi.fn().mockResolvedValue(ok({ items: [], total: 0 })) };
  const container = {
    resolve: vi.fn((token) => {
      if (token === v2CoreTokens.schemaOperationRepository) return operations;
      throw new Error('Unexpected dependency in operator status fixture');
    }),
  };
  const containers = { getContainer: vi.fn().mockResolvedValue(container) };
  const contexts = {
    createContext: vi
      .fn()
      .mockResolvedValue({ actorId: ActorId.create(operator.id)._unsafeUnwrap() }),
  };
  const audit = { withOperation: vi.fn(), emitAtomic: vi.fn() };
  const service = new V2ActorColumnsService(
    prisma as never,
    containers as never,
    contexts as never,
    { getDataDatabaseForBase: vi.fn() } as never,
    { assertTableWritable: vi.fn() } as never,
    cls,
    audit as never,
    { get: vi.fn() } as never,
    { publishOpsMap: vi.fn() } as never
  );
  const run = <T>(work: () => T) =>
    cls.run(() => {
      // Match the authenticated strategy's nested CLS store; dotted keys are only
      // selectors for cls.get/set, never literal properties in runWith's store.
      if (values.user) cls.set('user', values.user);
      if (values.appId) cls.set('appId', values.appId);
      if (values.tempAuthBaseId) cls.set('tempAuthBaseId', values.tempAuthBaseId);
      if (values.accessTokenId) cls.set('accessTokenId', values.accessTokenId);
      return work();
    });
  return { cls, prisma, service, containers, operations, run };
};

describe('V2ActorColumnsService platform operator guard', () => {
  it.each<[string, AuthContext]>([
    ['app internal call', { user: operator, appId: 'app123' }],
    ['app token robot', { user: { ...operator, id: APP_ROBOT_ID }, tempAuthBaseId: 'bse123' }],
    ['temporary app auth', { user: operator, tempAuthBaseId: 'bse123' }],
    ['anonymous', { user: { ...operator, id: 'anonymous' } }],
    ['missing session', {}],
  ])('rejects %s even when generic table|update is granted', (_label, values) => {
    const { cls, run } = fixture(values);
    expect(() => run(() => assertPlatformOperatorActor(cls))).toThrow(ForbiddenException);
  });

  it.each<[string, AuthContext]>([
    ['platform session', { user: operator }],
    ['platform PAT', { user: operator, accessTokenId: 'actToken' }],
  ])('allows %s through the actual service ready path', async (_label, values) => {
    const { service, prisma, operations, run } = fixture(values);
    prisma.tableMeta.findFirst.mockResolvedValue({ actorStorageVersion: 1 });
    await expect(run(() => service.enable('bse123', 'tbl123'))).resolves.toMatchObject({
      tableId: 'tbl123',
      actorStorageVersion: 1,
      state: 'ready',
    });
    expect(prisma.tableMeta.findFirst).toHaveBeenCalledOnce();
    expect(operations.list).toHaveBeenCalledOnce();
  });

  it.each([0, 1])(
    'denies a verified App caller at capability version %i before any work',
    async (version) => {
      const appContexts: AuthContext[] = [
        { user: { ...operator, id: APP_ROBOT_ID }, appId: 'app123', tempAuthBaseId: 'bse123' },
        { user: operator, appId: 'app123' },
      ];
      for (const values of appContexts) {
        const { service, prisma, containers, run } = fixture(values);
        prisma.tableMeta.findFirst.mockResolvedValue({ actorStorageVersion: version });
        await expect(run(() => service.enable('bse123', 'tbl123'))).rejects.toBeInstanceOf(
          ForbiddenException
        );
        expect(prisma.tableMeta.findFirst).not.toHaveBeenCalled();
        expect(containers.getContainer).not.toHaveBeenCalled();
      }
    }
  );
});

describe('native actor columns metadata publication', () => {
  it('publishes the committed capability and optimistic version directly to ShareDB', async () => {
    const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    const shareDb = { publishOpsMap: vi.fn().mockResolvedValue(undefined) };
    await cls.run(async () => {
      cls.set('tx', {});
      await publishActorColumnsMetadata(shareDb as never, cls, {
        baseId: 'bseOwn',
        tableId: 'tblOwn',
        tableVersion: 7,
      });
      expect(cls.get('tx.rawOpMaps')).toBeUndefined();
    });
    expect(shareDb.publishOpsMap).toHaveBeenCalledExactlyOnceWith([
      {
        ['tbl_bseOwn']: {
          tblOwn: {
            src: 'unknown',
            seq: 1,
            m: { ts: expect.any(Number) },
            v: 7,
            op: [
              { p: ['actorStorageVersion'], od: 0, oi: 1 },
              { p: ['version'], od: 7, oi: 8 },
            ],
          },
        },
      },
    ]);
  });

  it('retains failed publication as a retryable error for the operation owner', async () => {
    const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    const failure = new Error('ShareDB unavailable');
    const shareDb = { publishOpsMap: vi.fn().mockRejectedValue(failure) };
    await expect(
      cls.run(() =>
        publishActorColumnsMetadata(shareDb as never, cls, {
          baseId: 'bseOwn',
          tableId: 'tblOwn',
          tableVersion: 7,
        })
      )
    ).rejects.toBe(failure);
  });
});

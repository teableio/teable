import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from './audit-scope';
import { Audit } from './audit.decorator';

const authorityMatrixUpdateAction = 'base.authority-matrix.update';
const userSigninAction = 'user.signin';

const makeAudit = () =>
  ({
    withOperation: vi.fn().mockImplementation((_operation, fn: () => Promise<unknown>) => fn()),
    emitAtomic: vi.fn().mockResolvedValue(undefined),
  }) as unknown as AuditScope;

const makeCls = (store: Partial<Record<string, unknown>> = {}) =>
  ({
    get: (key: string) => store[key],
  }) as unknown as ClsService<IClsStore>;

describe('@Audit', () => {
  it('opens an operation when rootAction is set and does not auto-emit', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({
        rootAction: 'base.import',
        resourceId: (baseId: string) => baseId,
      })
      async run(_baseId: string) {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run('bse1')).resolves.toBe('ok');
    expect(harness.audit.withOperation).toHaveBeenCalledWith(
      expect.objectContaining({ rootAction: 'base.import', resourceId: 'bse1' }),
      expect.any(Function)
    );
    expect(harness.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('opens an operation with generated operationId even when resourceId is omitted', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({ rootAction: 'root.only' })
      async run() {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run()).resolves.toBe('ok');
    expect(harness.audit.withOperation).toHaveBeenCalledWith(
      expect.objectContaining({ rootAction: 'root.only' }),
      expect.any(Function)
    );
    expect(harness.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('emits one atomic row for action + resourceId + emit', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({
        action: userSigninAction,
        resourceId: (userId: string) => userId,
        emit: { via: 'password' },
      })
      async run(_userId: string) {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run('usr1')).resolves.toBe('ok');
    expect(harness.audit.withOperation).not.toHaveBeenCalled();
    expect(harness.audit.emitAtomic).toHaveBeenCalledWith({
      action: userSigninAction,
      resourceId: 'usr1',
      payload: { via: 'password' },
      params: undefined,
    });
  });

  it('passes resolved userId to atomic emits', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({
        action: userSigninAction,
        resourceId: (userId: string) => userId,
        userId: (userId: string) => userId,
        emit: true,
      })
      async run(_userId: string) {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run('usr1')).resolves.toBe('ok');
    expect(harness.audit.emitAtomic).toHaveBeenCalledWith({
      action: userSigninAction,
      resourceId: 'usr1',
      userId: 'usr1',
      payload: undefined,
      params: undefined,
    });
  });

  it('allows an atomic leaf to rely on the caller operation for resourceId', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({
        action: 'table.record.create',
        emit: 3,
      })
      async run() {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run()).resolves.toBe('ok');
    expect(harness.audit.withOperation).not.toHaveBeenCalled();
    expect(harness.audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.record.create',
      resourceId: undefined,
      payload: { recordCount: 3 },
      params: undefined,
    });
  });

  it('opens an operation and emits an explicit atomic row when both are configured', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({
        rootAction: authorityMatrixUpdateAction,
        action: authorityMatrixUpdateAction,
        resourceId: (baseId: string) => baseId,
        params: (_baseId: string, nextRole: string) => ({ nextRole }),
        emit: (result) => ({ oldRole: (result as { oldRole: string }).oldRole }),
      })
      async run(_baseId: string, _nextRole: string) {
        return { oldRole: 'viewer' };
      }
    }

    const harness = new Harness();
    await expect(harness.run('bse1', 'editor')).resolves.toEqual({ oldRole: 'viewer' });
    expect(harness.audit.withOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        rootAction: authorityMatrixUpdateAction,
        resourceId: 'bse1',
        params: { nextRole: 'editor' },
      }),
      expect.any(Function)
    );
    expect(harness.audit.emitAtomic).toHaveBeenCalledWith({
      action: authorityMatrixUpdateAction,
      resourceId: 'bse1',
      payload: { oldRole: 'viewer' },
      params: { nextRole: 'editor' },
    });
  });

  it('ignores action-only configs', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit({ action: 'action.only' })
      async actionOnly() {
        return 'action';
      }
    }

    const harness = new Harness();
    await expect(harness.actionOnly()).resolves.toBe('action');
    expect(harness.audit.withOperation).not.toHaveBeenCalled();
    expect(harness.audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('passes ctx with cls as last positional arg to user callbacks', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls({ 'user.id': 'usr-from-cls' });

      @Audit({
        action: userSigninAction,
        resourceId: (input: { userId?: string }, ctx) =>
          input.userId ?? (ctx.cls.get('user.id') as string),
        emit: true,
      })
      async run(_input: { userId?: string }) {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.run({})).resolves.toBe('ok');
    expect(harness.audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'usr-from-cls' })
    );
  });

  it('lets a resolver short-circuit via ctx.cls', async () => {
    class Harness {
      audit = makeAudit();
      cls = makeCls();

      @Audit((_req: { id: string }, ctx) => {
        const userId = ctx.cls.get('user.id') as string | undefined;
        return userId
          ? { action: 'user.signout', resourceId: userId, userId, emit: true }
          : undefined;
      })
      async signout(_req: { id: string }) {
        return 'ok';
      }
    }

    const harness = new Harness();
    await expect(harness.signout({ id: 'r1' })).resolves.toBe('ok');
    expect(harness.audit.emitAtomic).not.toHaveBeenCalled();
  });
});

import type { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateRecordAction } from '@teable/openapi';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { Events } from '../../event-emitter/events';
import { AuditScope, type IAuditAction } from './audit-scope';

const runInCls = async <T>(fn: () => Promise<T>): Promise<T> => {
  const cls = ClsServiceManager.getClsService();
  return cls.runWith({}, fn);
};

const makeService = (emitter?: Partial<EventEmitter2>) =>
  new AuditScope(
    ClsServiceManager.getClsService(),
    (emitter ?? { emitAsync: vi.fn().mockResolvedValue([]) }) as unknown as EventEmitter2
  );

describe('AuditScope', () => {
  it('current() returns undefined when no operation is active', async () => {
    const service = makeService();
    await runInCls(async () => {
      expect(service.current()).toBeUndefined();
    });
  });

  it('withOperation sets the operation for the duration of fn and clears it after', async () => {
    const service = makeService();
    await runInCls(async () => {
      const inside = await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => service.current()
      );
      expect(inside?.rootAction).toBe(CreateRecordAction.Import);
      expect(inside?.resourceId).toBe('tbl1');
      expect(service.current()).toBeUndefined();
    });
  });

  it('withOperation can open an operation without resourceId and still generates operationId', async () => {
    const service = makeService();
    await runInCls(async () => {
      const inside = await service.withOperation(
        { rootAction: CreateRecordAction.Import },
        async () => service.current()
      );

      expect(inside?.rootAction).toBe(CreateRecordAction.Import);
      expect(inside?.operationId).toEqual(expect.any(String));
      expect(inside?.resourceId).toBeUndefined();
      expect(service.current()).toBeUndefined();
    });
  });

  it('outer-wins: nested operations do not override the outer rootAction', async () => {
    const service = makeService();
    await runInCls(async () => {
      const captured: Array<IAuditAction | undefined> = [];
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tblOuter' },
        async () => {
          captured.push(service.current()?.rootAction);
          await service.withOperation(
            { rootAction: CreateRecordAction.FormSubmit, resourceId: 'tblInner' },
            async () => {
              captured.push(service.current()?.rootAction);
            }
          );
          captured.push(service.current()?.rootAction);
        }
      );
      expect(captured).toEqual([
        CreateRecordAction.Import,
        CreateRecordAction.Import,
        CreateRecordAction.Import,
      ]);
    });
  });

  it('emitAtomic() fires AUDIT_LOG_EMIT with atomic action and operation rootAction', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => {
          await service.emitAtomic({
            action: Events.TABLE_RECORD_CREATE,
            payload: { recordCount: 42 },
          });
        }
      );
    });
    expect(emitAsync).toHaveBeenCalledWith(
      Events.AUDIT_LOG_EMIT,
      expect.objectContaining({
        action: Events.TABLE_RECORD_CREATE,
        resourceId: 'tbl1',
        rootAction: CreateRecordAction.Import,
        recordCount: 42,
      })
    );
  });

  it('emitAtomic() ignores reserved keys from payload extras', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1', operationId: 'op_real' },
        async () => {
          await service.emitAtomic({
            action: Events.TABLE_RECORD_CREATE,
            payload: {
              recordCount: 3,
              action: 'payload.action',
              resourceId: 'payload.resource',
              rootAction: 'payload.root',
              operationId: 'payload.op',
              userId: 'payload.user',
              params: { bad: true },
            },
          });
        }
      );
    });
    expect(emitAsync).toHaveBeenCalledWith(
      Events.AUDIT_LOG_EMIT,
      expect.objectContaining({
        action: Events.TABLE_RECORD_CREATE,
        resourceId: 'tbl1',
        rootAction: CreateRecordAction.Import,
        operationId: 'op_real',
        recordCount: 3,
      })
    );
  });

  it('emitAtomic() uses explicit userId before operation userId', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        {
          rootAction: CreateRecordAction.Import,
          resourceId: 'tbl1',
          operationId: 'op_real',
          userId: 'operation-user',
        },
        async () => {
          await service.emitAtomic({
            action: Events.TABLE_RECORD_CREATE,
            userId: 'atomic-user',
            payload: { userId: 'payload-user' },
          });
        }
      );
    });
    expect(emitAsync).toHaveBeenCalledWith(
      Events.AUDIT_LOG_EMIT,
      expect.objectContaining({
        action: Events.TABLE_RECORD_CREATE,
        resourceId: 'tbl1',
        userId: 'atomic-user',
        operationId: 'op_real',
      })
    );
  });

  it('emitAtomic() merges params on top of operation params for this emit', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        {
          rootAction: CreateRecordAction.Import,
          resourceId: 'tbl1',
          params: { resourceType: 'space', newRole: 'editor' },
        },
        async () => {
          await service.emitAtomic({
            action: Events.TABLE_RECORD_CREATE,
            params: { oldRole: 'viewer', newRole: 'owner' },
          });
        }
      );
    });
    expect(emitAsync).toHaveBeenCalledWith(
      Events.AUDIT_LOG_EMIT,
      expect.objectContaining({
        params: { resourceType: 'space', newRole: 'owner', oldRole: 'viewer' },
      })
    );
  });

  it('emitAtomic() under a nested operation still uses the outer rootAction', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => {
          await service.withOperation(
            { rootAction: CreateRecordAction.FormSubmit, resourceId: 'tbl1' },
            async () => {
              await service.emitAtomic({
                action: Events.TABLE_RECORD_CREATE,
                payload: { recordCount: 3 },
              });
            }
          );
        }
      );
    });
    expect(emitAsync).toHaveBeenCalledWith(
      Events.AUDIT_LOG_EMIT,
      expect.objectContaining({
        action: Events.TABLE_RECORD_CREATE,
        rootAction: CreateRecordAction.Import,
        recordCount: 3,
      })
    );
  });

  it('emitAtomic() omits rootAction when atomic action equals operation rootAction', async () => {
    const emitAsync = vi.fn().mockResolvedValue([]);
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => {
          await service.emitAtomic({ action: CreateRecordAction.Import });
        }
      );
    });
    const call = emitAsync.mock.calls[0][1] as Record<string, unknown>;
    expect(call.action).toBe(CreateRecordAction.Import);
    expect(call.rootAction).toBeUndefined();
  });

  it('emitAtomic() is a no-op when no operation or resourceId is active', async () => {
    const emitAsync = vi.fn();
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.emitAtomic({
        action: Events.TABLE_RECORD_CREATE,
        payload: { recordCount: 10 },
      });
    });
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('emitAtomic() swallows downstream listener errors so the caller is never broken', async () => {
    const emitAsync = vi.fn().mockRejectedValue(new Error('audit_log table missing'));
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => {
          await expect(
            service.emitAtomic({
              action: Events.TABLE_RECORD_CREATE,
              payload: { recordCount: 1 },
            })
          ).resolves.toBeUndefined();
        }
      );
    });
    expect(emitAsync).toHaveBeenCalled();
  });

  it('emitAtomic() returns immediately without awaiting the downstream listener', async () => {
    const emitAsync = vi.fn().mockReturnValue(
      new Promise<never>(() => {
        // Intentionally unresolved.
      })
    );
    const service = makeService({ emitAsync } as Partial<EventEmitter2>);
    await runInCls(async () => {
      await service.withOperation(
        { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
        async () => {
          await expect(
            service.emitAtomic({
              action: Events.TABLE_RECORD_CREATE,
              payload: { recordCount: 1 },
            })
          ).resolves.toBeUndefined();
        }
      );
    });
    expect(emitAsync).toHaveBeenCalled();
  });

  it('clears the operation on exception', async () => {
    const service = makeService();
    await runInCls(async () => {
      await expect(
        service.withOperation(
          { rootAction: CreateRecordAction.Import, resourceId: 'tbl1' },
          async () => {
            throw new Error('boom');
          }
        )
      ).rejects.toThrow('boom');
      expect(service.current()).toBeUndefined();
    });
  });
});

import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TrashType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { Events } from '../../../event-emitter/events';
import type { ITrashRecordedHandler } from '../resource/trash-resource-handler';
import { TrashListener } from './trash.listener';

describe('TrashListener', () => {
  const deleted = { payload: { dashboardId: 'dshA' }, context: { user: { id: 'usrA' } } };

  const listen = (findTrashed: ITrashRecordedHandler['findTrashed']) => {
    const eventEmitter = new EventEmitter2();
    const upsert = vi.fn();
    const handler = { type: TrashType.Dashboard, findTrashed } as ITrashRecordedHandler;
    new TrashListener({ trash: { upsert } } as never, eventEmitter, [
      handler,
    ]).onApplicationBootstrap();
    return { eventEmitter, upsert };
  };

  it("records the entry under the resource's parent on its delete event", async () => {
    const deletedTime = new Date('2026-11-17T00:00:00Z');
    const { eventEmitter, upsert } = listen(async () => ({ deletedTime, parentId: 'bseA' }));

    await eventEmitter.emitAsync(Events.DASHBOARD_DELETE, deleted);

    // An async listener runs on a later tick
    await vi.waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          resourceType: TrashType.Dashboard,
          resourceId: 'dshA',
          parentId: 'bseA',
          deletedTime,
          deletedBy: 'usrA',
        }),
      })
    );
  });

  // As @OnEvent does: a failure is logged, never left as an unhandled rejection.
  it('logs a failure instead of leaving it unhandled', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { eventEmitter, upsert } = listen(async () => {
      throw new Error('lookup failed');
    });

    await eventEmitter.emitAsync(Events.DASHBOARD_DELETE, deleted);

    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('lookup failed', expect.any(String))
    );
    expect(upsert).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

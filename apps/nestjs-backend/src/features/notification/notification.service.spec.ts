import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
  SYSTEM_USER_ID,
} from '@teable/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const createService = () => {
    const notification = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'notabcdefghijklmnop',
          fromUserId: SYSTEM_USER_ID,
          type: NotificationTypeEnum.System,
          urlPath: '/base/bseTest/table/tblTest',
          message: 'Warning notification',
          messageI18n: null,
          severity: NotificationSeverityEnum.Warning,
          isRead: false,
          createdTime: new Date('2026-05-11T00:00:00.000Z'),
        },
      ]),
      groupBy: vi.fn().mockResolvedValue([
        { severity: NotificationSeverityEnum.Critical, _count: { _all: 3 } },
        { severity: NotificationSeverityEnum.Warning, _count: { _all: 2 } },
        { severity: NotificationSeverityEnum.Info, _count: { _all: 1 } },
      ]),
    };
    const prismaService = {
      notification,
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    return {
      notification,
      service: new NotificationService(
        prismaService as never,
        {} as never,
        {} as never,
        {} as never,
        { origin: 'https://example.test' } as never,
        {} as never,
        {} as never,
        {} as never
      ),
    };
  };

  it('filters notification records by severity and returns per-severity summary', async () => {
    const { notification, service } = createService();

    const result = await service.getNotifyList('usrTest', {
      notifyStates: NotificationStatesEnum.Unread,
      severity: NotificationSeverityEnum.Warning,
    });

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          toUserId: 'usrTest',
          isRead: false,
          severity: NotificationSeverityEnum.Warning,
        },
      })
    );
    expect(result.summary).toEqual({
      [NotificationSeverityEnum.Critical]: 3,
      [NotificationSeverityEnum.Warning]: 2,
      [NotificationSeverityEnum.Info]: 1,
    });
  });

  it('omits severity from where when no filter is specified', async () => {
    const { notification, service } = createService();

    await service.getNotifyList('usrTest', {
      notifyStates: NotificationStatesEnum.Unread,
    });

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          toUserId: 'usrTest',
          isRead: false,
        },
      })
    );
  });
});

describe('NotificationService collaborator notify coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS = '1000';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS;
  });

  const createCache = () => {
    const store = new Map<string, { value: unknown; expiresAt: number }>();
    const read = (key: string) => {
      const entry = store.get(key);
      return entry && Date.now() < entry.expiresAt ? entry.value : undefined;
    };
    const write = (key: string, value: unknown, ttlSeconds: number) => {
      store.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlSeconds * 1000 });
    };
    return {
      get: vi.fn(async (key: string) => structuredClone(read(key))),
      setDetail: vi.fn(async (key: string, value: unknown, ttlSeconds: number) =>
        write(key, value, ttlSeconds)
      ),
      setnx: vi.fn(async (key: string, value: unknown, ttlSeconds: number) => {
        if (read(key) !== undefined) {
          return false;
        }
        write(key, value, ttlSeconds);
        return true;
      }),
      del: vi.fn(async (key: string) => store.delete(key)),
    };
  };

  const createService = (cache = createCache()) => {
    const service = new NotificationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cache as never,
      {
        runExclusive: async (_name: string, _ttl: number, task: () => Promise<void>) => {
          await task();
          return true;
        },
      } as never
    );
    const create = vi
      .spyOn(
        service as never as { createCollaboratorNotify: () => Promise<boolean> },
        'createCollaboratorNotify'
      )
      .mockResolvedValue(true);
    return { service, create };
  };

  const notify = (
    service: NotificationService,
    recordIds: string[],
    options: { toUserId?: string; fromUserId?: string } = {}
  ) =>
    service.sendCollaboratorNotify({
      fromUserId: options.fromUserId ?? 'usrActor000000001',
      toUserId: options.toUserId ?? 'usrTarget00000001',
      refRecord: {
        baseId: 'bseNotify000000001',
        tableId: 'tblNotify00000001',
        tableName: 'Tasks',
        fieldName: 'Assignee',
        recordIds,
        recordTitles: recordIds.map((id) => ({ id, title: id })),
      },
    });

  const lastRecordIds = (create: ReturnType<typeof createService>['create']) =>
    (create.mock.lastCall as unknown as [{ refRecord: { recordIds: string[] } }])[0].refRecord
      .recordIds;

  it('sends the first notify at once and merges later ones after writes go quiet', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1']);
    expect(create).toHaveBeenCalledTimes(1);

    await notify(service, ['rec2', 'rec3']);
    await notify(service, ['rec3', 'rec4']);
    expect(create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lastRecordIds(create)).toEqual(['rec2', 'rec3', 'rec4']);
  });

  it('keeps at most 10 record titles in a merged notify', async () => {
    const { service, create } = createService();

    await notify(service, ['rec0']);
    await notify(
      service,
      Array.from({ length: 8 }, (_, i) => `recA${i}`)
    );
    await notify(
      service,
      Array.from({ length: 8 }, (_, i) => `recB${i}`)
    );
    await vi.advanceTimersByTimeAsync(1000);

    const merged = (
      create.mock.lastCall as unknown as [
        { refRecord: { recordIds: string[]; recordTitles: unknown[] } },
      ]
    )[0].refRecord;
    expect(merged.recordIds).toHaveLength(16);
    expect(merged.recordTitles).toHaveLength(10);
  });

  it('keeps buffering while writes continue within the quiet window', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1']);
    for (const id of ['rec2', 'rec3', 'rec4']) {
      await vi.advanceTimersByTimeAsync(800);
      await notify(service, [id]);
    }
    expect(create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lastRecordIds(create)).toEqual(['rec2', 'rec3', 'rec4']);
  });

  it('holds continuous writes until they stop, however long they run', async () => {
    const { service, create } = createService();

    await notify(service, ['rec0']);
    for (let i = 1; i <= 620; i++) {
      await vi.advanceTimersByTimeAsync(500);
      await notify(service, [`rec${i}`]);
    }
    expect(create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lastRecordIds(create)).toHaveLength(620);
  });

  it('shares one window across pods', async () => {
    const cache = createCache();
    const podA = createService(cache);
    const podB = createService(cache);

    await notify(podA.service, ['rec1']);
    await notify(podB.service, ['rec2']);
    await notify(podA.service, ['rec3']);

    await vi.advanceTimersByTimeAsync(1000);
    const calls = [...podA.create.mock.calls, ...podB.create.mock.calls] as unknown as [
      { refRecord: { recordIds: string[] } },
    ][];
    expect(calls.map(([arg]) => arg.refRecord.recordIds)).toEqual([['rec1'], ['rec2', 'rec3']]);
  });

  it('keeps buffering onto records left by pods that died', async () => {
    const cache = createCache();
    const podA = createService(cache);
    const podB = createService(cache);
    const podC = createService(cache);

    await notify(podA.service, ['rec1']);
    await notify(podB.service, ['rec2']);
    // Pods A and B die with their timers; the buffer stays in the cache.
    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(3000);

    await notify(podC.service, ['rec3']);
    expect(podC.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(podC.create).toHaveBeenCalledTimes(1);
    expect(lastRecordIds(podC.create)).toEqual(['rec2', 'rec3']);
  });

  it('keeps separate windows per recipient', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1'], { toUserId: 'usrTarget00000001' });
    await notify(service, ['rec2'], { toUserId: 'usrTarget00000002' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('skips self-assignment without opening a window', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1'], { toUserId: 'usrActor000000001' });
    expect(create).not.toHaveBeenCalled();
  });

  it('buffers behind a first notify that created nothing', async () => {
    const { service, create } = createService();
    create.mockResolvedValueOnce(false);

    await notify(service, ['rec1']);
    await notify(service, ['rec2']);
    expect(create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lastRecordIds(create)).toEqual(['rec2']);
  });

  it('buffers notifies arriving while the first one is still sending', async () => {
    const cache = createCache();
    const podA = createService(cache);
    const podB = createService(cache);
    let finishFirst!: (created: boolean) => void;
    podA.create.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finishFirst = resolve))
    );

    const first = notify(podA.service, ['rec1']);
    await vi.waitFor(() => expect(podA.create).toHaveBeenCalledTimes(1));
    await notify(podB.service, ['rec2']);
    expect(podB.create).not.toHaveBeenCalled();
    finishFirst(true);
    await first;

    await vi.advanceTimersByTimeAsync(1000);
    const calls = [...podA.create.mock.calls, ...podB.create.mock.calls] as unknown as [
      { refRecord: { recordIds: string[] } },
    ][];
    expect(calls.map(([arg]) => arg.refRecord.recordIds)).toEqual([['rec1'], ['rec2']]);
  });

  it('closes the window after a quiet flush so the next notify is instant again', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1']);
    await notify(service, ['rec2']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(create).toHaveBeenCalledTimes(2);
    // The post-flush check that closes the window runs on the next timer tick.
    await vi.advanceTimersByTimeAsync(1);

    await notify(service, ['rec3']);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('closes a window nobody wrote into', async () => {
    const { service, create } = createService();

    await notify(service, ['rec1']);
    await vi.advanceTimersByTimeAsync(1000);

    await notify(service, ['rec2']);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('keeps the buffer alive through a quiet window longer than a minute', async () => {
    process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS = '120000';
    const { service, create } = createService();

    await notify(service, ['rec1']);
    await notify(service, ['rec2']);
    await vi.advanceTimersByTimeAsync(120000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(lastRecordIds(create)).toEqual(['rec2']);
  });

  it('sends every notify at once when coalescing is disabled', async () => {
    process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS = '0';
    const { service, create } = createService();

    await notify(service, ['rec1']);
    await notify(service, ['rec2']);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

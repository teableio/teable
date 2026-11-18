import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
  SYSTEM_USER_ID,
} from '@teable/core';
import ms from 'ms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalesceBackend } from '../coalesce/coalesce.spec-mocks';
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
      count: vi.fn().mockResolvedValue(0),
    };
    const prismaService = {
      notification,
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    return {
      notification,
      prismaService,
      service: new NotificationService(
        prismaService as never,
        {} as never,
        {} as never,
        {} as never,
        { origin: 'https://example.test' } as never,
        {} as never,
        { onFlush: vi.fn() } as never
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

  it('answers the badge count and both catch-up lists in one summary', async () => {
    const { notification, prismaService, service } = createService();
    const invite = {
      id: 'notInvite',
      fromUserId: 'usrFrom',
      type: NotificationTypeEnum.CollaboratorInvite,
      urlPath: '',
      message: 'Invite',
      messageI18n: null,
      severity: NotificationSeverityEnum.Info,
      isRead: false,
      createdTime: new Date('2026-05-11T00:00:00.000Z'),
    };
    const critical = {
      ...invite,
      id: 'notCritical',
      fromUserId: SYSTEM_USER_ID,
      type: NotificationTypeEnum.AdminNotice,
      severity: NotificationSeverityEnum.Critical,
    };
    notification.findMany.mockImplementation(async ({ where }) =>
      where.type === NotificationTypeEnum.AdminNotice ? [critical] : [invite]
    );
    notification.count.mockResolvedValue(4);
    prismaService.user.findMany.mockResolvedValue([{ id: 'usrFrom', name: 'From', avatar: null }]);

    const result = await service.getNotifySummary('usrTest');

    expect(result.unreadCount).toBe(4);
    expect(result.criticalAdminNotices.map((n) => n.id)).toEqual(['notCritical']);
    expect(result.unreadInvites.map((n) => n.id)).toEqual(['notInvite']);
    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          toUserId: 'usrTest',
          isRead: false,
          severity: NotificationSeverityEnum.Critical,
          type: NotificationTypeEnum.AdminNotice,
        },
      })
    );
    expect(notification.groupBy).not.toHaveBeenCalled();
  });
});

describe('NotificationService delivery', () => {
  const createService = (deps: {
    prisma: unknown;
    mailSender?: unknown;
    user?: unknown;
    i18n?: unknown;
  }) =>
    new NotificationService(
      deps.prisma as never,
      {} as never,
      (deps.mailSender ?? {}) as never,
      (deps.user ?? {}) as never,
      { origin: 'https://app.example.com' } as never,
      (deps.i18n ?? {}) as never,
      { onFlush: vi.fn() } as never
    );

  it('pushes an unread count that counts notifications landing at the same time', async () => {
    const rows: { toUserId: string }[] = [];
    const prisma = {
      notification: {
        createMany: vi.fn(async ({ data }: { data: { toUserId: string }[] }) => {
          rows.push(...data);
          return { count: data.length };
        }),
        groupBy: vi.fn(async () => [
          { toUserId: 'usrTarget00000001', _count: { _all: rows.length } },
        ]),
      },
    };
    const service = createService({ prisma });
    const pushed: number[] = [];
    vi.spyOn(
      service as never as {
        sendNotifyBySocket: (to: string, data: { unreadCount: number }) => void;
      },
      'sendNotifyBySocket'
    ).mockImplementation((_to, data) => void pushed.push(data.unreadCount));
    const deliver = (id: string) =>
      (
        service as never as {
          deliverNotifies: (records: unknown[], icon: unknown) => Promise<number>;
        }
      ).deliverNotifies(
        [{ id, toUserId: 'usrTarget00000001', createdTime: new Date(), message: id }],
        {}
      );

    await Promise.all([deliver('ntf1'), deliver('ntf2')]);

    expect(Math.max(...pushed)).toBe(2);
  });

  it('does not fail a written collaborator notify, so a retried flush cannot write it again', async () => {
    const prisma = {
      notification: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
        groupBy: vi.fn().mockRejectedValue(new Error('statement timeout')),
      },
    };
    const users: Record<string, unknown> = {
      usrActor000000001: { id: 'usrActor000000001', name: 'Actor' },
      usrTarget00000001: {
        id: 'usrTarget00000001',
        name: 'Target',
        email: 'target@example.com',
        notifyMeta: { email: true },
      },
    };
    const service = createService({
      prisma,
      mailSender: {
        collaboratorCellTagEmailOptions: vi.fn().mockRejectedValue(new Error('template')),
      },
      user: { getUserById: vi.fn(async (id: string) => users[id]) },
      i18n: { t: vi.fn((key: string) => key) },
    });
    const create = (
      service as never as { createCollaboratorNotify: (params: unknown) => Promise<boolean> }
    ).createCollaboratorNotify.bind(service);

    await expect(
      create({
        fromUserId: 'usrActor000000001',
        toUserId: 'usrTarget00000001',
        refRecord: {
          baseId: 'bseNotify000000001',
          tableId: 'tblNotify00000001',
          tableName: 'Tasks',
          fieldName: 'Assignee',
          recordIds: ['rec1'],
          recordTitles: [{ id: 'rec1', title: 'rec1' }],
        },
      })
    ).resolves.toBe(true);
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
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

  // One NotificationService per pod, all on the same coalescing backend.
  const createService = (backend = createCoalesceBackend()) => {
    const service = new NotificationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      backend.createService()
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
    const backend = createCoalesceBackend();
    const podA = createService(backend);
    const podB = createService(backend);

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
    const backend = createCoalesceBackend();
    const podA = createService(backend);
    const podB = createService(backend);
    const podC = createService(backend);

    await notify(podA.service, ['rec1']);
    await notify(podB.service, ['rec2']);
    // The flushes pods A and B booked are lost; the buffer stays in the cache. Past the
    // window and its flush's retries, the next notify books the flush again.
    vi.clearAllTimers();
    await vi.advanceTimersByTimeAsync(ms('11m'));

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
    const backend = createCoalesceBackend();
    const podA = createService(backend);
    const podB = createService(backend);
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

import {
  NotificationSeverityEnum,
  NotificationStatesEnum,
  NotificationTypeEnum,
  SYSTEM_USER_ID,
} from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
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

import { NotificationSeverityEnum } from '@teable/core';
import knex from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { AdminOpenApiService } from './admin-open-api.service';

const createService = () => {
  const notificationService = {
    sendCommonNotify: vi.fn().mockResolvedValue({ sentCount: 2, invalidEmails: [] }),
  };
  const performanceCacheService = { del: vi.fn() };
  const cls = { get: vi.fn().mockReturnValue('usr_admin') };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    $queryRawUnsafe: vi
      .fn()
      .mockResolvedValueOnce([
        { token: 'tok1', height: 10, mimetype: 'image/png', path: 'p1' },
        { token: 'tok2', height: 10, mimetype: 'image/png', path: 'p2' },
      ])
      .mockResolvedValue([]),
  };
  const cropQueue = { queue: { addBulk: vi.fn() } };
  const service = new AdminOpenApiService(
    prisma as never,
    knex({ client: 'pg' }),
    cropQueue as never,
    performanceCacheService as never,
    notificationService as never,
    cls as never,
    audit as never
  );
  return { service, audit, performanceCacheService, cropQueue };
};

describe('AdminOpenApiService audit', () => {
  it('records an admin notice with its recipients and delivery count', async () => {
    const { service, audit } = createService();

    const result = await service.sendAdminNotification({
      message: 'Maintenance tonight',
      severity: NotificationSeverityEnum.Warning,
      userIds: ['usr1'],
      emails: ['a@example.com'],
    });

    expect(result).toEqual({ sentCount: 2, invalidEmails: [] });
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.notification.send',
      resourceId: 'instance',
      params: {
        severity: NotificationSeverityEnum.Warning,
        message: 'Maintenance tonight',
        userIds: ['usr1'],
        emails: ['a@example.com'],
        sentCount: 2,
      },
    });
  });

  it('records a performance cache purge with its key, and nothing for a rejected request', async () => {
    const { service, audit, performanceCacheService } = createService();

    await expect(service.deletePerformanceCache()).rejects.toThrow('key is required');
    expect(audit.emitAtomic).not.toHaveBeenCalled();

    await service.deletePerformanceCache('space:spc1');
    expect(performanceCacheService.del).toHaveBeenCalledWith('space:spc1');
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.performance-cache.delete',
      resourceId: 'instance',
      params: { key: 'space:spc1' },
    });
  });

  it('records a thumbnail repair with the number of attachments it queued', async () => {
    const { service, audit, cropQueue } = createService();

    await service.repairTableAttachmentThumbnail();

    expect(cropQueue.queue.addBulk).toHaveBeenCalledTimes(1);
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'admin.attachment.repair-thumbnail',
      resourceId: 'instance',
      params: { queuedCount: 2 },
    });
  });
});

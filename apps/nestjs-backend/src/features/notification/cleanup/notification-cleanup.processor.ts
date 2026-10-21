import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import ms from 'ms';
import type { NestWorkerOptions } from '../../../utils/nest-worker-options';
import { readNonNegativeIntEnv } from '../../cold-archive/env';

export const NOTIFICATION_CLEANUP_QUEUE = 'notification-cleanup-queue';

const CLEANUP_JOB_ID = 'notification:cleanup';
const CLEANUP_INTERVAL_MS = ms('1d');
const BATCH_SIZE = 1000;
// bounds one run; whatever is left goes in the next day's run
const MAX_BATCHES_PER_RUN = 500;

const queueOptions: NestWorkerOptions = {
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 20 },
};

/** notifications older than this many days are deleted daily; 0 (default) keeps them forever */
export const notificationRetentionDays = (): number =>
  readNonNegativeIntEnv('BACKEND_NOTIFICATION_RETENTION_DAYS', 0);

export interface INotificationCleanupResult {
  deleted: number;
  cutoff?: string;
}

@Injectable()
@Processor(NOTIFICATION_CLEANUP_QUEUE, queueOptions)
export class NotificationCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationCleanupProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    @InjectQueue(NOTIFICATION_CLEANUP_QUEUE) public readonly queue: Queue
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (notificationRetentionDays() <= 0) {
      this.logger.log('Notification retention is not set, skipping cleanup job registration');
      return;
    }
    // the redis-less fallback queue has no job schedulers
    if (typeof this.queue.upsertJobScheduler !== 'function') return;
    try {
      await this.queue.upsertJobScheduler(
        CLEANUP_JOB_ID,
        { every: CLEANUP_INTERVAL_MS },
        { name: CLEANUP_JOB_ID }
      );
      this.logger.log(`Notification cleanup job registered (interval: ${ms(CLEANUP_INTERVAL_MS)})`);
    } catch (error) {
      this.logger.error('Failed to register notification cleanup job', error);
    }
  }

  async process(_job: Job): Promise<INotificationCleanupResult> {
    return this.cleanupExpired();
  }

  async cleanupExpired(now = new Date()): Promise<INotificationCleanupResult> {
    // re-read at execution: a scheduler left over from an earlier config must not delete
    const retentionDays = notificationRetentionDays();
    if (retentionDays <= 0) return { deleted: 0 };
    const cutoff = new Date(now.getTime() - retentionDays * ms('1d'));
    let deleted = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const rows = await this.prismaService.notification.findMany({
        where: { createdTime: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdTime: 'asc' },
        take: BATCH_SIZE,
      });
      if (rows.length === 0) break;
      const { count } = await this.prismaService.notification.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      deleted += count;
      if (rows.length < BATCH_SIZE) break;
    }
    this.logger.log(
      `Notification cleanup: deleted=${deleted} cutoff=${cutoff.toISOString()} retentionDays=${retentionDays}`
    );
    return { deleted, cutoff: cutoff.toISOString() };
  }
}

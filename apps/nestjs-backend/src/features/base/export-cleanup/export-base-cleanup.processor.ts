import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import ms from 'ms';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import type { NestWorkerOptions } from '../../../utils/nest-worker-options';
import { second } from '../../../utils/second';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { parseExportLinkExpiresIn } from './export-base-path';

export const EXPORT_BASE_CLEANUP_QUEUE = 'export-base-cleanup-queue';

const CLEANUP_JOB_ID = 'export-base:cleanup';
const CLEANUP_INTERVAL_MS = ms('1h');
// kept past the link expiry: S3 dates a multipart object by when its upload started, and a
// large export can run for hours before its link is signed
const EXPIRY_MARGIN_MS = ms('1d');
// keys from before the lifetime was recorded: no S3-family presigned link outlives 7 days,
// and the current setting covers a longer local one unless it has since been shortened
const LEGACY_MIN_LINK_EXPIRES_IN_MS = ms('7d');

const queueOptions: NestWorkerOptions = {
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 20 },
};

export interface IExportBaseCleanupResult {
  deleted: number;
  failed: number;
}

/**
 * Exported files under `export-base/` (.tea, archive csv) are only reachable through a
 * signed link that expires after `tokenExpireIn`; past that they are dead weight, so they
 * are swept on a schedule.
 */
@Injectable()
@Processor(EXPORT_BASE_CLEANUP_QUEUE, queueOptions)
export class ExportBaseCleanupProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(ExportBaseCleanupProcessor.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @StorageConfig() private readonly storageConfig: IStorageConfig,
    @InjectQueue(EXPORT_BASE_CLEANUP_QUEUE) public readonly queue: Queue
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // the redis-less fallback queue has no job schedulers; such a deployment is a single
    // process, so it sweeps on its own timer
    if (typeof this.queue.upsertJobScheduler !== 'function') {
      this.timer = setInterval(() => {
        this.cleanupExpired().catch((error) =>
          this.logger.error('Export base cleanup failed', error)
        );
      }, CLEANUP_INTERVAL_MS);
      this.timer.unref();
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        CLEANUP_JOB_ID,
        { every: CLEANUP_INTERVAL_MS },
        { name: CLEANUP_JOB_ID }
      );
      this.logger.log(`Export base cleanup job registered (interval: ${ms(CLEANUP_INTERVAL_MS)})`);
    } catch (error) {
      this.logger.error('Failed to register export base cleanup job', error);
    }
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async process(_job: Job): Promise<IExportBaseCleanupResult> {
    return this.cleanupExpired();
  }

  async cleanupExpired(now = new Date()): Promise<IExportBaseCleanupResult> {
    const legacyLinkExpiresInMs = Math.max(
      second(this.storageConfig.tokenExpireIn) * 1000,
      LEGACY_MIN_LINK_EXPIRES_IN_MS
    );
    const bucket = StorageAdapter.getBucket(UploadType.ExportBase);
    const { objects } = await this.storageAdapter.listObjects(
      bucket,
      `${StorageAdapter.getDir(UploadType.ExportBase)}/`
    );
    let deleted = 0;
    let failed = 0;
    for (const { key, lastModified } of objects) {
      // no date, no proof the link is gone
      if (!lastModified) continue;
      const recorded = parseExportLinkExpiresIn(key);
      const linkExpiresInMs = recorded === undefined ? legacyLinkExpiresInMs : recorded * 1000;
      if (now.getTime() <= lastModified.getTime() + linkExpiresInMs + EXPIRY_MARGIN_MS) continue;
      try {
        await this.storageAdapter.deleteFile(bucket, key);
        deleted++;
      } catch (error) {
        failed++;
        this.logger.warn(`Failed to delete expired export ${key}: ${(error as Error).message}`);
      }
    }
    if (deleted || failed) {
      this.logger.log(`Export base cleanup: deleted=${deleted} failed=${failed}`);
    }
    return { deleted, failed };
  }
}

/* eslint-disable @typescript-eslint/naming-convention */
import { join } from 'path';
import { PassThrough, type Readable } from 'stream';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import Papa from 'papaparse';
import { CacheService } from '../../../cache/cache.service';
import { BaseConfig, type IBaseConfig } from '../../../configs/base.config';
import type { I18nPath } from '../../../types/i18n.generated';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { getImportResultManifestKey, type IImportResultManifest } from './import-result-manifest';

export const TABLE_IMPORT_RESULT_QUEUE = 'import-table-result-queue';

interface IImportResultJobData {
  jobId: string;
  baseId: string;
  table: { id: string; name: string };
  userId: string;
  sourceColumnMap?: Record<string, number | null>;
  notification: boolean;
}

@Injectable()
@Processor(TABLE_IMPORT_RESULT_QUEUE, {
  concurrency: 8,
})
export class ImportTableResultQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportTableResultQueueProcessor.name);

  constructor(
    @InjectQueue(TABLE_IMPORT_RESULT_QUEUE) public readonly queue: Queue<IImportResultJobData>,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    private readonly notificationService: NotificationService,
    private readonly cacheService: CacheService,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {
    super();
  }

  public async process(job: Job<IImportResultJobData>): Promise<void> {
    const { jobId, baseId, table, userId, sourceColumnMap, notification } = job.data;
    const manifest = (await this.cacheService.get(getImportResultManifestKey(jobId))) as
      | IImportResultManifest
      | undefined;

    if (!manifest) {
      this.logger.warn(`Import manifest missing for job ${jobId}`);
      await this.cleanupImportDir(jobId);
      return;
    }

    try {
      if (!notification) {
        return;
      }

      if (manifest.failedCount === 0 && manifest.successCount > 0) {
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: sourceColumnMap
            ? {
                i18nKey: 'common.email.templates.notify.import.table.success.inplace',
                context: { tableName: table.name },
              }
            : {
                i18nKey: 'common.email.templates.notify.import.table.success.message',
                context: { tableName: table.name },
              },
        });
        return;
      }

      if (manifest.successCount + manifest.failedCount === 0) {
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: {
            i18nKey:
              'common.email.templates.notify.import.table.noRecordsProcessed.message' as I18nPath,
            context: {
              tableName: table.name,
            },
          },
        });
        return;
      }

      const errorReportUrl = await this.uploadMergedErrorReport(jobId, manifest);
      const message = this.buildFailureNotification(table.name, manifest, errorReportUrl);
      this.notificationService.sendImportResultNotify({
        baseId,
        tableId: table.id,
        toUserId: userId,
        message,
      });
    } finally {
      await this.cacheService.del(getImportResultManifestKey(jobId)).catch((e) => {
        this.logger.warn(`Failed to delete import manifest for job ${jobId}`, e);
      });
      await this.cleanupImportDir(jobId);
    }
  }

  private buildFailureNotification(
    tableName: string,
    manifest: IImportResultManifest,
    errorReportUrl?: string
  ): { i18nKey: I18nPath; context: Record<string, string> } {
    const hasReport = !!errorReportUrl;
    const suffix = hasReport ? 'message' : 'messageNoReport';
    const base = manifest.successCount === 0 ? 'allFailed' : 'partialSuccess';
    const i18nKey = `common.email.templates.notify.import.table.${base}.${suffix}` as I18nPath;

    const context: Record<string, string> = {
      tableName,
      failedCount: String(manifest.failedCount),
    };
    if (manifest.successCount > 0) {
      context.successCount = String(manifest.successCount);
    }
    if (hasReport) {
      context.errorReportUrl = errorReportUrl!;
    }
    return { i18nKey, context };
  }

  private async uploadMergedErrorReport(
    jobId: string,
    manifest: IImportResultManifest
  ): Promise<string | undefined> {
    if (!manifest.errorFilePaths.length || manifest.failedCount === 0) {
      return undefined;
    }

    const bucket = StorageAdapter.getBucket(UploadType.Import);
    const pathDir = StorageAdapter.getDir(UploadType.Import);
    const reportPath = `${pathDir}/error_reports/${jobId}/error_report.csv`;
    const mergedStream = new PassThrough();
    const uploadPromise = this.storageAdapter.uploadFileStream(bucket, reportPath, mergedStream, {
      'Content-Type': 'text/csv; charset=utf-8',
    });

    const headers = Array.from(
      { length: manifest.maxWidth },
      (_, i) => manifest.fieldNames[i] || `Column ${i + 1}`
    );
    const headerRow = [...headers, '__error'];
    const headerLine = '\uFEFF' + Papa.unparse({ fields: headerRow, data: [] }).trimEnd() + '\n';
    mergedStream.write(headerLine);

    try {
      for (const filePath of manifest.errorFilePaths) {
        const sourceStream = await this.storageAdapter.downloadFile(bucket, filePath);
        await this.pipeToTarget(sourceStream, mergedStream);
      }
      mergedStream.end();
      const uploadResult = await uploadPromise;
      let url = await this.storageAdapter.getPreviewUrl(
        bucket,
        uploadResult.path,
        7 * 24 * 60 * 60
      );
      if (url.startsWith('/') && this.baseConfig.storagePrefix) {
        url = this.baseConfig.storagePrefix + url;
      }
      return url;
    } catch (error) {
      mergedStream.destroy(error as Error);
      this.logger.error('Failed to merge import error report', error);
      return undefined;
    }
  }

  private async pipeToTarget(source: Readable, target: PassThrough): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      source.on('end', () => {
        source.unpipe(target);
        resolve();
      });
      source.on('error', (err) => {
        source.unpipe(target);
        reject(err);
      });
      source.pipe(target, { end: false });
    });
  }

  private async cleanupImportDir(jobId: string) {
    try {
      const dir = StorageAdapter.getDir(UploadType.Import);
      const fullPath = join(dir, jobId);
      await this.storageAdapter.deleteDir(
        StorageAdapter.getBucket(UploadType.Import),
        fullPath,
        false
      );
    } catch (error) {
      this.logger.warn(`Failed to clean up import directory for job ${jobId}`, error);
    }
  }
}

/* eslint-disable @typescript-eslint/naming-convention */
import os from 'os';
import { PassThrough, Readable } from 'stream';
import { Worker } from 'worker_threads';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { FieldType, ILocalization } from '@teable/core';
import { getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import type { IImportOptionRo, IImportColumn, IInplaceImportOptionRo } from '@teable/openapi';
import { Job, Queue, QueueEvents } from 'bullmq';
import { toNumber } from 'lodash';
import { I18nService } from 'nestjs-i18n';
import Papa from 'papaparse';
import { CacheService } from '../../../cache/cache.service';
import type { I18nPath, I18nTranslations } from '../../../types/i18n.generated';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { ImportMetricsService } from '../metrics/import-metrics.service';
import { ImportTracingService } from '../metrics/import-tracing.service';
import type { IChunkImportResult } from './import-csv.processor';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';
import { classifyImportError, formatClassifiedError } from './import-error-classifier';
import type { ITranslateFn } from './import-error-classifier';
import {
  getImportResultManifestKey,
  IMPORT_RESULT_MANIFEST_TTL_SECONDS,
  type IImportResultManifest,
} from './import-result-manifest';
import {
  ImportTableResultQueueProcessor,
  TABLE_IMPORT_RESULT_QUEUE,
} from './import-result.processor';
import {
  DEFAULT_IMPORT_CPU_USAGE,
  getWorkerPath,
  importerFactory,
  OVER_PLAN_ROW_COUNT_ERROR_MESSAGE,
} from './import.class';

const importCpuUsage = toNumber(process.env.IMPORT_CPU_USAGE ?? DEFAULT_IMPORT_CPU_USAGE);

class ImportError extends Error {
  constructor(
    message: string,
    public range?: [number, number]
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

interface ITableImportChunkJob {
  baseId: string;
  table: {
    id: string;
    name: string;
  };
  userId: string;
  origin?: {
    ip: string;
    byApi: boolean;
    userAgent: string;
    referer: string;
  };
  importerParams: Pick<IImportOptionRo, 'attachmentUrl' | 'fileType'> & {
    maxRowCount?: number;
  };
  options: {
    skipFirstNLines: number;
    sheetKey: string;
    notification: boolean;
  };
  recordsCal: {
    columnInfo?: IImportColumn[];
    fields: { id: string; name?: string; type: FieldType }[];
    sourceColumnMap?: Record<string, number | null>;
  };
  ro: IImportOptionRo | IInplaceImportOptionRo;
  logId: string;
}

export const TABLE_IMPORT_CSV_CHUNK_QUEUE = 'import-table-csv-chunk-queue';
export const TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY = Math.max(
  Math.floor(os.cpus().length * importCpuUsage),
  1
);

@Injectable()
@Processor(TABLE_IMPORT_CSV_CHUNK_QUEUE, {
  concurrency: TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY,
  lockDuration: 600000,
  lockRenewTime: 300000,
  stalledInterval: 30000,
  maxStalledCount: 2,
})
export class ImportTableCsvChunkQueueProcessor extends WorkerHost {
  public static readonly JOB_ID_PREFIX = 'import-table-csv-chunk';

  private logger = new Logger(ImportTableCsvChunkQueueProcessor.name);
  private importQueueEvents?: QueueEvents;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly importTableCsvQueueProcessor: ImportTableCsvQueueProcessor,
    private readonly importTableResultQueueProcessor: ImportTableResultQueueProcessor,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE) public readonly queue: Queue<ITableImportChunkJob>,
    private readonly cacheService: CacheService,
    private readonly i18n: I18nService<I18nTranslations>,
    private readonly prismaService: PrismaService,
    @Optional() private readonly importMetrics?: ImportMetricsService,
    @Optional() private readonly importTracing?: ImportTracingService
  ) {
    super();
    // When BACKEND_CACHE_REDIS_URI is not set, queues are backed by the local
    // fallback implementation instead of BullMQ. In that case the injected
    // queue object does not expose BullMQ's `opts.connection`, so we must guard
    // against it to avoid throwing during application bootstrap (e.g. e2e).
    const underlyingQueue = this.importTableCsvQueueProcessor.queue as Queue<unknown> & {
      // `opts` only exists when using the real BullMQ queue
      opts?: { connection?: unknown };
    };

    const connection = underlyingQueue?.opts?.connection;

    if (connection) {
      this.importQueueEvents = new QueueEvents(TABLE_IMPORT_CSV_QUEUE, {
        // Reuse the Redis connection configuration of the import queue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connection: connection as any,
      });
    } else {
      this.logger.log(
        'ImportTableCsvChunkQueueProcessor initialized without Redis connection; QueueEvents disabled (fallback queue in use).'
      );
    }
  }

  private async getUserLang(userId: string): Promise<string> {
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: userId, deletedTime: null },
        select: { lang: true },
      });
      return user?.lang ?? 'en';
    } catch {
      return 'en';
    }
  }

  private createTranslateFn(lang?: string): ITranslateFn {
    return (key: I18nPath, args?: Record<string, string>) =>
      this.i18n.t(key, { args, lang: lang ?? 'en' }) as string;
  }

  private getImportErrorNotification(
    tableName: string,
    errorMessage: string
  ): ILocalization<I18nPath> {
    if (errorMessage === OVER_PLAN_ROW_COUNT_ERROR_MESSAGE) {
      return {
        i18nKey: 'common.email.templates.notify.import.table.planLimitExceeded.message' as I18nPath,
        context: { tableName },
      };
    }
    return {
      i18nKey: 'common.email.templates.notify.import.table.failed.message',
      context: { tableName, errorMessage },
    };
  }

  public async process(job: Job<ITableImportChunkJob>) {
    const {
      baseId,
      table,
      userId,
      options: { notification },
    } = job.data;
    const importStartTime = Date.now();
    const fileType = job.data.importerParams.fileType;
    const operationType = job.data.recordsCal.sourceColumnMap ? 'inplace' : 'create_table';
    const { sourceColumnMap } = job.data.recordsCal;

    try {
      this.logger.log(
        `start chunk data job concurrency: ${TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY}`
      );
      const manifest = await this.resolveDataByWorker(job);
      this.logger.log(`import data to ${table.id} chunk data job completed`);

      const stats = {
        success: manifest.successCount,
        failed: manifest.failedCount,
        total: manifest.successCount + manifest.failedCount,
      };

      this.importTracing?.setImportAttributes({ rows: stats.total });
      this.importMetrics?.recordImportComplete({
        fileType,
        operationType,
        durationMs: Date.now() - importStartTime,
      });

      const importJobId = String(job.id);
      await this.cacheService.setDetail(
        getImportResultManifestKey(importJobId) as `import:result:manifest:${string}`,
        manifest,
        IMPORT_RESULT_MANIFEST_TTL_SECONDS
      );

      await this.importTableResultQueueProcessor.queue.add(
        TABLE_IMPORT_RESULT_QUEUE,
        {
          jobId: importJobId,
          baseId,
          table,
          userId,
          sourceColumnMap,
          notification,
          attachmentUrl: job?.data?.importerParams?.attachmentUrl,
        },
        {
          // Some queue backends reject custom IDs containing ":".
          // Keep it derived from parent jobId, but normalize to safe chars.
          jobId: `${importJobId.replace(/:/g, '_')}_result`,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );

      return stats;
    } catch (error) {
      this.importMetrics?.recordImportError({
        fileType,
        operationType,
        errorType: error instanceof ImportError ? 'import_error' : 'unknown',
      });
      let finalMessage: string | ILocalization<I18nPath> = '';
      if (error instanceof ImportError && error.range) {
        const range = error.range;
        finalMessage = {
          i18nKey: 'common.email.templates.notify.import.table.aborted.message',
          context: {
            tableName: table.name,
            errorMessage: error.message,
            range: `${range[0]}, ${range[1]}`,
          },
        };
      } else if (error instanceof Error) {
        finalMessage = this.getImportErrorNotification(table.name, error.message);
      }

      if (notification && finalMessage) {
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: finalMessage,
        });
      }

      this.logger.error('import csv chunk error: ', error);
      // throw to @OnWorkerEvent('error')
      throw error;
    }
  }

  private async resolveDataByWorker(
    job: Job<ITableImportChunkJob>
  ): Promise<IImportResultManifest> {
    const jobId = String(job.id);
    const jobData = job.data;
    const { importerParams, table, options } = jobData;

    const workerId = `worker_${getRandomString(8)}`;
    const path = getWorkerPath('parse');

    const { attachmentUrl, fileType, maxRowCount } = importerParams;

    const { skipFirstNLines, sheetKey, notification } = options;

    const importer = importerFactory(fileType, {
      url: attachmentUrl,
      type: fileType,
      maxRowCount,
    });

    const worker = new Worker(path, {
      workerData: {
        config: importer.getConfig(),
        options: {
          key: sheetKey,
          notification: notification,
          skipFirstNLines: skipFirstNLines,
        },
        id: workerId,
      },
    });

    let recordCount = 1;
    let successCount = 0;
    let failedCount = 0;
    const errorFilePaths: string[] = [];

    // Build fieldId→name map for resolving field IDs in error messages
    const { columnInfo, sourceColumnMap, fields } = jobData.recordsCal;
    const fieldIdToName = new Map(fields.map((f) => [f.id, f.name ?? f.id]));

    const userLang = await this.getUserLang(jobData.userId);
    const translate = this.createTranslateFn(userLang);

    // Build sparse field names to preserve original CSV column order.
    const fieldNames: string[] = [];
    let maxWidth = 1;
    if (columnInfo?.length) {
      for (const col of columnInfo) {
        fieldNames[col.sourceColumnIndex] = col.name;
        maxWidth = Math.max(maxWidth, col.sourceColumnIndex + 1);
      }
    } else if (sourceColumnMap) {
      for (const [fieldId, sourceIndex] of Object.entries(sourceColumnMap)) {
        if (sourceIndex !== null) {
          fieldNames[sourceIndex] = fieldIdToName.get(fieldId) ?? fieldId;
          maxWidth = Math.max(maxWidth, sourceIndex + 1);
        }
      }
    }

    return new Promise<IImportResultManifest>((resolve, reject) => {
      worker.on('message', async (result) => {
        const { type } = result;
        switch (type) {
          case 'chunk':
            ({ recordCount, successCount, failedCount } = await this.handleChunkMessage({
              result,
              sheetKey,
              workerId,
              jobData,
              jobId,
              tableId: table.id,
              maxWidth,
              userLang,
              translate,
              fieldIdToName,
              errorFilePaths,
              recordCount,
              successCount,
              failedCount,
              worker,
              parentJob: job,
            }));
            break;
          case 'finished':
            worker.terminate();
            resolve({
              successCount,
              failedCount,
              errorFilePaths,
              fieldNames,
              maxWidth,
            });
            break;
          case 'error':
            worker.terminate();
            reject(new Error(result.data as string));
            break;
        }
      });
      worker.on('error', (e) => {
        worker.terminate();
        reject(e);
      });
      worker.on('exit', (code) => {
        this.logger.log(`Worker stopped with exit code ${code}`);
      });
    });
  }

  private async handleChunkMessage(params: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any;
    sheetKey: string;
    workerId: string;
    jobData: ITableImportChunkJob;
    jobId: string;
    tableId: string;
    maxWidth: number;
    userLang: string;
    translate: ITranslateFn;
    fieldIdToName: Map<string, string>;
    errorFilePaths: string[];
    recordCount: number;
    successCount: number;
    failedCount: number;
    worker: Worker;
    parentJob: Job<ITableImportChunkJob>;
  }): Promise<{ recordCount: number; successCount: number; failedCount: number }> {
    const {
      result,
      sheetKey,
      workerId,
      jobData,
      jobId,
      tableId,
      maxWidth,
      userLang,
      translate,
      fieldIdToName,
      errorFilePaths,
      worker,
      parentJob,
    } = params;
    let { recordCount, successCount, failedCount } = params;
    const { data, chunkId, id, lastChunk } = result;
    const rawRecords = (data as Record<string, unknown>)?.[sheetKey];
    const records: unknown[][] = Array.isArray(rawRecords)
      ? (rawRecords.filter((row) => row != null) as unknown[][])
      : [];
    recordCount += records.length;
    if (records.length === 0) {
      worker.postMessage({ type: 'done', chunkId });
      return { recordCount, successCount, failedCount };
    }
    try {
      if (workerId === id) {
        const chunkResult = await this.chunkToFile(
          jobData,
          jobId,
          tableId,
          [recordCount - records.length, recordCount - 1],
          records,
          lastChunk,
          { maxWidth, userLang }
        );
        if (chunkResult) {
          if (chunkResult.errorFilePath && chunkResult.failedCount > 0) {
            errorFilePaths.push(chunkResult.errorFilePath);
          }
          successCount += chunkResult.successCount;
          failedCount += chunkResult.failedCount;
        }
      }
      await parentJob.updateProgress({ successCount, failedCount });
      worker.postMessage({ type: 'done', chunkId });
      return { recordCount, successCount, failedCount };
    } catch (e: unknown) {
      const error = e as Error;
      const chunkStartRow = recordCount - records.length;
      this.logger.error(
        `Chunk [${chunkStartRow}, ${recordCount - 1}] had a catastrophic error: ${error?.message}`,
        error?.stack
      );
      const rawMsg = `Chunk processing failed: ${error?.message ?? String(e)}`;
      const classified = classifyImportError(rawMsg);
      const translatedMsg = formatClassifiedError(classified, translate, fieldIdToName);
      const path = await this.writeCatastrophicChunkErrors(
        jobId,
        [chunkStartRow, recordCount - 1],
        records,
        translatedMsg,
        maxWidth
      );
      if (path) {
        errorFilePaths.push(path);
      }
      failedCount += records.length;
      worker.postMessage({ type: 'done', chunkId });
      return { recordCount, successCount, failedCount };
    }
  }

  private async chunkToFile(
    job: ITableImportChunkJob,
    jobId: string,
    tableId: string,
    range: [number, number],
    records: unknown[][],
    lastChunk: boolean,
    errorReportConfig: { maxWidth: number; userLang: string }
  ): Promise<IChunkImportResult | undefined> {
    const { baseId, userId, origin, table, recordsCal, ro, logId } = job;

    const { columnInfo, fields, sourceColumnMap } = recordsCal;

    const bucket = StorageAdapter.getBucket(UploadType.Import);

    // Filter out undefined/null rows that can come from the worker parser
    // (e.g. trailing empty lines in the source file). Papa.unparse will throw
    // "Cannot read properties of undefined (reading 'length')" on such rows.
    const cleanRecords = records.filter((row) => row != null);

    if (cleanRecords.length === 0) {
      return undefined;
    }

    const csvString = Papa.unparse(cleanRecords);

    // add BOM to make sure the csv file can be opened correctly in excel with UTF-8 encoding
    const csvWithBOM = '\uFEFF' + csvString;

    const csvStream = Readable.from(csvWithBOM, { encoding: 'utf8' });

    const pathDir = StorageAdapter.getDir(UploadType.Import);

    const { path } = await this.storageAdapter.uploadFileStream(
      bucket,
      `${pathDir}/${jobId}/${tableId}_[${range[0]},${range[1]}].csv`,
      csvStream,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'text/csv; charset=utf-8',
      }
    );

    const chunkJobId = this.importTableCsvQueueProcessor.getChunkImportJobId(jobId, range);

    const jobData = {
      baseId,
      userId,
      origin,
      path,
      columnInfo,
      fields,
      sourceColumnMap,
      table,
      range,
      notification: false, // Notification now handled by parent after aggregation
      lastChunk,
      parentJobId: jobId,
      ro,
      logId,
      errorReportConfig,
    };

    if (this.importQueueEvents) {
      // Redis mode: use the queue and wait for the result
      const importJob = await this.importTableCsvQueueProcessor.queue.add(
        TABLE_IMPORT_CSV_QUEUE,
        jobData,
        {
          jobId: chunkJobId,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );

      // Wait for the current chunk import job to complete before processing the next chunk,
      // ensuring that all chunks of the same import task are executed sequentially across multiple Pods.
      return (await importJob.waitUntilFinished(
        this.importQueueEvents,
        200000
      )) as IChunkImportResult;
    }

    // Fallback (non-Redis) mode: call the processor directly to get the result,
    // since the local queue's fire-and-forget approach discards return values.
    const fakeJob = {
      id: chunkJobId,
      data: jobData,
    } as Job;
    return await this.importTableCsvQueueProcessor.process(fakeJob);
  }

  private async writeCatastrophicChunkErrors(
    jobId: string,
    range: [number, number],
    rows: unknown[][],
    translatedMessage: string,
    maxWidth: number
  ): Promise<string | undefined> {
    if (!rows.length) {
      return undefined;
    }
    const bucket = StorageAdapter.getBucket(UploadType.Import);
    const pathDir = StorageAdapter.getDir(UploadType.Import);
    const errorPath = `${pathDir}/${jobId}/chunk_errors_[${range[0]},${range[1]}].csv`;
    const stream = new PassThrough();
    const uploadPromise = this.storageAdapter.uploadFileStream(bucket, errorPath, stream, {
      'Content-Type': 'text/csv; charset=utf-8',
    });
    for (const row of rows) {
      const originalCells = Array.isArray(row) ? row : [];
      const padded = [...originalCells];
      while (padded.length < maxWidth) padded.push('');
      const line = Papa.unparse([[...padded, translatedMessage]], { header: false });
      stream.write(line.endsWith('\n') ? line : line + '\n');
    }
    stream.end();
    try {
      const result = await uploadPromise;
      return result.path;
    } catch (error) {
      this.logger.warn(`Failed to write catastrophic chunk errors for [${range}]`, error);
      return undefined;
    }
  }

  @OnWorkerEvent('error')
  async onError(job: Job) {
    if (!job?.data) {
      this.logger.error('import csv job data is undefined');
      return;
    }

    const { table, range } = job.data;
    const jobId = String(job.id);

    this.logger.error(`import data to ${table.id} chunk data job failed, range: [${range}]`);

    const allJobs = (await this.queue.getJobs(['waiting', 'active'])).filter((job) =>
      job.id?.startsWith(jobId)
    );

    for (const relatedJob of allJobs) {
      try {
        await relatedJob.remove();
      } catch (error) {
        this.logger.warn(`Failed to cancel job ${relatedJob.id}: ${error}`);
      }
    }

    const localPresence = this.importTableCsvQueueProcessor.createImportPresence(
      table.id,
      'status'
    );
    this.importTableCsvQueueProcessor.setImportStatus(localPresence, true);
  }
}

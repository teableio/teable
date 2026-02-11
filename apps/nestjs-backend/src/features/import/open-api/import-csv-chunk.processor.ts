/* eslint-disable @typescript-eslint/naming-convention */
import os from 'os';
import { Readable } from 'stream';
import { Worker } from 'worker_threads';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { FieldType, ILocalization } from '@teable/core';
import { getRandomString } from '@teable/core';
import { UploadType } from '@teable/openapi';
import type { IImportOptionRo, IImportColumn, IInplaceImportOptionRo } from '@teable/openapi';
import { Job, Queue, QueueEvents } from 'bullmq';
import { toNumber } from 'lodash';
import Papa from 'papaparse';
import type { I18nPath } from '../../../types/i18n.generated';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { ImportMetricsService } from '../metrics/import-metrics.service';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';
import { DEFAULT_IMPORT_CPU_USAGE, getWorkerPath, importerFactory } from './import.class';

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
    fields: { id: string; type: FieldType }[];
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
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE) public readonly queue: Queue<ITableImportChunkJob>,
    @Optional() private readonly importMetrics?: ImportMetricsService
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

    try {
      this.logger.log(
        `start chunk data job concurrency: ${TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY}`
      );
      const rowCount = await this.resolveDataByWorker(job);
      this.logger.log(`import data to ${table.id} chunk data job completed`);
      this.importMetrics?.recordImportComplete({
        fileType,
        operationType,
        rows: rowCount,
        durationMs: Date.now() - importStartTime,
      });
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
        finalMessage = {
          i18nKey: 'common.email.templates.notify.import.table.failed.message',
          context: { tableName: table.name, errorMessage: error.message },
        };
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

  private async resolveDataByWorker(job: Job<ITableImportChunkJob>): Promise<number> {
    const jobId = String(job.id);
    const jobData = job.data;
    const { importerParams, table, options, baseId, userId, recordsCal } = jobData;

    const workerId = `worker_${getRandomString(8)}`;
    const path = getWorkerPath('parse');

    const { attachmentUrl, fileType, maxRowCount } = importerParams;
    const { sourceColumnMap } = recordsCal;

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

    // record count for error notification
    let recordCount = 1;

    return new Promise<number>((resolve, reject) => {
      worker.on('message', async (result) => {
        const { type, data, chunkId, id, lastChunk } = result;
        switch (type) {
          case 'chunk': {
            const records = (data as Record<string, unknown[][]>)[sheetKey];
            // fill data
            recordCount += records.length;
            if (records.length === 0) {
              // Even if the chunk is empty, we need to notify the worker
              // that we've finished processing it to avoid blocking
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
              worker.postMessage({ type: 'done', chunkId });
              return;
            }
            try {
              if (workerId === id) {
                await this.chunkToFile(
                  jobData,
                  jobId,
                  table.id,
                  [recordCount - records.length, recordCount - 1],
                  records,
                  lastChunk
                );
              }
              worker.postMessage({ type: 'done', chunkId });
            } catch (e: unknown) {
              const error = e as Error;
              this.logger.error(error?.message, error?.stack);
              const range: [number, number] = [recordCount - records.length, recordCount - 1];
              worker.terminate();
              const importError = new ImportError(error.message || String(e), range);
              importError.stack = error.stack;
              reject(importError);
            }
            break;
          }
          case 'finished':
            worker.terminate();
            resolve(recordCount - 1);
            break;
          case 'error':
            worker.terminate();
            reject(new Error(data as string));
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

  private async chunkToFile(
    job: ITableImportChunkJob,
    jobId: string,
    tableId: string,
    range: [number, number],
    records: unknown[][],
    lastChunk: boolean
  ) {
    const {
      baseId,
      userId,
      origin,
      table,
      recordsCal,
      options: { notification },
      ro,
      logId,
    } = job;

    const { columnInfo, fields, sourceColumnMap } = recordsCal;

    const bucket = StorageAdapter.getBucket(UploadType.Import);

    const csvString = Papa.unparse(records);

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

    const importJob = await this.importTableCsvQueueProcessor.queue.add(
      TABLE_IMPORT_CSV_QUEUE,
      {
        baseId,
        userId,
        origin,
        path,
        columnInfo,
        fields,
        sourceColumnMap,
        table,
        range,
        notification,
        lastChunk,
        parentJobId: jobId,
        ro,
        logId,
      },
      {
        jobId: chunkJobId,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      }
    );

    // Wait for the current chunk import job to complete before processing the next chunk,
    // ensuring that all chunks of the same import task are executed sequentially across multiple Pods.
    // In fallback (non-Redis) mode, `importQueueEvents` is undefined and jobs are handled
    // in-process, so there is nothing to wait for.
    if (this.importQueueEvents) {
      await importJob.waitUntilFinished(this.importQueueEvents, 200000);
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

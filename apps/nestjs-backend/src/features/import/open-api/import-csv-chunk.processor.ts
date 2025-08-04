/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'stream';
import { Worker } from 'worker_threads';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { FieldType } from '@teable/core';
import { getRandomString } from '@teable/core';
import { UploadType } from '@teable/openapi';
import type { IImportOptionRo, IImportColumn } from '@teable/openapi';
import { Job, Queue } from 'bullmq';
import Papa from 'papaparse';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { ImportTableCsvQueueProcessor, TABLE_IMPORT_CSV_QUEUE } from './import-csv.processor';
import { getWorkerPath, importerFactory } from './import.class';

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
}

export const TABLE_IMPORT_CSV_CHUNK_QUEUE = 'import-table-csv-chunk-queue';
export const TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY = 6;

@Injectable()
@Processor(TABLE_IMPORT_CSV_CHUNK_QUEUE, {
  concurrency: TABLE_IMPORT_CSV_CHUNK_QUEUE_CONCURRENCY,
})
export class ImportTableCsvChunkQueueProcessor extends WorkerHost {
  public static readonly JOB_ID_PREFIX = 'import-table-csv-chunk';

  private logger = new Logger(ImportTableCsvChunkQueueProcessor.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly importTableCsvQueueProcessor: ImportTableCsvQueueProcessor,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE) public readonly queue: Queue<ITableImportChunkJob>
  ) {
    super();
  }

  public async process(job: Job<ITableImportChunkJob>) {
    const {
      baseId,
      table,
      userId,
      options: { notification },
    } = job.data;

    try {
      await this.resolveDataByWorker(job);
      this.logger.log(`import data to ${table.id} chunk data job completed`);
    } catch (error) {
      let finalMessage = '';
      if (error instanceof ImportError && error.range) {
        const range = error.range;
        finalMessage = `❌ ${table.name} import aborted: ${error.message} fail row range: [${range[0]}, ${range[1]}]. Please check the data for this range and retry`;
      } else if (error instanceof Error) {
        finalMessage = `❌ ${table.name} import failed: ${error.message}`;
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

  private async resolveDataByWorker(job: Job<ITableImportChunkJob>) {
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

    // record count for error notification
    let recordCount = 1;

    return new Promise<void>((resolve, reject) => {
      worker.on('message', async (result) => {
        const { type, data, chunkId, id, lastChunk } = result;
        switch (type) {
          case 'chunk': {
            const records = (data as Record<string, unknown[][]>)[sheetKey];
            // fill data
            recordCount += records.length;
            if (records.length === 0) {
              return;
            }
            try {
              workerId === id &&
                (await this.chunkToFile(
                  jobData,
                  jobId,
                  table.id,
                  [recordCount - records.length, recordCount - 1],
                  records,
                  lastChunk
                ));
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
            resolve();
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
      table,
      recordsCal,
      options: { notification },
    } = job;

    const { columnInfo, fields, sourceColumnMap } = recordsCal;

    const bucket = StorageAdapter.getBucket(UploadType.Import);

    const csvString = Papa.unparse(records);

    const csvStream = Readable.from([csvString]);

    const pathDir = StorageAdapter.getDir(UploadType.Import);

    const { path } = await this.storageAdapter.uploadFileStream(
      bucket,
      `${pathDir}/${jobId}/${tableId}_[${range[0]},${range[1]}].csv`,
      csvStream,
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'text/csv',
      }
    );

    const chunkJobId = this.importTableCsvQueueProcessor.getChunkImportJobId(jobId, range);

    await this.importTableCsvQueueProcessor.queue.add(
      TABLE_IMPORT_CSV_QUEUE,
      {
        baseId,
        userId,
        path,
        columnInfo,
        fields,
        sourceColumnMap,
        table,
        range,
        notification,
        lastChunk,
        parentJobId: jobId,
      },
      {
        jobId: chunkJobId,
        removeOnComplete: true,
        removeOnFail: true,
        delay: 1000,
      }
    );
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

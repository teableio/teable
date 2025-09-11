/* eslint-disable @typescript-eslint/naming-convention */
import { join } from 'path';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  FieldKeyType,
  FieldType,
  getActionTriggerChannel,
  getRandomString,
  getTableImportChannel,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType, type IImportColumn } from '@teable/openapi';
import { Job, Queue } from 'bullmq';
import { toString } from 'lodash';
import { ClsService } from 'nestjs-cls';
import Papa from 'papaparse';
import type { CreateOp } from 'sharedb';
import type { LocalPresence } from 'sharedb/lib/client';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IClsStore } from '../../../types/cls';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { parseBoolean } from './import.class';

interface ITableImportCsvJob {
  baseId: string;
  userId: string;
  path: string;
  columnInfo?: IImportColumn[];
  fields: { id: string; type: FieldType }[];
  sourceColumnMap?: Record<string, number | null>;
  table: { id: string; name: string };
  range: [number, number];
  notification?: boolean;
  lastChunk?: boolean;
  parentJobId: string;
}

export const TABLE_IMPORT_CSV_QUEUE = 'import-table-csv-queue';

@Injectable()
@Processor(TABLE_IMPORT_CSV_QUEUE)
export class ImportTableCsvQueueProcessor extends WorkerHost {
  public static readonly JOB_ID_PREFIX = 'import-table-csv';

  private logger = new Logger(ImportTableCsvQueueProcessor.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private presences: LocalPresence<any>[] = [];

  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly shareDbService: ShareDbService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(TABLE_IMPORT_CSV_QUEUE) public readonly queue: Queue<ITableImportCsvJob>
  ) {
    super();
  }

  public async process(job: Job<ITableImportCsvJob>) {
    const { table, notification, baseId, userId, lastChunk, sourceColumnMap, range } = job.data;
    const localPresence = this.createImportPresence(table.id, 'status');
    this.setImportStatus(localPresence, true);
    try {
      await this.handleImportChunkCsv(job);
      if (lastChunk) {
        notification &&
          this.notificationService.sendImportResultNotify({
            baseId,
            tableId: table.id,
            toUserId: userId,
            message: `🎉 ${table.name} ${sourceColumnMap ? 'inplace' : ''} imported successfully`,
          });

        this.eventEmitterService.emitAsync(Events.IMPORT_TABLE_COMPLETE, {
          baseId,
          tableId: table.id,
        });

        this.setImportStatus(localPresence, false);
        localPresence.destroy();
        this.presences = this.presences.filter(
          (presence) => presence.presenceId !== localPresence.presenceId
        );

        const dir = StorageAdapter.getDir(UploadType.Import);
        const fullPath = join(dir, job.data.parentJobId);
        await this.storageAdapter.deleteDir(
          StorageAdapter.getBucket(UploadType.Import),
          fullPath,
          false
        );
      }
    } catch (error) {
      const err = error as Error;
      notification &&
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: `❌ ${table.name} import aborted: ${err.message} fail row range: [${range}]. Please check the data for this range and retry.`,
        });

      throw err;
    }
  }

  private async cleanRelativeTask(parentJobId: string) {
    const allJobs = (await this.queue.getJobs(['waiting', 'active'])).filter((job) =>
      job.id?.startsWith(parentJobId)
    );

    for (const relatedJob of allJobs) {
      relatedJob.remove();
    }
  }

  private async handleImportChunkCsv(job: Job<ITableImportCsvJob>) {
    await this.cls.run(async () => {
      this.cls.set('user.id', job.data.userId);
      const { columnInfo, fields, sourceColumnMap, table } = job.data;
      const currentResult = await this.getChunkData(job);
      // fill data
      const records = currentResult.map((row) => {
        const res: { fields: Record<string, unknown> } = {
          fields: {},
        };
        // import new table
        if (columnInfo) {
          columnInfo.forEach((col, index) => {
            const { sourceColumnIndex, type } = col;
            // empty row will be return void row value
            const value = Array.isArray(row) ? row[sourceColumnIndex] : null;
            res.fields[fields[index].id] =
              type === FieldType.Checkbox ? parseBoolean(value) : value?.toString();
          });
        }
        // inplace records
        if (sourceColumnMap) {
          for (const [key, value] of Object.entries(sourceColumnMap)) {
            if (value !== null) {
              const { type } = fields.find((f) => f.id === key) || {};
              // link value should be string
              res.fields[key] = type === FieldType.Link ? toString(row[value]) : row[value];
            }
          }
        }
        return res;
      });
      if (records.length === 0) {
        return;
      }
      try {
        const createFn = columnInfo
          ? this.recordOpenApiService.createRecordsOnlySql.bind(this.recordOpenApiService)
          : this.recordOpenApiService.multipleCreateRecords.bind(this.recordOpenApiService);
        await createFn(table.id, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records,
        });
      } catch (e: unknown) {
        this.logger.error(e);
        throw e;
      }
    });
  }

  private async getChunkData(job: Job<ITableImportCsvJob>): Promise<unknown[][]> {
    const { path } = job.data;
    const stream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    return new Promise((resolve, reject) => {
      Papa.parse(stream, {
        download: false,
        dynamicTyping: false,
        complete: (result) => {
          resolve(result.data as unknown[][]);
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  }

  private updateRowCount(tableId: string) {
    const localPresence = this.createImportPresence(tableId, 'rowCount');
    localPresence.submit([{ actionKey: 'addRecord' }], (error) => {
      error && this.logger.error(error);
    });

    const updateEmptyOps = {
      src: 'unknown',
      seq: 1,
      m: {
        ts: Date.now(),
      },
      create: {
        type: 'json0',
        data: undefined,
      },
      v: 0,
    } as CreateOp;
    this.shareDbService.publishRecordChannel(tableId, updateEmptyOps);
  }

  // this is for cache refresh
  private updateTableLastModified(tableId: string) {
    this.prismaService.txClient().tableMeta.update({
      where: { id: tableId },
      data: { lastModifiedTime: new Date().toISOString() },
    });
  }

  setImportStatus(presence: LocalPresence<unknown>, loading: boolean) {
    presence.submit(
      {
        loading,
      },
      (error) => {
        error && this.logger.error(error);
      }
    );
  }

  createImportPresence(tableId: string, type: 'rowCount' | 'status' = 'status') {
    const channel =
      type === 'rowCount' ? getActionTriggerChannel(tableId) : getTableImportChannel(tableId);
    const existPresence = this.presences.find(({ presence }) => {
      return presence.channel === channel;
    });
    if (existPresence) {
      return existPresence;
    }
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(channel);
    this.presences.push(localPresence);
    return localPresence;
  }

  public getChunkImportJobIdPrefix(parentId: string) {
    return `${parentId}_import_${getRandomString(6)}`;
  }

  public getChunkImportJobId(jobId: string, range: [number, number]) {
    const prefix = this.getChunkImportJobIdPrefix(jobId);
    return `${prefix}_[${range[0]},${range[1]}]`;
  }

  @OnWorkerEvent('active')
  onWorkerEvent(job: Job) {
    const { table, range } = job.data;
    this.logger.log(`import data to ${table.id} job started, range: [${range}]`);
  }

  @OnWorkerEvent('error')
  async onError(job: Job) {
    if (!job?.data) {
      this.logger.error('import csv job data is undefined');
      return;
    }
    const { table, range, parentJobId } = job.data;
    this.logger.error(`import data to ${table.id} job failed, range: [${range}]`);
    this.cleanRelativeTask(parentJobId);
    const localPresence = this.createImportPresence(table.id, 'status');
    this.setImportStatus(localPresence, false);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    const { table, range, columnInfo } = job.data;
    this.logger.log(`import data to ${table.id} job completed, range: [${range}]`);
    // create new table need update row count and table last modified
    if (columnInfo) {
      this.updateRowCount(table.id);
      this.updateTableLastModified(table.id);
    }
  }
}

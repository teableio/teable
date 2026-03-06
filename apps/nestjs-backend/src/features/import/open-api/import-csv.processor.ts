/* eslint-disable @typescript-eslint/naming-convention */
import { PassThrough } from 'stream';
import { text } from 'stream/consumers';
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
import { CreateRecordAction, UploadType } from '@teable/openapi';
import type {
  ICreateRecordsRo,
  IImportOptionRo,
  IImportColumn,
  IInplaceImportOptionRo,
} from '@teable/openapi';
import { Job, Queue } from 'bullmq';
import { chunk as chunkArray, toString } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { I18nService } from 'nestjs-i18n';
import Papa from 'papaparse';
import type { CreateOp } from 'sharedb';
import type { LocalPresence } from 'sharedb/lib/client';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IClsStore } from '../../../types/cls';
import type { I18nPath, I18nTranslations } from '../../../types/i18n.generated';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { NotificationService } from '../../notification/notification.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { classifyImportError, formatClassifiedError } from './import-error-classifier';
import type { ITranslateFn } from './import-error-classifier';
import { ImportErrorCollector } from './import-error-collector';
import { parseBoolean } from './import.class';

interface ITableImportCsvJob {
  baseId: string;
  userId: string;
  origin?: {
    ip: string;
    byApi: boolean;
    userAgent: string;
    referer: string;
  };
  path: string;
  columnInfo?: IImportColumn[];
  fields: { id: string; name?: string; type: FieldType }[];
  sourceColumnMap?: Record<string, number | null>;
  table: { id: string; name: string };
  range: [number, number];
  notification?: boolean;
  lastChunk?: boolean;
  parentJobId: string;
  ro: IImportOptionRo | IInplaceImportOptionRo;
  logId: string;
  /** Provided by parent so child can write errors to S3 instead of returning them via Redis */
  errorReportConfig?: {
    maxWidth: number;
    userLang: string;
  };
}

export const TABLE_IMPORT_CSV_QUEUE = 'import-table-csv-queue';
export const SUB_BATCH_SIZE = 50;

export interface IChunkImportResult {
  successCount: number;
  failedCount: number;
  /** S3 path to headerless CSV rows of failed records (only set when failedCount > 0) */
  errorFilePath?: string;
}

@Injectable()
@Processor(TABLE_IMPORT_CSV_QUEUE, {
  concurrency: 1,
})
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
    @InjectQueue(TABLE_IMPORT_CSV_QUEUE) public readonly queue: Queue<ITableImportCsvJob>,
    private readonly i18n: I18nService<I18nTranslations>
  ) {
    super();
  }

  public async process(job: Job<ITableImportCsvJob>): Promise<IChunkImportResult> {
    const { table, notification, baseId, userId, lastChunk, range } = job.data;
    const localPresence = this.createImportPresence(table.id, 'status');
    this.setImportStatus(localPresence, true);
    try {
      const errorCollector = await this.handleImportChunkCsv(job);
      await this.emitImportAuditLog(job, errorCollector.successCount);

      let errorFilePath: string | undefined;
      if (errorCollector.hasErrors()) {
        errorFilePath = await this.writeChunkErrorsToStorage(job, errorCollector);
      }

      const result: IChunkImportResult = {
        successCount: errorCollector.successCount,
        failedCount: errorCollector.failedCount,
        errorFilePath,
      };

      if (lastChunk) {
        this.setImportStatus(localPresence, false);
        localPresence.destroy();
        this.presences = this.presences.filter(
          (presence) => presence.presenceId !== localPresence.presenceId
        );
      }

      return result;
    } catch (error) {
      const err = error as Error;
      notification &&
        this.notificationService.sendImportResultNotify({
          baseId,
          tableId: table.id,
          toUserId: userId,
          message: {
            i18nKey: 'common.email.templates.notify.import.table.aborted.message',
            context: {
              tableName: table.name,
              errorMessage: err.message,
              range: `${range[0]}, ${range[1]}`,
            },
          },
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

  private async handleImportChunkCsv(job: Job<ITableImportCsvJob>): Promise<ImportErrorCollector> {
    const errorCollector = new ImportErrorCollector();

    await this.cls.run(async () => {
      this.cls.set('user.id', job.data.userId);
      this.cls.set('origin', job.data.origin!);
      this.cls.set('skipRecordAuditLog', true);
      const { columnInfo, fields, sourceColumnMap, table, range } = job.data;
      const currentResult = await this.getChunkData(job);

      // Build records with source metadata for error reporting
      const recordsWithMeta = currentResult.map((row, index) => {
        const res: {
          fields: Record<string, unknown>;
          __sourceRowIndex: number;
          __sourceData: unknown[];
        } = {
          fields: {},
          __sourceRowIndex: range[0] + index,
          __sourceData: Array.isArray(row) ? row : [],
        };
        // import new table
        if (columnInfo) {
          columnInfo.forEach((col, colIndex) => {
            const { sourceColumnIndex, type } = col;
            const value = Array.isArray(row) ? row[sourceColumnIndex] : null;
            res.fields[fields[colIndex].id] =
              type === FieldType.Checkbox ? parseBoolean(value) : value?.toString();
          });
        }
        // inplace records
        if (sourceColumnMap) {
          for (const [key, value] of Object.entries(sourceColumnMap)) {
            if (value !== null) {
              const { type } = fields.find((f) => f.id === key) || {};
              res.fields[key] = type === FieldType.Link ? toString(row[value]) : row[value];
            }
          }
        }
        return res;
      });

      if (recordsWithMeta.length === 0) {
        return;
      }

      const createFn: (
        tableId: string,
        createRecordsRo: ICreateRecordsRo,
        ignoreMissingFields?: boolean
      ) => Promise<unknown> = columnInfo
        ? (tableId, createRecordsRo) =>
            this.recordOpenApiService.createRecordsOnlySql(tableId, createRecordsRo)
        : (tableId, createRecordsRo, ignoreMissingFields = false) =>
            this.recordOpenApiService.multipleCreateRecords(
              tableId,
              createRecordsRo,
              ignoreMissingFields
            );

      const fieldIdToName = new Map(fields.map((f) => [f.id, f.name ?? f.id]));
      const fieldIdToType = new Map(fields.map((f) => [f.id, f.type]));

      // Optimistic: try inserting the entire chunk at once.
      // In the common case (no bad rows), this is a single INSERT for the whole chunk.
      const cleanRecords = recordsWithMeta.map(({ fields: f }) => ({ fields: f }));
      try {
        await createFn(
          table.id,
          { fieldKeyType: FieldKeyType.Id, typecast: true, records: cleanRecords },
          false
        );
        errorCollector.addSuccessCount(recordsWithMeta.length);
      } catch {
        // Chunk has bad rows — fall back to sub-batch + binary search to locate them
        const subBatches = chunkArray(recordsWithMeta, SUB_BATCH_SIZE);
        for (const subBatch of subBatches) {
          await this.insertWithBinaryFallback(
            subBatch,
            createFn,
            table.id,
            errorCollector,
            fieldIdToName,
            fieldIdToType
          );
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    });

    return errorCollector;
  }

  /**
   * Translate collected errors and write them to S3 as headerless CSV rows.
   * The parent processor will pipe these rows into the final error report stream.
   * Returns the S3 path, or undefined if writing fails (errors are logged but not rethrown).
   */
  private async writeChunkErrorsToStorage(
    job: Job<ITableImportCsvJob>,
    errorCollector: ImportErrorCollector
  ): Promise<string | undefined> {
    const { errorReportConfig, parentJobId, range, fields } = job.data;
    const errors = errorCollector.getErrors();
    if (errors.length === 0) return undefined;

    const maxWidth = errorReportConfig?.maxWidth ?? 1;

    const fieldIdToName = new Map(fields.map((f) => [f.id, f.name ?? f.id]));
    const translate = this.createTranslateFn(errorReportConfig?.userLang);

    try {
      const stream = new PassThrough();
      const bucket = StorageAdapter.getBucket(UploadType.Import);
      const pathDir = StorageAdapter.getDir(UploadType.Import);
      const errorPath = `${pathDir}/${parentJobId}/chunk_errors_[${range[0]},${range[1]}].csv`;

      const uploadPromise = this.storageAdapter.uploadFileStream(bucket, errorPath, stream, {
        'Content-Type': 'text/csv; charset=utf-8',
      });

      for (const error of errors) {
        const classified = classifyImportError(error.errorMessage);
        const translatedMsg = formatClassifiedError(
          classified,
          translate,
          fieldIdToName,
          error.failedFieldNames
        );
        const originalCells = Array.isArray(error.originalData) ? error.originalData : [];
        const padded = [...originalCells];
        while (padded.length < maxWidth) padded.push('');
        const row = [...padded, translatedMsg];
        const line = Papa.unparse([row], { header: false });
        stream.write(line.endsWith('\n') ? line : line + '\n');
      }

      stream.end();
      const result = await uploadPromise;
      return result.path;
    } catch (e) {
      this.logger.warn(`Failed to write chunk errors to S3 for range [${range}]`, e);
      return undefined;
    }
  }

  private createTranslateFn(lang?: string): ITranslateFn {
    return (key: I18nPath, args?: Record<string, string>) =>
      this.i18n.t(key, { args, lang: lang ?? 'en' }) as string;
  }

  /**
   * Binary search fallback for fault-tolerant record insertion.
   *
   * Tries to insert all records at once. On failure, splits in half and recurses.
   * When down to a single record that fails, logs the error and continues.
   *
   * Performance: For N records with K bad ones, takes O(N/B + K*log(B)) INSERT calls
   * where B is the sub-batch size, vs O(N) for naive single-record fallback.
   */
  private async insertWithBinaryFallback(
    recordsWithMeta: {
      fields: Record<string, unknown>;
      __sourceRowIndex: number;
      __sourceData: unknown[];
    }[],
    createFn: (
      tableId: string,
      createRecordsRo: ICreateRecordsRo,
      ignoreMissingFields?: boolean
    ) => Promise<unknown>,
    tableId: string,
    errorCollector: ImportErrorCollector,
    fieldIdToName: Map<string, string>,
    fieldIdToType: Map<string, FieldType>
  ): Promise<void> {
    // Strip metadata before passing to createFn
    const cleanRecords = recordsWithMeta.map(({ fields }) => ({ fields }));

    try {
      await createFn(
        tableId,
        {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: cleanRecords,
        },
        false
      );
      errorCollector.addSuccessCount(recordsWithMeta.length);
    } catch (e: unknown) {
      if (recordsWithMeta.length === 1) {
        const record = recordsWithMeta[0];
        const rawMessage = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Import row ${record.__sourceRowIndex} failed: ${rawMessage.slice(0, 200)}`
        );
        const failedFieldNames = this.identifyFailingFields(
          rawMessage,
          record.fields,
          fieldIdToName,
          fieldIdToType
        );
        errorCollector.add({
          rowIndex: record.__sourceRowIndex,
          originalData: record.__sourceData,
          errorMessage: rawMessage,
          failedFieldNames: failedFieldNames.length > 0 ? failedFieldNames : undefined,
        });
        return;
      }

      // Binary split: try each half separately
      const mid = Math.ceil(recordsWithMeta.length / 2);
      const firstHalf = recordsWithMeta.slice(0, mid);
      const secondHalf = recordsWithMeta.slice(mid);

      await this.insertWithBinaryFallback(
        firstHalf,
        createFn,
        tableId,
        errorCollector,
        fieldIdToName,
        fieldIdToType
      );
      await this.insertWithBinaryFallback(
        secondHalf,
        createFn,
        tableId,
        errorCollector,
        fieldIdToName,
        fieldIdToType
      );
    }
  }

  private static readonly DATE_FIELD_TYPES = new Set([
    FieldType.Date,
    FieldType.CreatedTime,
    FieldType.LastModifiedTime,
  ]);

  private static readonly DATE_ERROR_RE =
    /time zone displacement out of range|date\/time field value out of range/i;

  // Use atomic-style regex: field IDs are word chars separated by ", "
  private static readonly FIELD_VALIDATION_RE =
    /Fields?\s+(\w+(?:,\s*\w+)*)\s+(?:not null|unique) validation/i;

  private identifyFailingFields(
    rawMessage: string,
    recordFields: Record<string, unknown>,
    fieldIdToName: Map<string, string>,
    fieldIdToType: Map<string, FieldType>
  ): string[] {
    if (ImportTableCsvQueueProcessor.DATE_ERROR_RE.test(rawMessage)) {
      return this.identifyDateFields(rawMessage, recordFields, fieldIdToName, fieldIdToType);
    }

    const fieldIdMatch = rawMessage.match(ImportTableCsvQueueProcessor.FIELD_VALIDATION_RE);
    if (fieldIdMatch) {
      return fieldIdMatch[1].split(/,\s*/).map((id) => fieldIdToName.get(id.trim()) ?? id.trim());
    }

    return [];
  }

  private identifyDateFields(
    rawMessage: string,
    recordFields: Record<string, unknown>,
    fieldIdToName: Map<string, string>,
    fieldIdToType: Map<string, FieldType>
  ): string[] {
    const valueMatch = rawMessage.match(/"([^"]+)"/);
    const errorValue = valueMatch?.[1] ?? '';

    const dateEntries = Object.entries(recordFields).filter(([fieldId]) =>
      ImportTableCsvQueueProcessor.DATE_FIELD_TYPES.has(fieldIdToType.get(fieldId)!)
    );

    // Try exact value match first
    const exact = dateEntries
      .filter(([, value]) => value != null && String(value).includes(errorValue))
      .map(([fieldId]) => fieldIdToName.get(fieldId) ?? fieldId);
    if (exact.length > 0) return exact;

    // Fallback: all date fields that have non-null values
    return dateEntries
      .filter(([, value]) => value != null)
      .map(([fieldId]) => fieldIdToName.get(fieldId) ?? fieldId);
  }

  private async getChunkData(job: Job<ITableImportCsvJob>): Promise<unknown[][]> {
    const { path } = job.data;
    const stream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    // Read full content so PapaParse can correctly handle newlines inside quoted cells.
    // toLineDelimitedStream would split on ALL newlines (including inside quotes),
    // causing "product\nProduct image" to become two rows instead of one.
    const csvString = await text(stream);
    return new Promise((resolve, reject) => {
      Papa.parse(csvString, {
        download: false,
        dynamicTyping: false,
        complete: (result) => {
          resolve(result.data as unknown[][]);
        },
        error: (err: Error) => {
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
  private async updateTableLastModified(tableId: string) {
    await this.prismaService.txClient().tableMeta.update({
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

  private async emitImportAuditLog(job: Job<ITableImportCsvJob>, successCount: number) {
    const { table, origin, userId, logId } = job.data;
    const { ro } = job.data;

    const actionType =
      ro && typeof ro === 'object' && 'worksheets' in ro
        ? CreateRecordAction.Import
        : CreateRecordAction.InplaceImport;

    // emit event to audit log
    await this.cls.run(async () => {
      this.cls.set('origin', origin!);
      this.cls.set('user.id', userId);
      this.eventEmitterService.emitAsync(Events.TABLE_RECORD_CREATE_RELATIVE, {
        action: actionType,
        resourceId: table.id,
        recordCount: successCount,
        params: { fileType: ro?.fileType },
        logId,
      });
    });
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
      await this.updateTableLastModified(table.id);
      this.updateRowCount(table.id);
    }
  }
}

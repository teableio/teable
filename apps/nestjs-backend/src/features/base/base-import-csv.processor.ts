import type { TransformCallback } from 'stream';
import { Transform } from 'stream';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import * as csvParser from 'csv-parser';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import * as unzipper from 'unzipper';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { EXCLUDE_SYSTEM_FIELDS } from './constant';

interface IBaseImportCsvJob {
  path: string;
  userId: string;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  structure: IBaseJson;
}

const chunkSize = 1000;

export const BASE_IMPORT_CSV_QUEUE = 'base-import-csv-queue';

@Injectable()
@Processor(BASE_IMPORT_CSV_QUEUE)
export class BaseImportCsvQueueProcessor extends WorkerHost {
  private logger = new Logger(BaseImportCsvQueueProcessor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_CSV_QUEUE) public readonly queue: Queue<IBaseImportCsvJob>
  ) {
    super();
  }

  public async process(job: Job<IBaseImportCsvJob>) {
    this.handleBaseImportCsv(job);
  }

  private async handleBaseImportCsv(job: Job<IBaseImportCsvJob>) {
    const { path, userId, tableIdMap, fieldIdMap, viewIdMap, structure } = job.data;
    const csvStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const parser = unzipper.Parse();
    csvStream.pipe(parser);

    return new Promise<{ success: boolean }>((resolve, reject) => {
      parser.on('entry', (entry) => {
        const filePath = entry.path;
        if (filePath.startsWith('tables/') && entry.type !== 'Directory') {
          const tableId = filePath.replace('tables/', '').split('.')[0];
          const table = structure.tables.find((table) => table.id === tableId);
          const attachmentsFields =
            table?.fields
              ?.filter(({ type }) => type === FieldType.Attachment)
              .map(({ dbFieldName, id }) => ({
                dbFieldName,
                id,
              })) || [];

          const batchProcessor = new BatchProcessor(
            chunkSize,
            this.handleChunk.bind(this),
            tableIdMap[tableId],
            userId,
            fieldIdMap,
            viewIdMap,
            attachmentsFields
          );

          entry
            .pipe(
              csvParser.default({
                // strict: true,
                mapValues: ({ value }) => {
                  return value;
                },
                mapHeaders: ({ header }) => {
                  if (header.startsWith('__row_')) {
                    return `__row_${viewIdMap[header.slice(5)]}`;
                  }
                  if (header.startsWith('__fk_')) {
                    return `__fk_${fieldIdMap[header.slice(5)]}`;
                  }
                  return header;
                },
              })
            )
            .pipe(batchProcessor)
            .on('error', (error: Error) => {
              this.logger.error(`process csv import error: ${error.message}`, error.stack);
              reject(error);
            })
            .on('end', () => {
              this.logger.log(`csv ${tableId} finished`);
              resolve({ success: true });
            });
        } else {
          entry.autodrain();
        }
      });
    });
  }

  private async handleChunk(
    results: Record<string, unknown>[],
    tableId: string,
    userId: string,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    attachmentsFields: { dbFieldName: string; id: string }[]
  ) {
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: {
        dbTableName: true,
      },
    });

    const attachmentsTableData = [] as {
      attachmentId: string;
      name: string;
      token: string;
      tableId: string;
      recordId: string;
      fieldId: string;
    }[];

    const newResult = [...results].map((res) => {
      const newRes = { ...res };
      const keys = Object.keys(newRes);
      const rawKeys = keys.filter((key) => key.startsWith('__row_'));
      const fkKeys = keys.filter((key) => key.startsWith('__fk_fld'));

      rawKeys.forEach((key) => {
        const value = res[key];
        const fieldId = key.slice(5);
        const newKey = fieldIdMap[fieldId] ? `__fk_${viewIdMap[fieldId]}` : key;
        newRes[newKey] = value;
        delete newRes[key];
      });

      fkKeys.forEach((key) => {
        const value = res[key];
        const viewId = key.slice(6);
        const newKey = viewIdMap[viewId] ? `__row_${viewIdMap[viewId]}` : key;
        newRes[newKey] = value;
        delete newRes[key];
      });

      EXCLUDE_SYSTEM_FIELDS.forEach((header) => {
        delete newRes[header];
      });

      return newRes;
    });

    const attachmentsDbFieldNames = attachmentsFields.map(({ dbFieldName }) => dbFieldName);

    const recordsToInsert = newResult.map((result) => {
      const res = { ...result };
      Object.entries(res).forEach(([key, value]) => {
        if (res[key] === '') {
          res[key] = null;
        }

        // attachment field should add info to attachments table
        if (attachmentsDbFieldNames.includes(key) && value) {
          const attValues = JSON.parse(value as string) as IAttachmentCellValue;
          const fieldId = attachmentsFields.find(({ dbFieldName }) => dbFieldName === key)?.id;
          attValues.forEach((att) => {
            attachmentsTableData.push({
              attachmentId: att.id,
              name: att.name,
              token: att.token,
              tableId: tableId,
              recordId: res['__id'] as string,
              fieldId: fieldIdMap[fieldId!],
            });
          });
        }
      });

      // default value set
      res['__created_by'] = userId;
      res['__version'] = 1;
      return res;
    });

    const sql = this.knex.table(dbTableName).insert(recordsToInsert).toQuery();
    await this.prismaService.txClient().$executeRawUnsafe(sql);
    await this.updateAttachmentTable(userId, attachmentsTableData);
  }

  // when insert table data relative to attachment, we need to update the attachment table
  private async updateAttachmentTable(
    userId: string,
    attachmentsTableData: {
      attachmentId: string;
      name: string;
      token: string;
      tableId: string;
      recordId: string;
      fieldId: string;
    }[]
  ) {
    await this.prismaService.txClient().attachmentsTable.createMany({
      data: attachmentsTableData.map((a) => ({ ...a, createdBy: userId })),
    });
  }
}

class BatchProcessor extends Transform {
  private buffer: Record<string, unknown>[] = [];
  private totalProcessed = 0;

  constructor(
    private readonly batchSize: number,
    private readonly processBatch: (
      batch: Record<string, unknown>[],
      tableId: string,
      userId: string,
      fieldIdMap: Record<string, string>,
      viewIdMap: Record<string, string>,
      attachmentsFields: { dbFieldName: string; id: string }[]
    ) => Promise<void>,
    private tableId: string,
    private userId: string,
    private fieldIdMap: Record<string, string>,
    private viewIdMap: Record<string, string>,
    private attachmentsFields: { dbFieldName: string; id: string }[]
  ) {
    super({ objectMode: true });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _transform(
    chunk: Record<string, unknown>,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.buffer.push(chunk);
    this.totalProcessed++;

    if (this.buffer.length >= this.batchSize) {
      const currentBatch = [...this.buffer];
      this.buffer = [];

      this.processBatch(
        currentBatch,
        this.tableId,
        this.userId,
        this.fieldIdMap,
        this.viewIdMap,
        this.attachmentsFields
      )
        .then(() => {
          this.emit('progress', { processed: this.totalProcessed });
          callback();
        })
        .catch((err: Error) => callback(err));
    } else {
      callback();
    }
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _flush(callback: TransformCallback): void {
    if (this.buffer.length > 0) {
      this.processBatch(
        this.buffer,
        this.tableId,
        this.userId,
        this.fieldIdMap,
        this.viewIdMap,
        this.attachmentsFields
      )
        .then(() => {
          this.emit('progress', { processed: this.totalProcessed });
          callback();
        })
        .catch((err: Error) => callback(err));
    } else {
      callback();
    }
  }
}

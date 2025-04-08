import type { TransformCallback } from 'stream';
import { Transform } from 'stream';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';
import type { IAttachmentCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType, generateAttachmentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { Queue, QueueEvents, Job } from 'bullmq';
import * as csvParser from 'csv-parser';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { createFieldInstanceByRaw } from '../field/model/factory';
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
  readonly queueEvents = new QueueEvents(BASE_IMPORT_CSV_QUEUE);

  private processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_CSV_QUEUE) public readonly queue: Queue<IBaseImportCsvJob>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {
    super();
  }

  public async process(job: Job<IBaseImportCsvJob>) {
    const jobId = String(job.id);
    if (this.processedJobs.has(jobId)) {
      this.logger.log(`Job ${jobId} already processed, skipping`);
      return;
    }

    this.processedJobs.add(jobId);

    try {
      await this.handleBaseImportCsv(job);
    } catch (error) {
      this.logger.error(
        `Process base import csv failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
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
        const isTable = filePath.startsWith('tables/') && entry.type !== 'Directory';
        const isJunction = filePath.includes('junction_');

        if (isTable && !isJunction) {
          const tableId = filePath.replace('tables/', '').split('.')[0];
          const table = structure.tables.find((table) => table.id === tableId);
          const attachmentsFields =
            table?.fields
              ?.filter(({ type }) => type === FieldType.Attachment)
              .map(({ dbFieldName, id }) => ({
                dbFieldName,
                id,
              })) || [];

          const batchProcessor = new BatchProcessor(this.handleChunk.bind(this), {
            tableId: tableIdMap[tableId],
            userId,
            fieldIdMap,
            viewIdMap,
            attachmentsFields,
          });

          entry
            .pipe(
              csvParser.default({
                // strict: true,
                mapValues: ({ value }) => {
                  return value;
                },
                mapHeaders: ({ header }) => {
                  if (header.startsWith('__row_') && viewIdMap[header.slice(6)]) {
                    return `__row_${viewIdMap[header.slice(6)]}`;
                  }

                  // special case for cross base link fields, there is no map causing the old error link config
                  if (header.startsWith('__fk_') && fieldIdMap[header.slice(5)]) {
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

      parser.on('close', () => {
        this.logger.log('import csv completed');
        resolve({ success: true });
      });

      parser.on('error', (error) => {
        this.logger.error(`ZIP parser error: ${error.message}`, error.stack);
        reject(error);
      });
    });
  }

  private async handleChunk(
    results: Record<string, unknown>[],
    config: {
      tableId: string;
      userId: string;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
      attachmentsFields: { dbFieldName: string; id: string }[];
    }
  ) {
    const { tableId, userId, fieldIdMap, attachmentsFields } = config;
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: {
        dbTableName: true,
      },
    });
    const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
    const columnInfo = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);

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
            const attachmentId = generateAttachmentId();
            attachmentsTableData.push({
              attachmentId,
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

    // add lacking view order field
    if (recordsToInsert.length) {
      const sourceColumns = Object.keys(recordsToInsert[0]);
      const lackingColumns = sourceColumns
        .filter((column) => !columnInfo.map(({ name }) => name).includes(column))
        .filter((name) => name.startsWith('__row_'));

      for (const name of lackingColumns) {
        const sql = this.knex.schema
          .alterTable(dbTableName, (table) => {
            table.double(name);
          })
          .toQuery();
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }

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
      data: attachmentsTableData.map((a) => ({
        ...a,
        createdBy: userId,
      })),
    });
  }

  private async importJunctionChunk(
    path: string,
    fieldIdMap: Record<string, string>,
    structure: IBaseJson
  ) {
    const csvStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const sourceLinkFields = structure.tables
      .map(({ fields }) => fields)
      .flat()
      .filter((f) => f.type === FieldType.Link && !f.isLookup);

    const linkFieldRaws = await this.prismaService.field.findMany({
      where: {
        id: {
          in: Object.values(fieldIdMap),
        },
        type: FieldType.Link,
        isLookup: null,
      },
    });

    const junctionDbTableNameMap = {} as Record<
      string,
      {
        sourceSelfKeyName: string;
        sourceForeignKeyName: string;
        targetSelfKeyName: string;
        targetForeignKeyName: string;
        targetFkHostTableName: string;
      }
    >;

    const linkFieldInstances = linkFieldRaws.map((f) => createFieldInstanceByRaw(f));

    for (const sourceField of sourceLinkFields) {
      const { options: sourceOptions } = sourceField;
      const {
        fkHostTableName: sourceFkHostTableName,
        selfKeyName: sourceSelfKeyName,
        foreignKeyName: sourceForeignKeyName,
      } = sourceOptions as ILinkFieldOptions;
      const targetField = linkFieldInstances.find((f) => f.id === fieldIdMap[sourceField.id])!;
      const { options: targetOptions } = targetField;
      const {
        fkHostTableName: targetFkHostTableName,
        selfKeyName: targetSelfKeyName,
        foreignKeyName: targetForeignKeyName,
      } = targetOptions as ILinkFieldOptions;
      if (sourceFkHostTableName.includes('junction_')) {
        junctionDbTableNameMap[sourceFkHostTableName] = {
          sourceSelfKeyName,
          sourceForeignKeyName,
          targetSelfKeyName,
          targetForeignKeyName,
          targetFkHostTableName,
        };
      }
    }

    const parser = unzipper.Parse();
    csvStream.pipe(parser);

    const processedFiles = new Set<string>();

    return new Promise<{ success: boolean }>((resolve, reject) => {
      parser.on('entry', (entry) => {
        const filePath = entry.path;

        if (processedFiles.has(filePath)) {
          entry.autodrain();
          return;
        }
        processedFiles.add(filePath);

        if (
          filePath.startsWith('tables/') &&
          entry.type !== 'Directory' &&
          filePath.includes('junction_')
        ) {
          const name = filePath.replace('tables/', '').split('.');
          name.pop();
          const junctionTableName = name.join('.');
          const junctionInfo = junctionDbTableNameMap[junctionTableName];

          const {
            sourceForeignKeyName,
            targetForeignKeyName,
            sourceSelfKeyName,
            targetSelfKeyName,
            targetFkHostTableName,
          } = junctionInfo;

          const batchProcessor = new JunctionBatchProcessor(
            chunkSize,
            this.handleJunctionChunk.bind(this),
            targetFkHostTableName
          );

          entry
            .pipe(
              csvParser.default({
                // strict: true,
                mapValues: ({ value }) => {
                  return value;
                },
                mapHeaders: ({ header }) => {
                  return header
                    .replaceAll(sourceForeignKeyName, targetForeignKeyName)
                    .replaceAll(sourceSelfKeyName, targetSelfKeyName);
                },
              })
            )
            .pipe(batchProcessor)
            .on('error', (error: Error) => {
              this.logger.error(`process csv import error: ${error.message}`, error.stack);
              reject(error);
            })
            .on('end', () => {
              this.logger.log(`csv ${junctionTableName} finished`);
              resolve({ success: true });
            });
        } else {
          entry.autodrain();
        }
      });

      parser.on('close', () => {
        this.logger.log('import csv junction completed');
        resolve({ success: true });
      });

      parser.on('error', (error) => {
        this.logger.error(`import csv junction parser error: ${error.message}`, error.stack);
        reject(error);
      });
    });
  }

  private async handleJunctionChunk(
    results: Record<string, unknown>[],
    targetFkHostTableName: string
  ) {
    const sql = this.knex.table(targetFkHostTableName).insert(results).toQuery();
    try {
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        this.logger.error(
          `exc junction import task known error: (${error.code}): ${error.message}`,
          error.stack
        );
      } else if (error instanceof PrismaClientUnknownRequestError) {
        this.logger.error(`exc junction import task unknown error: ${error.message}`, error.stack);
      } else {
        this.logger.error(
          `exc junction import task error: ${(error as Error)?.message}`,
          (error as Error)?.stack
        );
      }
    }
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    const { fieldIdMap, path, structure } = job.data;
    await this.importJunctionChunk(path, fieldIdMap, structure);
  }
}

class BatchProcessor extends Transform {
  private buffer: Record<string, unknown>[] = [];
  private totalProcessed = 0;
  public static BATCH_SIZE = 1000;

  constructor(
    private readonly processBatchFn: (
      batch: Record<string, unknown>[],
      config: {
        tableId: string;
        userId: string;
        fieldIdMap: Record<string, string>;
        viewIdMap: Record<string, string>;
        attachmentsFields: { dbFieldName: string; id: string }[];
      }
    ) => Promise<void>,
    private config: {
      tableId: string;
      userId: string;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
      attachmentsFields: { dbFieldName: string; id: string }[];
    }
  ) {
    super({ objectMode: true });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  async _transform(
    chunk: Record<string, unknown>,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    this.buffer.push(chunk);
    this.totalProcessed++;

    if (this.buffer.length >= BatchProcessor.BATCH_SIZE) {
      const currentBatch = [...this.buffer];
      this.buffer = [];

      try {
        await this.processBatchFn(currentBatch, this.config);
        this.emit('progress', { processed: this.totalProcessed });
        callback();
      } catch (err: unknown) {
        callback(err as Error);
      }
    } else {
      callback();
    }
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  async _flush(callback: TransformCallback) {
    if (this.buffer.length > 0) {
      try {
        await this.processBatchFn(this.buffer, this.config);
        this.emit('progress', { processed: this.totalProcessed });
        callback();
      } catch (err: unknown) {
        callback(err as Error);
      }
    } else {
      callback();
    }
  }
}

class JunctionBatchProcessor extends Transform {
  private buffer: Record<string, unknown>[] = [];
  private totalProcessed = 0;

  constructor(
    private readonly batchSize: number,
    private readonly processBatch: (
      batch: Record<string, unknown>[],
      targetFkHostTableName: string
    ) => Promise<void>,
    private targetFkHostTableName: string
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

      this.processBatch(currentBatch, this.targetFkHostTableName)
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
      this.processBatch(this.buffer, this.targetFkHostTableName)
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

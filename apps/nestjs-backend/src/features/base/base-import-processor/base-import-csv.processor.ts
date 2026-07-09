/* eslint-disable @typescript-eslint/naming-convention */
import { pipeline } from 'stream/promises';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue, ILinkFieldOptions } from '@teable/core';
import { DbFieldType, FieldType, generateAttachmentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, ImportBaseRo } from '@teable/openapi';
import { CreateRecordAction, UploadType } from '@teable/openapi';
import { Queue, Job } from 'bullmq';
import * as csvParser from 'csv-parser';
import { ClsService } from 'nestjs-cls';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { IClsStore } from '../../../types/cls';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { PersistedComputedBackfillService } from '../../record/computed/services/persisted-computed-backfill.service';
import { BatchProcessor } from '../BatchProcessor.class';
import { EXCLUDE_SYSTEM_FIELDS } from '../constant';
import { BaseImportJunctionCsvQueueProcessor } from './base-import-junction.processor';

type IDataPrismaExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  $tx?: <T>(fn: (prisma: IDataPrismaExecutor) => Promise<T>) => Promise<T>;
  $transaction?: <T>(fn: (prisma: IDataPrismaExecutor) => Promise<T>) => Promise<T>;
};

interface IBaseImportCsvJob {
  path: string;
  userId: string;
  baseId: string;
  origin?: {
    ip: string;
    byApi: boolean;
    userAgent: string;
    referer: string;
  };
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  fkMap: Record<string, string>;
  structure: IBaseJson;
  importBaseRo: ImportBaseRo;
  logId: string;
}

export const BASE_IMPORT_CSV_QUEUE = 'base-import-csv-queue';

@Injectable()
@Processor(BASE_IMPORT_CSV_QUEUE)
export class BaseImportCsvQueueProcessor extends WorkerHost {
  private logger = new Logger(BaseImportCsvQueueProcessor.name);

  private processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseImportJunctionCsvQueueProcessor: BaseImportJunctionCsvQueueProcessor,
    private readonly persistedComputedBackfillService: PersistedComputedBackfillService,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_CSV_QUEUE) public readonly queue: Queue<IBaseImportCsvJob>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope
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
      this.logger.log('import csv parser job completed');
    } catch (error) {
      this.logger.error(
        `Process base import csv failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
  }

  private async handleBaseImportCsv(job: Job<IBaseImportCsvJob>): Promise<void> {
    // BullMQ workers run without an ambient CLS context. Establish one ourselves so
    // (a) audit.withOperation can install operation attribution, and (b) audit listeners that read
    // `user.id` / `origin` from CLS see the correct values.
    await this.cls.run(async () => {
      this.cls.set('user.id', job.data.userId);
      if (job.data.origin) {
        this.cls.set('origin', job.data.origin);
      }
      await this.audit.withOperation(
        {
          rootAction: CreateRecordAction.BaseImport,
          resourceId: job.data.baseId,
          // Reuse job.data.logId as operationId so every chunk-row shares an id with the
          // HTTP-side rows that fired during the parent base-import request.
          operationId: job.data.logId,
        },
        () => this.handleBaseImportCsvInScope(job)
      );
    });
  }

  private async handleBaseImportCsvInScope(job: Job<IBaseImportCsvJob>): Promise<void> {
    const { path, userId, baseId, tableIdMap, fieldIdMap, viewIdMap, structure, fkMap } = job.data;
    const csvStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const parser = unzipper.Parse();
    csvStream.pipe(parser);
    let totalRecordsCount = 0;

    await new Promise<void>((resolve, reject) => {
      const entryImports: Promise<void>[] = [];
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

          const buttonFields =
            table?.fields
              ?.filter(({ type }) => type === FieldType.Button)
              .map(({ dbFieldName, id }) => ({
                dbFieldName,
                id,
              })) || [];

          const computedFields =
            table?.fields
              ?.filter(({ type }) =>
                [
                  FieldType.Formula,
                  FieldType.Rollup,
                  FieldType.ConditionalRollup,
                  FieldType.CreatedTime,
                  FieldType.LastModifiedTime,
                  FieldType.CreatedBy,
                  FieldType.LastModifiedBy,
                  FieldType.AutoNumber,
                ].includes(type)
              )
              .map(({ dbFieldName, id }) => ({
                dbFieldName,
                id,
              })) || [];

          const buttonDbFieldNames = buttonFields.map(({ dbFieldName }) => dbFieldName);
          const computedDbFieldNames = computedFields.map(({ dbFieldName }) => dbFieldName);
          const excludeDbFieldNames = [
            ...EXCLUDE_SYSTEM_FIELDS,
            ...buttonDbFieldNames,
            ...computedDbFieldNames,
          ];

          const notNullFieldMap = new Map<
            string,
            { dbFieldType: string; isMultipleCellValue: boolean }
          >();
          table?.fields?.forEach(({ dbFieldName, notNull, dbFieldType, isMultipleCellValue }) => {
            if (notNull) {
              notNullFieldMap.set(dbFieldName, {
                dbFieldType,
                isMultipleCellValue: Boolean(isMultipleCellValue),
              });
            }
          });

          const batchProcessor = new BatchProcessor<Record<string, unknown>>(async (chunk) => {
            totalRecordsCount += chunk.length;
            // handleChunk emits one atomic record-create row per chunk under the
            // active BaseImport operation.
            await this.handleChunk(
              chunk,
              {
                baseId,
                tableId: tableIdMap[tableId],
                userId,
                fieldIdMap,
                viewIdMap,
                fkMap,
                attachmentsFields,
                notNullFieldMap,
              },
              excludeDbFieldNames
            );
          });

          const entryImport = pipeline(
            entry,
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
                if (header.startsWith('__fk_')) {
                  return fieldIdMap[header.slice(5)]
                    ? `__fk_${fieldIdMap[header.slice(5)]}`
                    : fkMap[header] || header;
                }

                return header;
              },
            }),
            batchProcessor
          ).then(() => {
            this.logger.log(`csv ${tableId} finished, total records so far: ${totalRecordsCount}`);
          });

          void entryImport.catch((error: Error) => {
            this.logger.error(`import csv import error: ${error.message}`, error.stack);
            reject(error);
          });
          entryImports.push(entryImport);
        } else {
          entry.autodrain();
        }
      });

      parser.on('close', () => {
        Promise.all(entryImports)
          .then(() => {
            this.logger.log(`import csv parser completed, total records: ${totalRecordsCount}`);
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      });

      parser.on('error', (error) => {
        this.logger.error(`ZIP parser error: ${error.message}`, error.stack);
        reject(error);
      });
    });

    if (!this.hasJunctionImports(structure)) {
      await this.persistedComputedBackfillService.recomputeForTables(Object.values(tableIdMap));
    }
  }

  private hasJunctionImports(structure: IBaseJson) {
    return structure.tables
      .flatMap(({ fields }) => fields)
      .filter((field) => field.type === FieldType.Link && !field.isLookup)
      .some((field) =>
        ((field.options as ILinkFieldOptions | undefined)?.fkHostTableName || '').includes(
          'junction_'
        )
      );
  }

  private async dataTransaction<T>(
    dataPrisma: IDataPrismaScopedClient,
    fn: (prisma: IDataPrismaExecutor) => Promise<T>
  ) {
    if (dataPrisma.$tx) {
      return await dataPrisma.$tx(fn);
    }

    if (dataPrisma.$transaction) {
      return await dataPrisma.$transaction(fn);
    }

    return await fn(dataPrisma);
  }

  // Raw SQL chunk insert (no v2 events). Active BaseImport operation is set by
  // `handleBaseImportCsv` above; the `@Audit` atomic emit mode writes one audit row per
  // chunk with atomic record-create action and rootAction=BaseImport.
  @Audit({
    action: Events.TABLE_RECORD_CREATE,
    emit: (_result, chunk: Record<string, unknown>[]) => ({ recordCount: chunk.length }),
  })
  private async handleChunk(
    results: Record<string, unknown>[],
    config: {
      baseId: string;
      tableId: string;
      userId: string;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
      fkMap: Record<string, string>;
      attachmentsFields: { dbFieldName: string; id: string }[];
      notNullFieldMap: Map<string, { dbFieldType: string; isMultipleCellValue: boolean }>;
    },
    excludeDbFieldNames: string[]
  ) {
    const { baseId, tableId, userId, fieldIdMap, attachmentsFields, fkMap, notNullFieldMap } =
      config;
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: {
        dbTableName: true,
      },
    });

    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      dbTableName: string;
    }[];
    const attachmentsTableData = [] as {
      attachmentId: string;
      name: string;
      token: string;
      tableId: string;
      recordId: string;
      fieldId: string;
    }[];

    const dataPrisma = (await this.dataDbClientManager.dataPrismaForBase(
      baseId
    )) as IDataPrismaScopedClient;
    const dataKnex = await this.dataDbClientManager.dataKnexForBase(baseId);

    await this.dataTransaction(dataPrisma, async (prisma) => {
      // delete foreign keys if(exist) then duplicate table data
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(dbTableName);
      const foreignKeysInfo = await prisma.$queryRawUnsafe<
        {
          constraint_name: string;
          column_name: string;
          referenced_table_schema: string;
          referenced_table_name: string;
          referenced_column_name: string;
        }[]
      >(foreignKeysInfoSql);
      const newForeignKeyInfos = foreignKeysInfo.map((info) => ({
        ...info,
        dbTableName,
      }));
      allForeignKeyInfos.push(...newForeignKeyInfos);

      for (const { constraint_name, column_name, dbTableName } of allForeignKeyInfos) {
        const dropForeignKeyQuery = dataKnex.schema
          .alterTable(dbTableName, (table) => {
            table.dropForeign(column_name, constraint_name);
          })
          .toQuery();

        await prisma.$executeRawUnsafe(dropForeignKeyQuery);
      }

      const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
      const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);

      const newResult = [...results].map((res) => {
        const newRes = { ...res };

        excludeDbFieldNames.forEach((header) => {
          delete newRes[header];
        });

        return newRes;
      });

      const attachmentsDbFieldNames = attachmentsFields.map(({ dbFieldName }) => dbFieldName);

      const fkColumns = columnInfo
        .filter(({ name }) => name.startsWith('__fk_'))
        .map(({ name }) => {
          return fieldIdMap[name.slice(5)]
            ? `__fk_${fieldIdMap[name.slice(5)]}`
            : fkMap[name] || name;
        });

      // Authoritative set of columns that actually exist on the freshly-created table.
      // The .tea CSV is dumped from the source data table's physical columns, which can
      // include "ghost" columns left behind by deleted/renamed fields. Those have no field
      // in the exported structure, so the new table lacks them; inserting them raw aborts the
      // whole table transaction (42703 -> 25P02) and drops every record. Mirror the v2 import,
      // which only restores columns present in the field metadata.
      const realColumns = new Set(columnInfo.map(({ name }) => name));

      const recordsToInsert = newResult.map((result) => {
        const res = { ...result };
        Object.entries(res).forEach(([key, value]) => {
          // drop ghost business columns absent from the target table (system / __fk_ / __row_
          // columns are left to the dedicated handling below and the lacking-column ALTER step)
          if (!key.startsWith('__') && !realColumns.has(key)) {
            delete res[key];
            return;
          }

          if (res[key] === '') {
            const notNullInfo = notNullFieldMap.get(key);
            if (notNullInfo) {
              res[key] = this.getNotNullDefault(
                notNullInfo.dbFieldType,
                notNullInfo.isMultipleCellValue
              );
            } else {
              res[key] = null;
            }
          }

          // filter unnecessary columns
          if (key.startsWith('__fk_') && !fkColumns.includes(key)) {
            delete res[key];
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
          const sql = dataKnex.schema
            .alterTable(dbTableName, (table) => {
              table.double(name);
            })
            .toQuery();
          await prisma.$executeRawUnsafe(sql);
        }
      }

      const sql = dataKnex.table(dbTableName).insert(recordsToInsert).toQuery();
      await prisma.$executeRawUnsafe(sql);
    });

    // restore foreign keys with NOT VALID
    for (const {
      constraint_name,
      column_name,
      dbTableName,
      referenced_table_schema: referencedTableSchema,
      referenced_table_name: referencedTableName,
      referenced_column_name: referencedColumnName,
    } of allForeignKeyInfos) {
      const [schema, tableName] = dbTableName.split('.');
      const addForeignKeyQuery = dataKnex
        .raw(
          'ALTER TABLE ??.?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ??.??(??) NOT VALID',
          [
            schema,
            tableName,
            constraint_name,
            column_name,
            referencedTableSchema,
            referencedTableName,
            referencedColumnName,
          ]
        )
        .toQuery();
      await dataPrisma.$executeRawUnsafe(addForeignKeyQuery);
    }

    await this.updateAttachmentTable(userId, attachmentsTableData);
  }

  private getNotNullDefault(dbFieldType: string, isMultipleCellValue: boolean): unknown {
    switch (dbFieldType) {
      case DbFieldType.Integer:
      case DbFieldType.Real:
        return 0;
      case DbFieldType.Boolean:
        return false;
      case DbFieldType.DateTime:
        return new Date(0).toISOString();
      case DbFieldType.Json:
        return isMultipleCellValue ? '[]' : '{}';
      case DbFieldType.Text:
      default:
        return 'null';
    }
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

  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    const { tableIdMap, fieldIdMap, path, structure, userId } = job.data;
    if (!this.hasJunctionImports(structure)) {
      return;
    }

    await this.baseImportJunctionCsvQueueProcessor.queue.add(
      'import_base_junction_csv',
      {
        baseId: job.data.baseId,
        tableIdMap,
        fieldIdMap,
        path,
        structure,
      },
      {
        jobId: `import_base_junction_csv_${path}_${userId}`,
      }
    );
  }
}

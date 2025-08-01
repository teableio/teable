/* eslint-disable @typescript-eslint/naming-convention */
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue } from '@teable/core';
import { FieldType, generateAttachmentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import { Queue, Job } from 'bullmq';
import * as csvParser from 'csv-parser';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { BatchProcessor } from '../BatchProcessor.class';
import { EXCLUDE_SYSTEM_FIELDS } from '../constant';
import { BaseImportJunctionCsvQueueProcessor } from './base-import-junction.processor';
interface IBaseImportCsvJob {
  path: string;
  userId: string;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  fkMap: Record<string, string>;
  structure: IBaseJson;
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
      this.logger.log('import csv parser job completed');
    } catch (error) {
      this.logger.error(
        `Process base import csv failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
  }

  private async handleBaseImportCsv(job: Job<IBaseImportCsvJob>) {
    const { path, userId, tableIdMap, fieldIdMap, viewIdMap, structure, fkMap } = job.data;
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

          const buttonFields =
            table?.fields
              ?.filter(({ type }) => type === FieldType.Button)
              .map(({ dbFieldName, id }) => ({
                dbFieldName,
                id,
              })) || [];
          const buttonDbFieldNames = buttonFields.map(({ dbFieldName }) => dbFieldName);

          const excludeDbFieldNames = [...EXCLUDE_SYSTEM_FIELDS, ...buttonDbFieldNames];
          const batchProcessor = new BatchProcessor<Record<string, unknown>>((chunk) =>
            this.handleChunk(
              chunk,
              {
                tableId: tableIdMap[tableId],
                userId,
                fieldIdMap,
                viewIdMap,
                fkMap,
                attachmentsFields,
              },
              excludeDbFieldNames
            )
          );

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
                  if (header.startsWith('__fk_')) {
                    return fieldIdMap[header.slice(5)]
                      ? `__fk_${fieldIdMap[header.slice(5)]}`
                      : fkMap[header] || header;
                  }

                  return header;
                },
              })
            )
            .pipe(batchProcessor)
            .on('error', (error: Error) => {
              this.logger.error(`import csv import error: ${error.message}`, error.stack);
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
        this.logger.log('import csv parser completed');
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
      fkMap: Record<string, string>;
      attachmentsFields: { dbFieldName: string; id: string }[];
    },
    excludeDbFieldNames: string[]
  ) {
    const { tableId, userId, fieldIdMap, attachmentsFields, fkMap } = config;
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

    await this.prismaService.$tx(async (prisma) => {
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
        const dropForeignKeyQuery = this.knex.schema
          .alterTable(dbTableName, (table) => {
            table.dropForeign(column_name, constraint_name);
          })
          .toQuery();

        await prisma.$executeRawUnsafe(dropForeignKeyQuery);
      }

      const columnInfoQuery = this.dbProvider.columnInfo(dbTableName);
      const columnInfo = await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery);

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

      const recordsToInsert = newResult.map((result) => {
        const res = { ...result };
        Object.entries(res).forEach(([key, value]) => {
          if (res[key] === '') {
            res[key] = null;
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
          const sql = this.knex.schema
            .alterTable(dbTableName, (table) => {
              table.double(name);
            })
            .toQuery();
          await prisma.$executeRawUnsafe(sql);
        }
      }

      const sql = this.knex.table(dbTableName).insert(recordsToInsert).toQuery();
      await prisma.$executeRawUnsafe(sql);
      await this.updateAttachmentTable(userId, attachmentsTableData);
    });

    // add foreign keys, do not in one transaction with deleting foreign keys
    for (const {
      constraint_name,
      column_name,
      dbTableName,
      referenced_table_schema: referencedTableSchema,
      referenced_table_name: referencedTableName,
      referenced_column_name: referencedColumnName,
    } of allForeignKeyInfos) {
      const addForeignKeyQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table
            .foreign(column_name, constraint_name)
            .references(referencedColumnName)
            .inTable(`${referencedTableSchema}.${referencedTableName}`);
        })
        .toQuery();
      await this.prismaService.$executeRawUnsafe(addForeignKeyQuery);
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
    const { fieldIdMap, path, structure, userId } = job.data;
    await this.baseImportJunctionCsvQueueProcessor.queue.add(
      'import_base_junction_csv',
      {
        fieldIdMap,
        path,
        structure,
      },
      {
        jobId: `import_base_junction_csv_${path}_${userId}`,
        delay: 2000,
      }
    );
  }
}

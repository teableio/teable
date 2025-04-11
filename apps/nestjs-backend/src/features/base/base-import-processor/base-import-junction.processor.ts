/* eslint-disable @typescript-eslint/naming-convention */
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import * as csvParser from 'csv-parser';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { BatchProcessor } from '../BatchProcessor.class';

interface IBaseImportJunctionCsvJob {
  path: string;
  fieldIdMap: Record<string, string>;
  structure: IBaseJson;
}

export const BASE_IMPORT_JUNCTION_CSV_QUEUE = 'base-import-junction-csv-queue';

@Injectable()
@Processor(BASE_IMPORT_JUNCTION_CSV_QUEUE)
export class BaseImportJunctionCsvQueueProcessor extends WorkerHost {
  private logger = new Logger(BaseImportJunctionCsvQueueProcessor.name);
  private processedJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @InjectQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE)
    public readonly queue: Queue<IBaseImportJunctionCsvJob>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {
    super();
  }

  public async process(job: Job<IBaseImportJunctionCsvJob>) {
    const jobId = String(job.id);
    if (this.processedJobs.has(jobId)) {
      this.logger.log(`Job ${jobId} already processed, skipping`);
      return;
    }

    this.processedJobs.add(jobId);

    const { path, fieldIdMap, structure } = job.data;

    try {
      await this.importJunctionChunk(path, fieldIdMap, structure);
    } catch (error) {
      this.logger.error(
        `Process base import junction csv failed: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
    }
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

          const batchProcessor = new BatchProcessor<Record<string, unknown>>((chunk) =>
            this.handleJunctionChunk(chunk, targetFkHostTableName)
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
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(targetFkHostTableName);
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
        dbTableName: targetFkHostTableName,
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

      const sql = this.knex.table(targetFkHostTableName).insert(results).toQuery();
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (error) {
        if (error instanceof PrismaClientKnownRequestError) {
          this.logger.error(
            `exc junction import task known error: (${error.code}): ${error.message}`,
            error.stack
          );
        } else if (error instanceof PrismaClientUnknownRequestError) {
          this.logger.error(
            `exc junction import task unknown error: ${error.message}`,
            error.stack
          );
        } else {
          this.logger.error(
            `exc junction import task error: ${(error as Error)?.message}`,
            (error as Error)?.stack
          );
        }
      }

      // add foreign keys
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
        await prisma.$executeRawUnsafe(addForeignKeyQuery);
      }
    });
  }
}

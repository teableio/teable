/* eslint-disable @typescript-eslint/naming-convention */
import { pipeline } from 'node:stream/promises';
import { InjectQueue, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue, ILinkFieldOptions } from '@teable/core';
import { DbFieldType, FieldType, generateAttachmentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseJson, ImportBaseRo } from '@teable/openapi';
import { CreateRecordAction, UploadType } from '@teable/openapi';
import type { IUserLookupService, UserLookupRecord } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import { Queue, Job } from 'bullmq';
import * as csvParser from 'csv-parser';
import { ClsService } from 'nestjs-cls';
import * as unzipper from 'unzipper';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { postgresAddForeignKeyNotValidSql } from '../../../db-provider/postgres-fk-delete-action';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { IClsStore } from '../../../types/cls';
import { Processor } from '../../../utils/queue-processor';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { PersistedComputedBackfillService } from '../../record/computed/services/persisted-computed-backfill.service';
import { V2ContainerService } from '../../v2/v2-container.service';
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

const SAFE_BASE_IMPORT_CSV_FAILURES: Record<string, true> = {
  'validation.field.user_not_found': true,
  'validation.field.invalid_user_format': true,
  'Failed to validate imported user references': true,
};

@Injectable()
@Processor(BASE_IMPORT_CSV_QUEUE)
export class BaseImportCsvQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(BaseImportCsvQueueProcessor.name);

  private readonly processedJobs = new Set<string>();

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
    private readonly v2ContainerService: V2ContainerService,
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
      this.processedJobs.delete(jobId);
      throw this.toQueueFailure(error);
    }
  }

  private toQueueFailure(error: unknown): Error {
    const message = error instanceof Error ? error.message : '';
    return new Error(
      SAFE_BASE_IMPORT_CSV_FAILURES[message] === true
        ? message
        : 'Base import CSV processing failed'
    );
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
      const activeChunkImports = new Set<Promise<void>>();
      const activeEntries = new Set<unzipper.Entry>();
      let acceptingEntries = true;
      let firstError: Error | undefined;
      let finishing = false;

      const finish = async (parserError?: Error) => {
        if (finishing) return;
        finishing = true;
        acceptingEntries = false;
        firstError ??= parserError;
        await Promise.allSettled(entryImports);
        await Promise.allSettled([...activeChunkImports]);
        if (firstError) {
          reject(firstError);
          return;
        }
        this.logger.log(`import csv parser completed, total records: ${totalRecordsCount}`);
        resolve();
      };
      const stop = (error: Error) => {
        if (firstError) return;
        firstError = error;
        acceptingEntries = false;
        csvStream.unpipe(parser);
        for (const activeEntry of activeEntries) activeEntry.destroy(error);
        parser.destroy();
        csvStream.destroy();
        void finish();
      };
      parser.on('entry', (entry) => {
        if (!acceptingEntries) {
          entry.autodrain();
          return;
        }
        const filePath = entry.path;
        const isTable = filePath.startsWith('tables/') && entry.type !== 'Directory';
        const isJunction = filePath.includes('junction_');

        if (isTable && !isJunction) {
          activeEntries.add(entry);
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
            if (firstError) throw firstError;
            totalRecordsCount += chunk.length;
            // Concurrent ZIP entries must not share CLS transaction slots. DataPrisma.$tx
            // reuses an existing dataTx.client; sharing it lets another entry commit that
            // transaction while this chunk is still inserting. Keep attribution inherited,
            // but each chunk owns its metadata/data transaction lifecycle.
            const chunkImport = this.cls.runWith({ ...this.cls.get(), tx: {}, dataTx: {} }, () =>
              this.handleChunk(
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
              )
            );
            activeChunkImports.add(chunkImport);
            try {
              await chunkImport;
            } catch (error) {
              stop(error as Error);
              throw error;
            } finally {
              activeChunkImports.delete(chunkImport);
            }
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

          void entryImport.then(
            () => activeEntries.delete(entry),
            (error: Error) => {
              activeEntries.delete(entry);
              this.logger.error(`import csv import error: ${error.message}`, error.stack);
              stop(error);
            }
          );
          entryImports.push(entryImport);
        } else {
          entry.autodrain();
        }
      });

      parser.on('close', () => {
        void finish();
      });

      parser.on('error', (error) => {
        this.logger.error(`ZIP parser error: ${error.message}`, error.stack);
        stop(error);
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
    const { dbTableName, fields: targetFields = [] } =
      await this.prismaService.tableMeta.findUniqueOrThrow({
        where: { id: tableId },
        select: {
          dbTableName: true,
          fields: {
            where: { deletedTime: null },
            select: {
              dbFieldName: true,
              type: true,
              isMultipleCellValue: true,
              isComputed: true,
              isLookup: true,
            },
          },
        },
      });

    // The archive structure is caller-controlled. Classify writable and computed columns from
    // the freshly-created destination table instead, then validate each bounded CSV chunk against
    // that table's current collaborator scope.
    const targetComputedDbFieldNames = targetFields
      .filter((field) => field.isComputed || field.isLookup)
      .map((field) => field.dbFieldName);
    const targetUserFields = targetFields
      .filter((field) => field.type === FieldType.User && !field.isComputed && !field.isLookup)
      .map(({ dbFieldName, isMultipleCellValue }) => ({
        dbFieldName,
        isMultipleCellValue: Boolean(isMultipleCellValue),
      }));
    const authorizedResults = targetUserFields.length
      ? await this.authorizeImportedUserValues(results, tableId, baseId, targetUserFields)
      : results;
    const authoritativeExcludeDbFieldNames = new Set([
      ...excludeDbFieldNames,
      ...targetComputedDbFieldNames,
    ]);

    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      delete_rule: string;
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
          delete_rule: string;
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

      const newResult = authorizedResults.map((res) => {
        const newRes = { ...res };

        authoritativeExcludeDbFieldNames.forEach((header) => {
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
      delete_rule: deleteRule,
    } of allForeignKeyInfos) {
      const [schema, tableName] = dbTableName.split('.');
      const addForeignKeyQuery = postgresAddForeignKeyNotValidSql(dataKnex, {
        schema,
        tableName,
        constraintName: constraint_name,
        columnName: column_name,
        referencedTableSchema,
        referencedTableName,
        referencedColumnName,
        deleteRule,
      });
      await dataPrisma.$executeRawUnsafe(addForeignKeyQuery);
    }

    await this.updateAttachmentTable(userId, attachmentsTableData);
  }

  private async authorizeImportedUserValues(
    records: Record<string, unknown>[],
    tableId: string,
    baseId: string,
    userFields: ReadonlyArray<{ dbFieldName: string; isMultipleCellValue: boolean }>
  ): Promise<Record<string, unknown>[]> {
    const scopedIds = new Set<string>();
    const identityPairs: Array<{ id: string; email: string }> = [];
    const parsedCells = new Map<
      Record<string, unknown>,
      Map<string, ReadonlyArray<{ id: string; email?: string }> | null>
    >();

    for (const record of records) {
      const cells = new Map<string, ReadonlyArray<{ id: string; email?: string }> | null>();
      parsedCells.set(record, cells);
      for (const field of userFields) {
        const references = this.parseImportedUserReferences(
          record[field.dbFieldName],
          field.isMultipleCellValue
        );
        cells.set(field.dbFieldName, references);
        for (const reference of references ?? []) {
          if (reference.email !== undefined) {
            identityPairs.push({ id: reference.id, email: reference.email });
          } else {
            scopedIds.add(reference.id);
          }
        }
      }
    }

    const { scopedUsersById, pairedUsersById } = await this.lookupImportedUsers(
      tableId,
      baseId,
      scopedIds,
      identityPairs
    );

    return records.map((record) => {
      const authorized = { ...record };
      for (const field of userFields) {
        const references = parsedCells.get(record)?.get(field.dbFieldName);
        if (references == null) {
          authorized[field.dbFieldName] = null;
          continue;
        }
        const canonical = references.map((reference) =>
          this.toCanonicalUser(
            (reference.email === undefined ? scopedUsersById : pairedUsersById).get(reference.id)!
          )
        );
        authorized[field.dbFieldName] = JSON.stringify(
          field.isMultipleCellValue ? canonical : canonical[0]
        );
      }
      return authorized;
    });
  }

  private async lookupImportedUsers(
    tableId: string,
    baseId: string,
    scopedIds: ReadonlySet<string>,
    identityPairs: ReadonlyArray<{ id: string; email: string }>
  ) {
    if (scopedIds.size === 0 && identityPairs.length === 0) {
      return {
        scopedUsersById: new Map<string, UserLookupRecord>(),
        pairedUsersById: new Map<string, UserLookupRecord>(),
      };
    }
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const userLookupService = container.resolve<IUserLookupService>(v2CoreTokens.userLookupService);
    const scopedUsersById = new Map<string, UserLookupRecord>();
    if (scopedIds.size) {
      const result = await userLookupService.listTableUsersByIdentifiers(tableId, [...scopedIds]);
      if (result.isErr()) {
        throw new Error('Failed to validate imported user references');
      }
      for (const user of result.value) scopedUsersById.set(user.id, user);
    }
    const pairedUsersById = new Map<string, UserLookupRecord>();
    if (identityPairs.length) {
      const result = await userLookupService.listUsersByIdentityPairs(identityPairs);
      if (result.isErr()) {
        throw new Error('Failed to validate imported user references');
      }
      for (const user of result.value) pairedUsersById.set(user.id, user);
    }
    if (
      [...scopedIds].some((id) => !scopedUsersById.has(id)) ||
      identityPairs.some((pair) => pairedUsersById.get(pair.id)?.email !== pair.email)
    ) {
      throw new Error('validation.field.user_not_found');
    }
    return { scopedUsersById, pairedUsersById };
  }

  private parseImportedUserReferences(
    rawValue: unknown,
    isMultiple: boolean
  ): ReadonlyArray<{ id: string; email?: string }> | null {
    if (rawValue == null || rawValue === '') return null;

    let value = rawValue;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error('validation.field.invalid_user_format');
      }
    }
    if (value == null) return null;

    const values = isMultiple ? value : [value];
    if (!Array.isArray(values) || (!isMultiple && Array.isArray(value))) {
      throw new Error('validation.field.invalid_user_format');
    }
    return values.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('validation.field.invalid_user_format');
      }
      const id = Reflect.get(item, 'id');
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('validation.field.invalid_user_format');
      }
      const email = Reflect.get(item, 'email');
      if (email !== undefined && (typeof email !== 'string' || email.length === 0)) {
        throw new Error('validation.field.invalid_user_format');
      }
      return email === undefined ? { id } : { id, email: email as string };
    });
  }

  private toCanonicalUser(user: UserLookupRecord) {
    return {
      id: user.id,
      title: user.name,
      ...(user.email ? { email: user.email } : {}),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    };
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

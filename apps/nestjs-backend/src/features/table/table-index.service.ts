/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import {
  TableIndex,
  tableQueryIndexPolicyVoSchema,
  tableSearchIndexPolicyVoSchema,
} from '@teable/openapi';
import type {
  IGetAbnormalVo,
  ITableIndexType,
  ITableQueryIndexPolicyRo,
  ITableQueryIndexPolicyVo,
  ITableQueryIndexSpec,
  ITableSearchIndexPolicyRo,
  ITableSearchIndexPolicyVo,
  ITableSearchVectorStatusVo,
  IToggleIndexRo,
} from '@teable/openapi';
import type { TableSearchVectorStatusReader } from '@teable/v2-table-query-ops';
import { v2TableOpsTokens } from '@teable/v2-table-query-ops';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IDataDbRoutingOptions } from '../../global/data-db-client-manager.service';
import { DatabaseRouter } from '../../global/database-router.service';
import type { IClsStore } from '../../types/cls';
import { CanaryService } from '../canary/canary.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';

const promiseWithResolvers = Promise as unknown as {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

export const selectSearchIndexFields = <T extends { id: string }>(
  fields: T[],
  policy: ITableSearchIndexPolicyVo
): T[] => {
  if (policy.searchScope === 'all_fields') {
    return fields;
  }
  const selected = new Set(policy.fields);
  return fields.filter((field) => selected.has(field.id));
};

@Injectable()
export class TableIndexService {
  private readonly logger = new Logger(TableIndexService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @Inject(CanaryService)
    @Optional()
    private readonly canaryService?: CanaryService,
    @Inject(V2ContainerService)
    @Optional()
    private readonly v2ContainerService?: V2ContainerService,
    @Inject(V2ExecutionContextFactory)
    @Optional()
    private readonly v2ExecutionContextFactory?: V2ExecutionContextFactory
  ) {}

  async getSearchVectorStatus(tableId: string): Promise<ITableSearchVectorStatusVo> {
    const disabled: ITableSearchVectorStatusVo = {
      tableId,
      state: 'disabled',
      configured: false,
      active: false,
      coveredFieldCount: 0,
    };
    if (!this.v2ContainerService || !this.v2ExecutionContextFactory) return disabled;

    const container = await this.v2ContainerService.getContainerForTable(tableId);
    if (!container.isRegistered(v2TableOpsTokens.searchVectorStatusReader)) return disabled;

    const context = await this.v2ExecutionContextFactory.createContext(container);
    const reader = container.resolve<TableSearchVectorStatusReader>(
      v2TableOpsTokens.searchVectorStatusReader
    );
    const result = await reader.read(context, tableId);
    if (result.isErr()) {
      this.logger.error(result.error.message, result.error);
      throw new CustomHttpException(
        'Failed to read table search vector status',
        HttpErrorCode.INTERNAL_SERVER_ERROR
      );
    }
    return {
      ...result.value,
      active:
        result.value.state === 'ready' &&
        this.v2ContainerService.isTableQuerySearchVectorRuntimeEnabled() &&
        (await this.isV2RecordReadEnabled(tableId)),
    };
  }

  private async isV2RecordReadEnabled(tableId: string): Promise<boolean> {
    if (!this.canaryService) return false;
    const prisma = this.prismaService.txClient();
    const table = await prisma.tableMeta.findUnique({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });
    if (!table) return false;

    const base = await prisma.base.findUnique({
      where: { id: table.baseId, deletedTime: null },
      select: { spaceId: true, v2Enabled: true },
    });
    if (!base) return false;

    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(base, 'getRecords');
    return decision.useV2;
  }
  private async getSearchIndexCandidateFields(tableId: string): Promise<IFieldInstance[]> {
    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });
    return fieldsRaw
      .filter(({ type }) => type !== FieldType.Button)
      .map((field) => createFieldInstanceByRaw(field))
      .map((field) => ({
        ...field,
        isStructuredCellValue: field.isStructuredCellValue,
      })) as IFieldInstance[];
  }

  async getSearchIndexPolicy(tableId: string): Promise<ITableSearchIndexPolicyVo> {
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { searchIndexPolicy: true },
    });
    const parsed = tableSearchIndexPolicyVoSchema.safeParse(table.searchIndexPolicy);
    if (parsed.success) {
      return parsed.data;
    }
    if (table.searchIndexPolicy !== null) {
      this.logger.warn(`Invalid search index policy for table ${tableId}`);
    }
    return { version: 1, searchScope: 'all_fields', fields: [] };
  }

  async getSearchIndexFields(tableId: string): Promise<IFieldInstance[]> {
    const [fields, policy] = await Promise.all([
      this.getSearchIndexCandidateFields(tableId),
      this.getSearchIndexPolicy(tableId),
    ]);
    return selectSearchIndexFields(fields, policy);
  }

  async updateSearchIndexPolicy(
    tableId: string,
    policy: ITableSearchIndexPolicyRo
  ): Promise<ITableSearchIndexPolicyVo> {
    if (new Set(policy.fields).size !== policy.fields.length) {
      throw new CustomHttpException(
        'Duplicate fields in search index policy',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const [tableRaw, candidates] = await Promise.all([
      this.prismaService.tableMeta.findFirstOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { dbTableName: true },
      }),
      this.getSearchIndexCandidateFields(tableId),
    ]);

    if (policy.searchScope === 'selected_fields') {
      const eligibleIds = new Set(
        candidates
          .filter(
            (field) =>
              this.dbProvider.searchIndex().createSingleIndexSql(tableRaw.dbTableName, field) !==
              null
          )
          .map((field) => field.id)
      );
      const ineligible = policy.fields.filter((fieldId) => !eligibleIds.has(fieldId));
      if (ineligible.length > 0) {
        throw new CustomHttpException(
          `Fields are not eligible for the search index: ${ineligible.join(', ')}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
    }

    const stored: ITableSearchIndexPolicyVo = {
      version: 1,
      searchScope: policy.searchScope,
      fields: policy.searchScope === 'selected_fields' ? policy.fields : [],
    };

    await this.prismaService.tableMeta.update({
      where: { id: tableId },
      data: { searchIndexPolicy: stored as Prisma.InputJsonValue },
    });

    if ((await this.getActivatedTableIndexes(tableId)).includes(TableIndex.search)) {
      await this.repairIndex(tableId, TableIndex.search);
    }

    return stored;
  }

  async getQueryIndexPolicy(tableId: string): Promise<ITableQueryIndexPolicyVo> {
    const table = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true, queryIndexPolicy: true },
    });
    const parsed = tableQueryIndexPolicyVoSchema.safeParse(table.queryIndexPolicy);
    if (parsed.success) {
      if (parsed.data.indexes.length === 0) {
        return parsed.data;
      }
      const existingNames = new Set(await this.getQueryIndexNames(tableId, table.dbTableName));
      const builder = this.dbProvider.searchIndex();
      return {
        version: 1,
        indexes: parsed.data.indexes.filter((index) =>
          existingNames.has(builder.getQueryIndexName(tableId, index.id))
        ),
      };
    }
    if (table.queryIndexPolicy !== null) {
      this.logger.warn(`Invalid query index policy for table ${tableId}`);
    }
    return { version: 1, indexes: [] };
  }

  private async getQueryIndexNames(tableId: string, dbTableName: string): Promise<string[]> {
    const sql = this.dbProvider.searchIndex().getQueryIndexInfoSql(dbTableName);
    const rows = await this.databaseRouter.queryDataPrismaForTable<{ indexname: string }[]>(
      tableId,
      sql
    );
    return rows.map((row) => row.indexname);
  }

  async updateQueryIndexPolicy(
    tableId: string,
    policy: ITableQueryIndexPolicyRo
  ): Promise<ITableQueryIndexPolicyVo> {
    return this.prismaService.$transaction(
      async (tx) => {
        await this.waitForQueryIndexPolicyLock(tx, tableId);
        return this.updateQueryIndexPolicyWithClient(tx, tableId, policy);
      },
      {
        maxWait: this.thresholdConfig.bigTransactionTimeout,
        timeout: this.thresholdConfig.bigTransactionTimeout * 2,
      }
    );
  }

  private async updateQueryIndexPolicyWithClient(
    tx: Prisma.TransactionClient,
    tableId: string,
    policy: ITableQueryIndexPolicyRo
  ): Promise<ITableQueryIndexPolicyVo> {
    const [tableRaw, fieldsRaw] = await Promise.all([
      tx.tableMeta.findFirstOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { dbTableName: true },
      }),
      tx.field.findMany({
        where: { tableId, deletedTime: null },
        select: { id: true, type: true, isMultipleCellValue: true, dbFieldName: true },
      }),
    ]);

    const fieldById = new Map(fieldsRaw.map((field) => [field.id, field]));
    const fieldNamesById = new Map<string, string>([
      ['__id', '__id'],
      ['__created_time', '__created_time'],
    ]);
    for (const field of fieldsRaw) {
      fieldNamesById.set(field.id, field.dbFieldName);
    }

    const indexIds = new Set<string>();
    for (const index of policy.indexes) {
      if (indexIds.has(index.id)) {
        throw new CustomHttpException(
          `Duplicate query index id: ${index.id}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      indexIds.add(index.id);
      for (const column of index.columns) {
        if (column.kind === 'field') {
          this.assertQueryIndexField(column.fieldId, fieldById);
          continue;
        }
        if (new Set(column.fieldIds).size !== column.fieldIds.length) {
          throw new CustomHttpException(
            `Duplicate fields in query index ${index.id}`,
            HttpErrorCode.VALIDATION_ERROR
          );
        }
        for (const fieldId of column.fieldIds) {
          this.assertQueryIndexDateField(fieldId, fieldById);
        }
      }
    }

    const builder = this.dbProvider.searchIndex();
    const createSqls = policy.indexes.map((index) =>
      builder.createQueryIndexSql(tableRaw.dbTableName, index, fieldNamesById, tableId)
    );
    const stored: ITableQueryIndexPolicyVo = { version: 1, indexes: policy.indexes };

    await this.databaseRouter.dataPrismaTransactionForTable(
      tableId,
      async (prisma) => {
        await prisma.$executeRawUnsafe(builder.getDropQueryIndexesSql(tableRaw.dbTableName));
        for (const sql of createSqls) {
          await prisma.$executeRawUnsafe(sql);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
    await tx.tableMeta.update({
      where: { id: tableId },
      data: { queryIndexPolicy: stored as Prisma.InputJsonValue },
    });
    return stored;
  }

  isQueryIndexFieldTypeEligible(type: FieldType): boolean {
    return [
      FieldType.SingleLineText,
      FieldType.Number,
      FieldType.Date,
      FieldType.SingleSelect,
      FieldType.Checkbox,
    ].includes(type);
  }

  private assertQueryIndexField(
    fieldId: string,
    fieldById: Map<
      string,
      { type: string; isMultipleCellValue: boolean | null; dbFieldName: string }
    >
  ): void {
    if (fieldId === '__id' || fieldId === '__created_time') {
      return;
    }
    const field = fieldById.get(fieldId);
    if (
      !field ||
      field.isMultipleCellValue ||
      !this.isQueryIndexFieldTypeEligible(field.type as FieldType)
    ) {
      throw new CustomHttpException(
        `Field is not eligible for a query index: ${fieldId}`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
  }

  private assertQueryIndexDateField(
    fieldId: string,
    fieldById: Map<
      string,
      { type: string; isMultipleCellValue: boolean | null; dbFieldName: string }
    >
  ): void {
    if (fieldId === '__created_time') {
      return;
    }
    const field = fieldById.get(fieldId);
    if (!field || field.isMultipleCellValue || field.type !== FieldType.Date) {
      throw new CustomHttpException(
        `Field is not eligible for a coalesce query index: ${fieldId}`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
  }

  async getActivatedTableIndexes(
    tableId: string,
    type: TableIndex = TableIndex.search,
    routingOptions?: IDataDbRoutingOptions
  ): Promise<TableIndex[]> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    if (type === TableIndex.search) {
      const searchIndexSql = this.dbProvider.searchIndex().getExistTableIndexSql(dbTableName);
      const [{ exists: searchIndexExist }] = await this.databaseRouter.queryDataPrismaForTable<
        {
          exists: boolean;
        }[]
      >(tableId, searchIndexSql, routingOptions);

      const result: ITableIndexType[] = [];

      if (searchIndexExist) {
        result.push(TableIndex.search);
      }

      return result;
    } else {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }
  }

  async toggleIndex(tableId: string, enableRo: IToggleIndexRo) {
    const { type } = enableRo;
    if (type !== TableIndex.search) {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }

    const index = await this.getActivatedTableIndexes(tableId);

    const fields = await this.getSearchIndexFields(tableId);

    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    await this.toggleSearchIndex(tableId, dbTableName, fields, !index.includes(type));
  }

  async toggleSearchIndex(
    tableId: string,
    dbTableName: string,
    fields: IFieldInstance[],
    toEnable: boolean
  ) {
    if (toEnable) {
      const sqls = this.dbProvider.searchIndex().getCreateIndexSql(dbTableName, fields);
      return await this.databaseRouter.dataPrismaTransactionForTable(
        tableId,
        async (prisma) => {
          for (let i = 0; i < sqls.length; i++) {
            const sql = sqls[i];
            try {
              await prisma.$executeRawUnsafe(sql);
            } catch (error) {
              console.error('toggleSearchIndex:create:error', sql);
              throw new CustomHttpException(
                `Create table index error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpErrorCode.VALIDATION_ERROR,
                {
                  localization: {
                    i18nKey: 'httpErrors.table.createTableIndexError',
                  },
                }
              );
            }
          }
        },
        { timeout: this.thresholdConfig.bigTransactionTimeout }
      );
    }

    const sql = this.dbProvider.searchIndex().getDropIndexSql(dbTableName);
    try {
      return await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
    } catch (error) {
      console.error('toggleSearchIndex:drop:error', sql);
      throw new CustomHttpException(
        `Drop table index error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.dropTableIndexError',
          },
        }
      );
    }
  }

  async deleteSearchFieldIndex(
    tableId: string,
    field: IFieldInstance,
    options?: { removeQueryIndexes?: boolean }
  ) {
    if (options?.removeQueryIndexes) {
      await this.removeQueryIndexesForField(tableId, field.id);
    }
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.search)) {
      const sql = this.dbProvider.searchIndex().getDeleteSingleIndexSql(dbTableName, field);
      // Execute within current transaction if present to keep boundaries consistent
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
    }
  }

  private async waitForQueryIndexPolicyLock(
    tx: Pick<Prisma.TransactionClient, '$queryRawUnsafe'>,
    tableId: string
  ): Promise<void> {
    const lockWaitDeadline = Date.now() + this.thresholdConfig.bigTransactionTimeout;
    let lockAcquired = false;
    while (!lockAcquired) {
      if (Date.now() >= lockWaitDeadline) {
        throw new CustomHttpException(
          'Timed out waiting for another query index policy update',
          HttpErrorCode.CONFLICT
        );
      }
      const rows = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        `table-query-index-policy:${tableId}`
      );
      lockAcquired = rows[0]?.locked === true;
      if (!lockAcquired) {
        const { promise, resolve } = promiseWithResolvers.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
    }
  }

  async lockQueryIndexPolicy(tableId: string): Promise<void> {
    await this.waitForQueryIndexPolicyLock(this.prismaService.txClient(), tableId);
  }

  private queryIndexReferencesField(index: ITableQueryIndexSpec, fieldId: string): boolean {
    return index.columns.some((column) =>
      column.kind === 'field' ? column.fieldId === fieldId : column.fieldIds.includes(fieldId)
    );
  }

  async withQueryIndexesForFieldConversion<T>(
    tableId: string,
    fieldId: string,
    targetType: FieldType | undefined,
    convert: () => Promise<T>,
    options?: { targetIsLookup?: boolean; targetIsConditionalLookup?: boolean }
  ): Promise<T> {
    return this.prismaService.$transaction(
      async (tx) => {
        await this.waitForQueryIndexPolicyLock(tx, tableId);
        const fields = await tx.field.findMany({
          where: { tableId, deletedTime: null },
          select: {
            id: true,
            type: true,
            dbFieldName: true,
            isLookup: true,
            isConditionalLookup: true,
          },
        });
        const field = fields.find((candidate) => candidate.id === fieldId);
        if (!targetType || !field) {
          return convert();
        }
        const lookupChanged =
          Boolean(field.isLookup) !== Boolean(options?.targetIsLookup) ||
          Boolean(field.isConditionalLookup) !== Boolean(options?.targetIsConditionalLookup);
        if (field.type === targetType && !lookupChanged) {
          return convert();
        }
        const table = await tx.tableMeta.findFirstOrThrow({
          where: { id: tableId, deletedTime: null },
          select: { queryIndexPolicy: true, dbTableName: true },
        });
        const parsed = tableQueryIndexPolicyVoSchema.safeParse(table.queryIndexPolicy);
        if (!parsed.success) {
          return convert();
        }
        const removed = parsed.data.indexes.filter((index) =>
          this.queryIndexReferencesField(index, fieldId)
        );
        if (removed.length === 0) {
          return convert();
        }
        const indexes = parsed.data.indexes.filter(
          (index) => !this.queryIndexReferencesField(index, fieldId)
        );
        const builder = this.dbProvider.searchIndex();
        const fieldNames = new Map(
          fields.map((candidate) => [candidate.id, candidate.dbFieldName])
        );
        fieldNames.set('__id', '__id');
        fieldNames.set('__created_time', '__created_time');
        const restoreSqls = removed.map((index) =>
          builder.createQueryIndexSql(table.dbTableName, index, fieldNames, tableId)
        );
        const [schema] = table.dbTableName.split('.');
        await this.databaseRouter.dataPrismaTransactionForTable(
          tableId,
          async (prisma) => {
            for (const index of removed) {
              const name = builder.getQueryIndexName(tableId, index.id);
              await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${schema}"."${name}"`);
            }
          },
          { timeout: this.thresholdConfig.bigTransactionTimeout }
        );

        // Keep the advisory lock, but do not write tableMeta until the detached
        // v2 command commits: it may need to update that same metadata row.
        let result: T;
        try {
          result = await convert();
        } catch (error) {
          try {
            await this.databaseRouter.dataPrismaTransactionForTable(
              tableId,
              async (prisma) => {
                for (const sql of restoreSqls) {
                  await prisma.$executeRawUnsafe(sql);
                }
              },
              { timeout: this.thresholdConfig.bigTransactionTimeout }
            );
          } catch (restoreError) {
            throw new AggregateError(
              [error, restoreError],
              'Field conversion failed and its query indexes could not be restored'
            );
          }
          throw error;
        }
        await tx.tableMeta.update({
          where: { id: tableId },
          data: { queryIndexPolicy: { version: 1, indexes } as Prisma.InputJsonValue },
        });
        return result;
      },
      {
        maxWait: this.thresholdConfig.bigTransactionTimeout,
        timeout: this.thresholdConfig.bigTransactionTimeout * 2,
      }
    );
  }

  async removeQueryIndexesForField(tableId: string, fieldId: string): Promise<void> {
    await this.removeQueryIndexesForFieldWithClient(
      this.prismaService.txClient(),
      tableId,
      fieldId
    );
  }

  async removeQueryIndexesForFieldStandalone(tableId: string, fieldId: string): Promise<void> {
    await this.prismaService.$transaction(
      (tx) => this.removeQueryIndexesForFieldWithClient(tx, tableId, fieldId),
      {
        maxWait: this.thresholdConfig.bigTransactionTimeout,
        timeout: this.thresholdConfig.bigTransactionTimeout * 2,
      }
    );
  }

  private async removeQueryIndexesForFieldWithClient(
    tx: Prisma.TransactionClient,
    tableId: string,
    fieldId: string
  ): Promise<void> {
    await this.waitForQueryIndexPolicyLock(tx, tableId);
    const table = await tx.tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { queryIndexPolicy: true, dbTableName: true },
    });
    const parsed = tableQueryIndexPolicyVoSchema.safeParse(table.queryIndexPolicy);
    if (!parsed.success) {
      return;
    }
    const removed = parsed.data.indexes.filter((index) =>
      this.queryIndexReferencesField(index, fieldId)
    );
    if (removed.length === 0) {
      return;
    }
    const indexes = parsed.data.indexes.filter(
      (index) => !this.queryIndexReferencesField(index, fieldId)
    );
    const builder = this.dbProvider.searchIndex();
    const [schema] = table.dbTableName.split('.');
    for (const index of removed) {
      const name = builder.getQueryIndexName(tableId, index.id);
      await this.databaseRouter.executeDataPrismaForTable(
        tableId,
        `DROP INDEX IF EXISTS "${schema}"."${name}"`
      );
    }
    await tx.tableMeta.update({
      where: { id: tableId },
      data: { queryIndexPolicy: { version: 1, indexes } as Prisma.InputJsonValue },
    });
  }

  async createSearchFieldSingleIndex(
    tableId: string,
    fieldInstance: IFieldInstance,
    routingOptions?: IDataDbRoutingOptions
  ) {
    if (fieldInstance.type === FieldType.Button) {
      return;
    }
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true, searchIndexPolicy: true },
    });
    const policy = tableSearchIndexPolicyVoSchema.safeParse(tableRaw.searchIndexPolicy);
    if (
      policy.success &&
      policy.data.searchScope === 'selected_fields' &&
      !policy.data.fields.includes(fieldInstance.id)
    ) {
      return;
    }
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId, TableIndex.search, routingOptions);
    const sql = this.dbProvider.searchIndex().createSingleIndexSql(dbTableName, fieldInstance);
    if (index.includes(TableIndex.search) && sql) {
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql, routingOptions);
    }
  }

  async updateSearchFieldIndexName(
    tableId: string,
    oldField: Pick<IFieldInstance, 'id' | 'dbFieldName'>,
    newField: Pick<IFieldInstance, 'id' | 'dbFieldName'>
  ) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.search)) {
      const sql = this.dbProvider
        .searchIndex()
        .getUpdateSingleIndexNameSql(dbTableName, oldField, newField);
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
    }
  }

  async getIndexInfo(tableId: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;

    const sql = this.dbProvider.searchIndex().getIndexInfoSql(dbTableName);
    return this.databaseRouter.queryDataPrismaForTable<unknown[]>(tableId, sql);
  }

  async getAbnormalTableIndex(tableId: string, type: TableIndex) {
    const index = await this.getActivatedTableIndexes(tableId);
    if (!index.includes(type)) {
      return [] as IGetAbnormalVo;
    }

    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
    });

    const { dbTableName } = tableRaw;

    const fieldInstances = await this.getSearchIndexFields(tableId);

    const indexInfo = await this.getIndexInfo(tableId);

    return this.dbProvider.searchIndex().getAbnormalIndex(dbTableName, fieldInstances, indexInfo);
  }

  async repairIndex(tableId: string, type: TableIndex) {
    if (type !== TableIndex.search) {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }

    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
        deletedTime: null,
      },
      select: {
        dbTableName: true,
      },
    });

    const { dbTableName } = tableRaw;
    const dropSql = this.dbProvider.searchIndex().getDropIndexSql(dbTableName);
    const fieldInstances = await this.getSearchIndexFields(tableId);
    const createSqls = this.dbProvider.searchIndex().getCreateIndexSql(dbTableName, fieldInstances);
    await this.databaseRouter.dataPrismaTransactionForTable(
      tableId,
      async (prisma) => {
        await prisma.$executeRawUnsafe(dropSql);
        for (let i = 0; i < createSqls.length; i++) {
          await prisma.$executeRawUnsafe(createSqls[i]);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }
}

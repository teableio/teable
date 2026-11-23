/* eslint-disable sonarjs/no-duplicate-string */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FieldType, HttpErrorCode, type CellValueType } from '@teable/core';
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
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type IExecutionContext,
  type ITableRepository,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  resolveTableSearchDocumentCoverage,
  v2TableOpsTokens,
  type TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { sql } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import type { IDataDbRoutingOptions } from '../../global/data-db-client-manager.service';
import { DatabaseRouter } from '../../global/database-router.service';
import type { IClsStore } from '../../types/cls';
import { CanaryService } from '../canary/canary.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import type { IndexBuilderAbstract } from './index-abstract-builder';
import { IndexBuilderPostgres } from './search-index-builder.postgres';
import type { ITableIndexField } from './table-index-field';

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
    @Inject(IndexBuilderPostgres) private readonly indexBuilder: IndexBuilderAbstract,
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
      serving: false,
      active: false,
      coveredFieldIds: [],
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
    const status = result.value;
    const coverage = await this.resolveSearchCoverageFields(container, context, tableId, status);
    return {
      tableId: status.tableId,
      state: status.state,
      configured: status.configured,
      serving: status.serving,
      coveredFieldIds: coverage.coveredFieldIds,
      ...(coverage.uncoveredFieldIds ? { uncoveredFieldIds: coverage.uncoveredFieldIds } : {}),
      ...(status.languageConfig ? { languageConfig: status.languageConfig } : {}),
      ...(status.searchScope ? { searchScope: status.searchScope } : {}),
      coveredFieldCount: status.coveredFieldCount,
      active:
        status.state === 'ready' &&
        this.v2ContainerService.isTableQuerySearchVectorRuntimeEnabled() &&
        (await this.isV2RecordReadEnabled(tableId)),
    };
  }

  /**
   * Reconciles the published coverage with the current schema. Covered ids the table no longer has
   * are dropped, and fields that are searchable but not published are reported — but only while a
   * snapshot actually serves and only for an `all_fields` document: unselected fields are excluded
   * on purpose, and without a serving snapshot the fallback still finds them, so the list would lie.
   * When the table cannot be loaded the lists are left out instead of claiming full coverage.
   */
  private async resolveSearchCoverageFields(
    container: DependencyContainer,
    context: IExecutionContext,
    tableId: string,
    status: {
      readonly serving: boolean;
      readonly searchScope?: 'all_fields' | 'selected_fields';
      readonly coveredFieldIds: readonly string[];
    }
  ): Promise<{ coveredFieldIds: string[]; uncoveredFieldIds?: string[] }> {
    const published = { coveredFieldIds: [...status.coveredFieldIds] };
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) return published;
    const table = await container
      .resolve<ITableRepository>(v2CoreTokens.tableRepository)
      .findOne(context, TableByIdSpec.create(tableIdResult.value));
    if (table.isErr()) return published;
    const coverage = resolveTableSearchDocumentCoverage(table.value, status.coveredFieldIds);
    if (coverage.isErr()) return published;
    return {
      coveredFieldIds: [...coverage.value.coveredFieldIds],
      ...(status.serving && status.searchScope === 'all_fields'
        ? { uncoveredFieldIds: [...coverage.value.uncoveredFieldIds] }
        : {}),
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
  private async getSearchIndexCandidateFields(tableId: string): Promise<ITableIndexField[]> {
    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });
    return fieldsRaw
      .filter(({ type }) => type !== FieldType.Button)
      .map((field) => {
        let type = field.type as FieldType;
        let options: unknown = field.options && JSON.parse(field.options);
        if (field.type === 'conditionalLookup') {
          const config =
            options && typeof options === 'object' && !Array.isArray(options)
              ? (options as Record<string, unknown>)
              : {};
          type =
            typeof config.innerType === 'string'
              ? (config.innerType as FieldType)
              : FieldType.SingleLineText;
          options =
            config.innerOptions &&
            typeof config.innerOptions === 'object' &&
            !Array.isArray(config.innerOptions)
              ? config.innerOptions
              : {};
        }
        return {
          id: field.id,
          type,
          dbFieldName: field.dbFieldName,
          cellValueType: field.cellValueType as CellValueType,
          options,
          isMultipleCellValue: field.isMultipleCellValue ?? undefined,
          isStructuredCellValue:
            type === FieldType.Link ||
            type === FieldType.User ||
            type === FieldType.CreatedBy ||
            type === FieldType.LastModifiedBy,
        };
      });
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

  async getSearchIndexFields(tableId: string): Promise<ITableIndexField[]> {
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
            (field) => this.indexBuilder.createSingleIndexSql(tableRaw.dbTableName, field) !== null
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
      const existingIds = new Set(
        (await this.getQueryIndexes(tableId, table.dbTableName)).map((index) => index.id)
      );
      return {
        version: 1,
        indexes: parsed.data.indexes.filter((index) => existingIds.has(index.id)),
      };
    }
    if (table.queryIndexPolicy !== null) {
      this.logger.warn(`Invalid query index policy for table ${tableId}`);
    }
    return { version: 1, indexes: [] };
  }

  private async getQueryIndexes(
    tableId: string,
    dbTableName: string
  ): Promise<{ id: string; name: string }[]> {
    const builder = this.indexBuilder;
    const rows = await this.databaseRouter.queryDataPrismaForTable<{ indexname: string }[]>(
      tableId,
      builder.getQueryIndexInfoSql(dbTableName)
    );
    const indexes: { id: string; name: string }[] = [];
    for (const { indexname } of rows) {
      const id = builder.getQueryIndexId(indexname);
      if (id) indexes.push({ id, name: indexname });
    }
    return indexes;
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
      ['__auto_number', '__auto_number'],
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

    const builder = this.indexBuilder;
    const stored: ITableQueryIndexPolicyVo = { version: 1, indexes: policy.indexes };

    await this.databaseRouter.dataPrismaTransactionForTable(
      tableId,
      async (prisma) => {
        await prisma.$executeRawUnsafe(builder.getDropQueryIndexesSql(tableRaw.dbTableName));
        const [schema] = tableRaw.dbTableName.split('.');
        const relations = await prisma.$queryRawUnsafe<{ name: string }[]>(
          `SELECT c.relname::text AS name FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`,
          schema
        );
        const unavailableNames = new Set(relations.map((relation) => relation.name));
        for (const index of policy.indexes) {
          const name = builder.getQueryIndexName(tableId, index.id, unavailableNames);
          await prisma.$executeRawUnsafe(
            builder.createQueryIndexSql(tableRaw.dbTableName, index, fieldNamesById, tableId, name)
          );
          unavailableNames.add(name);
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
    // `__auto_number` is the stable tie-break every paged record read appends
    // after a user-field sort, so it must be indexable for that ORDER BY to run
    // as an ordered scan.
    if (fieldId === '__id' || fieldId === '__created_time' || fieldId === '__auto_number') {
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
      const searchIndexSql = this.indexBuilder.getExistTableIndexSql(dbTableName);
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
    fields: ITableIndexField[],
    toEnable: boolean
  ) {
    if (toEnable) {
      const sqls = this.indexBuilder.getCreateIndexSql(dbTableName, fields);
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

    const sql = this.indexBuilder.getDropIndexSql(dbTableName);
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
    field: ITableIndexField,
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
      const sql = this.indexBuilder.getDeleteSingleIndexSql(dbTableName, field);
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

  /** Runs inside the caller's routed metadata/data unit of work; recovery owns split-DB restore. */
  async withQueryIndexesForLinkConversions<T>(
    context: IExecutionContext,
    targets: ReadonlyArray<{ tableId: string; fieldId: string }>,
    convert: () => Promise<T>
  ): Promise<T> {
    const metaDb = getPostgresTransaction<V1TeableDatabase>(context, 'meta');
    const dataDb = getPostgresTransaction<V1TeableDatabase>(context, 'data');
    if (!metaDb || !dataDb) {
      throw new Error(
        'Link conversion query indexes require active metadata and data transactions'
      );
    }
    const fieldsByTable = new Map<string, Set<string>>();
    for (const target of targets) {
      const fields = fieldsByTable.get(target.tableId) ?? new Set<string>();
      fields.add(target.fieldId);
      fieldsByTable.set(target.tableId, fields);
    }
    const policies: Array<{ tableId: string; policy: ITableQueryIndexPolicyVo }> = [];
    for (const tableId of [...fieldsByTable.keys()].sort()) {
      const lockWaitDeadline = Date.now() + this.thresholdConfig.bigTransactionTimeout;
      for (;;) {
        if (Date.now() >= lockWaitDeadline) {
          throw new CustomHttpException(
            'Timed out waiting for another query index policy update',
            HttpErrorCode.CONFLICT
          );
        }
        const { rows } = await sql<{ locked: boolean }>`
          SELECT pg_try_advisory_xact_lock(hashtext(${`table-query-index-policy:${tableId}`})) AS locked
        `.execute(metaDb);
        if (rows[0]?.locked === true) break;
        const { promise, resolve } = promiseWithResolvers.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
      const { rows: tables } = await sql<{
        db_table_name: string;
        query_index_policy: unknown;
      }>`
        SELECT db_table_name, query_index_policy FROM table_meta
        WHERE id = ${tableId} AND deleted_time IS NULL
      `.execute(metaDb);
      const table = tables[0];
      const parsed = tableQueryIndexPolicyVoSchema.safeParse(table?.query_index_policy);
      if (!table || !parsed.success) continue;
      const targetFieldIds = fieldsByTable.get(tableId)!;
      const fields = await metaDb
        .selectFrom('field')
        .select(['id', 'type', 'is_lookup', 'is_conditional_lookup'])
        .where('table_id', '=', tableId)
        .where('deleted_time', 'is', null)
        .where('id', 'in', [...targetFieldIds])
        .execute();
      const changedFieldIds = fields
        .filter(
          (field) =>
            field.type !== FieldType.SingleLineText ||
            Boolean(field.is_lookup) ||
            Boolean(field.is_conditional_lookup)
        )
        .map(({ id }) => id);
      const removed = parsed.data.indexes.filter((index) =>
        changedFieldIds.some((fieldId) => this.queryIndexReferencesField(index, fieldId))
      );
      if (removed.length === 0) continue;
      const [schema] = table.db_table_name.split('.');
      for (const index of removed) {
        const name = this.indexBuilder.getQueryIndexName(tableId, index.id);
        await sql`DROP INDEX IF EXISTS ${sql.id(schema, name)}`.execute(dataDb);
      }
      const removedIds = new Set(removed.map(({ id }) => id));
      policies.push({
        tableId,
        policy: {
          version: 1,
          indexes: parsed.data.indexes.filter(({ id }) => !removedIds.has(id)),
        },
      });
    }
    const result = await convert();
    for (const { tableId, policy } of policies) {
      await sql`
        UPDATE table_meta SET query_index_policy = ${JSON.stringify(policy)}::jsonb
        WHERE id = ${tableId}
      `.execute(metaDb);
    }
    return result;
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
        const builder = this.indexBuilder;
        const fieldNames = new Map(
          fields.map((candidate) => [candidate.id, candidate.dbFieldName])
        );
        fieldNames.set('__id', '__id');
        fieldNames.set('__created_time', '__created_time');
        fieldNames.set('__auto_number', '__auto_number');
        const removedById = new Map(removed.map((index) => [index.id, index]));
        const ownedIndexes = (await this.getQueryIndexes(tableId, table.dbTableName)).filter(
          (index) => removedById.has(index.id)
        );
        const restoreSqls = ownedIndexes.map(({ id, name }) =>
          builder.createQueryIndexSql(
            table.dbTableName,
            removedById.get(id)!,
            fieldNames,
            tableId,
            name
          )
        );
        const [schema] = table.dbTableName.split('.');
        await this.databaseRouter.dataPrismaTransactionForTable(
          tableId,
          async (prisma) => {
            for (const { name } of ownedIndexes) {
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
    const [schema] = table.dbTableName.split('.');
    const removedIds = new Set(removed.map((index) => index.id));
    const ownedIndexes = (await this.getQueryIndexes(tableId, table.dbTableName)).filter((index) =>
      removedIds.has(index.id)
    );
    for (const { name } of ownedIndexes) {
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
    fieldInstance: ITableIndexField,
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
    const sql = this.indexBuilder.createSingleIndexSql(dbTableName, fieldInstance);
    if (index.includes(TableIndex.search) && sql) {
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql, routingOptions);
    }
  }

  async updateSearchFieldIndexName(
    tableId: string,
    oldField: Pick<ITableIndexField, 'id' | 'dbFieldName'>,
    newField: Pick<ITableIndexField, 'id' | 'dbFieldName'>
  ) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.search)) {
      const sql = this.indexBuilder.getUpdateSingleIndexNameSql(dbTableName, oldField, newField);
      await this.databaseRouter.executeDataPrismaForTable(tableId, sql);
    }
  }

  async getIndexInfo(tableId: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;

    const sql = this.indexBuilder.getIndexInfoSql(dbTableName);
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

    return this.indexBuilder.getAbnormalIndex(dbTableName, fieldInstances, indexInfo);
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
    const dropSql = this.indexBuilder.getDropIndexSql(dbTableName);
    const fieldInstances = await this.getSearchIndexFields(tableId);
    const createSqls = this.indexBuilder.getCreateIndexSql(dbTableName, fieldInstances);
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

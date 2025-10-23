import { Inject, Injectable, Logger } from '@nestjs/common';
import { extractFieldIdsFromFilter, FieldType } from '@teable/core';
import type { FieldCore, IFilter, ISortItem, TableDomain, Tables } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { ID_FIELD_NAME, preservedDbFieldNames } from '../../field/constant';
import { TableDomainQueryService } from '../../table-domain/table-domain-query.service';
import { FieldCteVisitor } from './field-cte-visitor';
import { FieldSelectVisitor } from './field-select-visitor';
import type {
  ICreateRecordAggregateBuilderOptions,
  ICreateRecordQueryBuilderOptions,
  IPrepareViewParams,
  IRecordQueryBuilder,
  IMutableQueryBuilderState,
  IReadonlyRecordSelectionMap,
} from './record-query-builder.interface';
import { RecordQueryBuilderManager } from './record-query-builder.manager';
import { InjectRecordQueryDialect } from './record-query-builder.provider';
import { getOrderedFieldsByProjection, getTableAliasFromTable } from './record-query-builder.util';
import { IRecordQueryDialectProvider } from './record-query-dialect.interface';

@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  private readonly logger = new Logger(RecordQueryBuilderService.name);
  constructor(
    private readonly tableDomainQueryService: TableDomainQueryService,
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    private readonly prismaService: PrismaService,
    @Inject('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectRecordQueryDialect()
    private readonly dialect: IRecordQueryDialectProvider
  ) {}

  private async getTableMeta(tableIdOrDbTableName: string) {
    // Use transactional client so callers running inside $tx (e.g., base duplication)
    // can resolve freshly-created tables within the same transaction.
    return this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableIdOrDbTableName }, { dbTableName: tableIdOrDbTableName }] },
      select: { id: true, dbViewName: true },
    });
  }

  private async createQueryBuilderFromTable(
    from: string,
    tableRaw: { id: string }
  ): Promise<{
    qb: Knex.QueryBuilder;
    alias: string;
    tables: Tables;
    table: TableDomain;
    state: IMutableQueryBuilderState;
  }> {
    const tables = await this.tableDomainQueryService.getAllRelatedTableDomains(tableRaw.id);
    const table = tables.mustGetEntryTable();
    const mainTableAlias = getTableAliasFromTable(table);
    const qb = this.knex.from({ [mainTableAlias]: from });

    const state: IMutableQueryBuilderState = new RecordQueryBuilderManager('table');
    state.setMainTableAlias(mainTableAlias);
    state.setMainTableSource(table.dbTableName);
    if (from !== table.dbTableName) {
      state.setMainTableSource(from);
    }

    return { qb, alias: mainTableAlias, tables, table, state };
  }

  private async createQueryBuilderFromView(tableRaw: { id: string; dbViewName: string }): Promise<{
    qb: Knex.QueryBuilder;
    alias: string;
    table: TableDomain;
    state: IMutableQueryBuilderState;
  }> {
    const table = await this.tableDomainQueryService.getTableDomainById(tableRaw.id);
    const mainTableAlias = getTableAliasFromTable(table);
    const qb = this.knex.from({ [mainTableAlias]: tableRaw.dbViewName });

    const state = new RecordQueryBuilderManager('view');
    state.setMainTableAlias(mainTableAlias);
    state.setMainTableSource(table.dbTableName);
    if (tableRaw.dbViewName !== table.dbTableName) {
      state.setMainTableSource(tableRaw.dbViewName);
    }

    return { qb, table, state, alias: mainTableAlias };
  }

  private async createQueryBuilderFromTableCache(tableRaw: { id: string }): Promise<{
    qb: Knex.QueryBuilder;
    alias: string;
    table: TableDomain;
    state: IMutableQueryBuilderState;
  }> {
    const table = await this.tableDomainQueryService.getTableDomainById(tableRaw.id);
    const mainTableAlias = getTableAliasFromTable(table);
    const qb = this.knex.from({ [mainTableAlias]: table.dbTableName });

    const state = new RecordQueryBuilderManager('tableCache');
    state.setMainTableAlias(mainTableAlias);
    state.setMainTableSource(table.dbTableName);

    return { qb, table, state, alias: mainTableAlias };
  }

  private async createQueryBuilder(
    from: string,
    tableIdOrDbTableName: string,
    options: Partial<ICreateRecordQueryBuilderOptions> = {}
  ): Promise<{
    qb: Knex.QueryBuilder;
    alias: string;
    table: TableDomain;
    state: IMutableQueryBuilderState;
  }> {
    const tableRaw = await this.getTableMeta(tableIdOrDbTableName);
    const useQueryModel = options.useQueryModel ?? false;

    let builder:
      | {
          qb: Knex.QueryBuilder;
          alias: string;
          table: TableDomain;
          state: IMutableQueryBuilderState;
          tables?: Tables;
        }
      | undefined;

    if (useQueryModel) {
      try {
        builder = await this.createQueryBuilderFromTableCache(tableRaw as { id: string });
      } catch (error) {
        this.logger.error(`Failed to create query builder from view: ${error}, use table instead`);
        builder = await this.createQueryBuilderFromTable(from, tableRaw);
      }
    } else {
      builder = await this.createQueryBuilderFromTable(from, tableRaw);
    }

    const { qb, alias, table, state } = builder;

    if (state.getContext() === 'table') {
      const tables = (builder as unknown as { tables: Tables }).tables;
      this.applyBasePaginationIfNeeded(qb, table, state, alias, {
        limit: options.limit,
        offset: options.offset,
        filter: options.filter,
        sort: options.sort,
        currentUserId: options.currentUserId,
        defaultOrderField: options.defaultOrderField,
        hasSearch: options.hasSearch,
        restrictRecordIds: options.restrictRecordIds,
      });
      this.buildFieldCtes(qb, tables, state, options.projection);
    }

    return { qb, alias, table, state };
  }

  async prepareView(
    from: string,
    params: IPrepareViewParams
  ): Promise<{ qb: Knex.QueryBuilder; table: TableDomain }> {
    const { tableIdOrDbTableName } = params;
    const { qb, table, state } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    this.buildSelect(qb, table, state);

    return { qb, table };
  }

  async createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }> {
    const { tableIdOrDbTableName, filter, sort, currentUserId, restrictRecordIds } = options;
    const { qb, alias, table, state } = await this.createQueryBuilder(from, tableIdOrDbTableName, {
      useQueryModel: options.useQueryModel,
      projection: options.projection,
      limit: options.limit,
      offset: options.offset,
      filter,
      sort,
      currentUserId,
      defaultOrderField: options.defaultOrderField,
      hasSearch: options.hasSearch,
      restrictRecordIds,
    });

    this.buildSelect(
      qb,
      table,
      state,
      options.projection,
      options.rawProjection,
      options.preferRawFieldReferences ?? false
    );

    // Selection map collected as fields are visited.

    const selectionMap = state.getSelectionMap();
    if (filter) {
      this.buildFilter(qb, table, filter, selectionMap, currentUserId);
    }

    if (sort) {
      this.buildSort(qb, table, sort, selectionMap);
    }

    return { qb, alias, selectionMap };
  }

  async createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }> {
    const {
      tableIdOrDbTableName,
      filter,
      aggregationFields,
      groupBy,
      currentUserId,
      useQueryModel,
      restrictRecordIds,
    } = options;
    const { qb, table, alias, state } = await this.createQueryBuilder(from, tableIdOrDbTableName, {
      useQueryModel,
      projection: options.projection,
      filter,
      currentUserId,
      restrictRecordIds,
    });

    this.buildAggregateSelect(qb, table, state);
    const selectionMap = state.getSelectionMap();

    if (filter) {
      this.buildFilter(qb, table, filter, selectionMap, currentUserId);
    }

    const fieldMap = table.fieldList.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, FieldCore>
    );

    const groupByFieldIds = groupBy?.map((item) => item.fieldId);
    // Apply aggregation (do NOT pass groupBy here; grouping is handled by GroupQuery below)
    this.dbProvider
      .aggregationQuery(qb, fieldMap, aggregationFields, undefined, {
        selectionMap,
        tableDbName: table.dbTableName,
        tableAlias: alias,
      })
      .appendBuilder();

    // Apply grouping if specified
    if (groupBy && groupBy.length > 0) {
      this.dbProvider
        .groupQuery(qb, fieldMap, groupByFieldIds, undefined, { selectionMap })
        .appendGroupBuilder();
      // Do not sort by original columns here to avoid ORDER BY columns not present in GROUP BY
    }

    return { qb, alias, selectionMap };
  }

  private buildFieldCtes(
    qb: Knex.QueryBuilder,
    tables: Tables | undefined,
    state: IMutableQueryBuilderState,
    projection?: string[]
  ): void {
    if (!tables) {
      return;
    }
    const visitor = new FieldCteVisitor(
      qb,
      this.dbProvider,
      tables,
      state,
      this.dialect,
      projection
    );
    visitor.build();
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private applyBasePaginationIfNeeded(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    state: IMutableQueryBuilderState,
    alias: string,
    params: {
      limit?: number;
      offset?: number;
      filter?: IFilter;
      sort?: ISortItem[];
      currentUserId?: string;
      defaultOrderField?: string;
      hasSearch?: boolean;
      restrictRecordIds?: string[];
    }
  ): void {
    const {
      limit,
      offset,
      filter,
      sort,
      currentUserId,
      defaultOrderField,
      hasSearch,
      restrictRecordIds,
    } = params;
    state.setBaseCteName(undefined);

    if (state.getContext() !== 'table') {
      return;
    }

    const originalSource = state.getOriginalMainTableSource();
    if (!originalSource) {
      return;
    }

    const baseLimit = this.resolveBaseLimit(limit, offset);
    let applyPagination = Boolean(baseLimit) && !hasSearch;
    const normalizedRecordIds = Array.from(
      new Set(
        (restrictRecordIds ?? []).filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      )
    );
    const applyRecordRestriction = normalizedRecordIds.length > 0;

    if (!applyPagination && !applyRecordRestriction) {
      return;
    }

    let baseSelectionMap: Map<string, string> | undefined;

    if (applyPagination) {
      const requiredFieldIds = this.collectRequiredFieldIds(filter, sort, defaultOrderField);
      const fieldLookup = this.buildFieldLookup(table);

      if (this.referencesComputedField(requiredFieldIds, fieldLookup)) {
        // Fall back to full table scan when pagination conflicts with computed fields,
        // but still allow record-level restriction to run.
        applyPagination = false;
        if (!applyRecordRestriction) {
          return;
        }
      } else {
        baseSelectionMap = this.createBaseSelectionMap(requiredFieldIds, fieldLookup, alias);
      }
    }

    const baseBuilder = this.knex
      .queryBuilder()
      .select(this.knex.raw('??.*', [alias]))
      .from({ [alias]: originalSource });

    if (applyPagination && filter) {
      this.buildFilter(baseBuilder, table, filter, baseSelectionMap!, currentUserId);
    }

    if (applyPagination && sort && sort.length) {
      this.buildSort(baseBuilder, table, sort, baseSelectionMap!);
    }

    if (applyPagination && defaultOrderField) {
      baseBuilder.orderBy(`${alias}.${defaultOrderField}`, 'asc');
    }

    if (applyPagination && baseLimit) {
      baseBuilder.limit(baseLimit);
    }

    if (applyRecordRestriction) {
      baseBuilder.whereIn(`${alias}.${ID_FIELD_NAME}`, normalizedRecordIds);
    }

    const baseCteName = `BASE_${alias}`;
    qb.with(baseCteName, baseBuilder);
    qb.from({ [alias]: baseCteName });
    state.setBaseCteName(baseCteName);
    state.setMainTableSource(baseCteName);
  }

  private isComputedField(field: FieldCore): boolean {
    if (field.isLookup) {
      return true;
    }
    switch (field.type) {
      case FieldType.Rollup:
      case FieldType.ConditionalRollup:
      case FieldType.Formula:
        return true;
      default:
        return false;
    }
  }

  private resolveBaseLimit(limit?: number, offset?: number): number | undefined {
    if (limit === undefined || limit === null) {
      return undefined;
    }
    if (limit < 0 || limit === -1) {
      return undefined;
    }
    const safeOffset = offset && offset > 0 ? offset : 0;
    const baseLimit = safeOffset + limit;
    if (!Number.isFinite(baseLimit) || baseLimit <= 0) {
      return undefined;
    }
    return baseLimit;
  }

  private collectRequiredFieldIds(
    filter: IFilter | undefined,
    sort: ISortItem[] | undefined,
    defaultOrderField?: string
  ): Set<string> {
    const ids = new Set<string>();
    for (const fieldId of extractFieldIdsFromFilter(filter)) {
      ids.add(fieldId);
    }
    sort?.forEach((item) => {
      if (item.fieldId) {
        ids.add(item.fieldId);
      }
    });
    if (defaultOrderField) {
      ids.add(defaultOrderField);
    }
    return ids;
  }

  private buildFieldLookup(table: TableDomain): Map<string, FieldCore> {
    const lookup = new Map<string, FieldCore>();
    for (const field of table.fieldList) {
      lookup.set(field.id, field);
    }
    return lookup;
  }

  private referencesComputedField(
    fieldIds: Set<string>,
    fieldLookup: Map<string, FieldCore>
  ): boolean {
    for (const fieldId of fieldIds) {
      const field = fieldLookup.get(fieldId);
      if (!field) {
        continue;
      }
      if (this.isComputedField(field)) {
        return true;
      }
    }
    return false;
  }

  private createBaseSelectionMap(
    fieldIds: Set<string>,
    fieldLookup: Map<string, FieldCore>,
    alias: string
  ): Map<string, string> {
    const selectionMap = new Map<string, string>();
    for (const fieldId of fieldIds) {
      const field = fieldLookup.get(fieldId);
      if (!field) continue;
      selectionMap.set(field.id, `"${alias}"."${field.dbFieldName}"`);
    }
    return selectionMap;
  }

  private buildSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    state: IMutableQueryBuilderState,
    projection?: string[],
    rawProjection: boolean = false,
    preferRawFieldReferences: boolean = false
  ): this {
    const visitor = new FieldSelectVisitor(
      qb,
      this.dbProvider,
      table,
      state,
      this.dialect,
      undefined,
      rawProjection,
      preferRawFieldReferences
    );
    const alias = getTableAliasFromTable(table);

    for (const field of preservedDbFieldNames) {
      qb.select(`${alias}.${field}`);
    }

    const orderedFields = getOrderedFieldsByProjection(table, projection) as FieldCore[];
    for (const field of orderedFields) {
      const result = field.accept(visitor);
      if (!result) continue;
      if (typeof result === 'string') {
        // Ensure stable keyword casing in formatted SQL snapshots by emitting an explicit
        // uppercase AS for simple column selectors. Use a raw with identifier binding.
        const aliasBinding = field.dbFieldName;
        qb.select(this.knex.raw(`${result} AS ??`, [aliasBinding]));
      } else {
        qb.select({ [field.dbFieldName]: result });
      }
    }

    return this;
  }

  private buildAggregateSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    state: IMutableQueryBuilderState
  ): this {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, state, this.dialect);

    // Add field-specific selections using visitor pattern
    for (const field of table.fields.ordered) {
      field.accept(visitor);
    }

    return this;
  }

  private buildFilter(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    filter: IFilter,
    selectionMap: IReadonlyRecordSelectionMap,
    currentUserId?: string
  ): this {
    // Build field map only from currently selected fields to respect field-level permissions
    // and support both id and name lookups in filters.
    const allowedIds = new Set<string>(Array.from(selectionMap.keys()));
    const map = table.fieldList.reduce(
      (acc, field) => {
        if (!allowedIds.has(field.id)) return acc;
        acc[field.id] = field;
        acc[field.name] = field;
        return acc;
      },
      {} as Record<string, FieldCore>
    );
    this.dbProvider
      .filterQuery(qb, map, filter, { withUserId: currentUserId }, { selectionMap })
      .appendQueryBuilder();
    return this;
  }

  private buildSort(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    sort: ISortItem[],
    selectionMap: IReadonlyRecordSelectionMap
  ): this {
    // Restrict sortable fields to those present in the current selection (permission-respected)
    const allowedIds = new Set<string>(Array.from(selectionMap.keys()));
    const map = table.fieldList.reduce(
      (acc, field) => {
        if (!allowedIds.has(field.id)) return acc;
        acc[field.id] = field;
        acc[field.name] = field;
        return acc;
      },
      {} as Record<string, FieldCore>
    );
    this.dbProvider.sortQuery(qb, map, sort, undefined, { selectionMap }).appendSortBuilder();
    return this;
  }
}

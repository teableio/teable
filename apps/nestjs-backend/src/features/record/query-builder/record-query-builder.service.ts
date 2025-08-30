import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FieldCore, IFilter, ISortItem, TableDomain, Tables } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../../field/constant';
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
import { getTableAliasFromTable } from './record-query-builder.util';

@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  private readonly logger = new Logger(RecordQueryBuilderService.name);
  constructor(
    private readonly tableDomainQueryService: TableDomainQueryService,
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    private readonly prismaService: PrismaService,
    @Inject('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getTableMeta(tableIdOrDbTableName: string) {
    return this.prismaService.tableMeta.findFirstOrThrow({
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
    const visitor = new FieldCteVisitor(qb, this.dbProvider, tables, state);
    visitor.build();

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

    return { qb, table, state, alias: mainTableAlias };
  }

  private async createQueryBuilder(
    from: string,
    tableIdOrDbTableName: string
  ): Promise<{
    qb: Knex.QueryBuilder;
    alias: string;
    table: TableDomain;
    state: IMutableQueryBuilderState;
  }> {
    const tableRaw = await this.getTableMeta(tableIdOrDbTableName);
    if (tableRaw.dbViewName) {
      try {
        return await this.createQueryBuilderFromView(
          tableRaw as { id: string; dbViewName: string }
        );
      } catch (error) {
        this.logger.warn(
          `Failed to create query builder from view ${tableRaw.dbViewName}: ${error}, fallback to table`
        );
        return await this.createQueryBuilderFromTable(from, tableRaw);
      }
    }

    return this.createQueryBuilderFromTable(from, tableRaw);
  }

  async prepareView(
    from: string,
    params: IPrepareViewParams
  ): Promise<{ qb: Knex.QueryBuilder; table: TableDomain }> {
    const { tableIdOrDbTableName } = params;
    const tableRaw = await this.getTableMeta(tableIdOrDbTableName);
    const { qb, table, state } = await this.createQueryBuilderFromTable(from, tableRaw);

    this.buildSelect(qb, table, state);

    return { qb, table };
  }

  async createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }> {
    const { tableIdOrDbTableName, filter, sort, currentUserId } = options;
    const { qb, alias, table, state } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    this.buildSelect(qb, table, state);

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
    const { tableIdOrDbTableName, filter, aggregationFields, groupBy, currentUserId } = options;
    const { qb, table, alias, state } = await this.createQueryBuilder(from, tableIdOrDbTableName);

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
    // Apply aggregation
    this.dbProvider
      .aggregationQuery(
        qb,
        fieldMap,
        aggregationFields,
        { groupBy: groupByFieldIds },
        {
          selectionMap,
          tableDbName: table.dbTableName,
          tableAlias: alias,
        }
      )
      .appendBuilder();

    // Apply grouping if specified
    if (groupBy && groupBy.length > 0) {
      this.dbProvider
        .groupQuery(qb, fieldMap, groupByFieldIds, undefined, { selectionMap })
        .appendGroupBuilder();

      this.buildSort(qb, table, groupBy, selectionMap);
    }

    return { qb, alias, selectionMap };
  }

  private buildSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    state: IMutableQueryBuilderState
  ): this {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, state);
    const alias = getTableAliasFromTable(table);

    for (const field of preservedDbFieldNames) {
      qb.select(`${alias}.${field}`);
    }

    for (const field of table.fields) {
      const result = field.accept(visitor);
      if (result) {
        if (typeof result === 'string') {
          qb.select(this.knex.raw(`${result} AS ??`, [field.dbFieldName]));
        } else {
          qb.select({ [field.dbFieldName]: result });
        }
      }
    }

    return this;
  }

  private buildAggregateSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    state: IMutableQueryBuilderState
  ): this {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, state);

    // Add field-specific selections using visitor pattern
    for (const field of table.fields) {
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
    const map = table.fieldList.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
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
    const map = table.fieldList.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, FieldCore>
    );
    this.dbProvider.sortQuery(qb, map, sort, undefined, { selectionMap }).appendSortBuilder();
    return this;
  }
}

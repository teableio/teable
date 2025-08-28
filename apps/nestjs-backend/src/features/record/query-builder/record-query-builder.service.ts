import { Inject, Injectable } from '@nestjs/common';
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
  IPrepareMaterializedViewParams,
  IRecordQueryBuilder,
  IMutableQueryBuilderState,
  IReadonlyRecordSelectionMap,
} from './record-query-builder.interface';
import { RecordQueryBuilderManager } from './record-query-builder.manager';
import { getTableAliasFromTable } from './record-query-builder.util';

@Injectable()
export class RecordQueryBuilderService implements IRecordQueryBuilder {
  constructor(
    private readonly tableDomainQueryService: TableDomainQueryService,
    // TODO: remove dependency on prisma
    @InjectDbProvider()
    private readonly dbProvider: IDbProvider,
    private readonly prismaService: PrismaService,
    @Inject('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async createQueryBuilder(
    from: string,
    tableIdOrDbTableName: string
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; tables: Tables }> {
    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableIdOrDbTableName }, { dbTableName: tableIdOrDbTableName }] },
      select: { id: true },
    });

    const tables = await this.tableDomainQueryService.getAllRelatedTableDomains(tableRaw.id);
    const table = tables.mustGetEntryTable();
    const mainTableAlias = getTableAliasFromTable(table);
    const qb = this.knex.from({ [mainTableAlias]: from });

    return { qb, alias: mainTableAlias, tables };
  }

  async prepareMaterializedView(
    from: string,
    params: IPrepareMaterializedViewParams
  ): Promise<{ qb: Knex.QueryBuilder; table: TableDomain }> {
    const { tableIdOrDbTableName } = params;
    const { qb, tables } = await this.createQueryBuilder(from, tableIdOrDbTableName);
    const table = tables.mustGetEntryTable();

    return { qb, table };
  }

  async createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string; selectionMap: IReadonlyRecordSelectionMap }> {
    const { tableIdOrDbTableName, filter, sort, currentUserId } = options;
    const { qb, alias, tables } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    const table = tables.mustGetEntryTable();
    const state: IMutableQueryBuilderState = new RecordQueryBuilderManager();
    const visitor = new FieldCteVisitor(qb, this.dbProvider, tables, state);
    visitor.build();

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
    const { qb, tables, alias } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    const table = tables.mustGetEntryTable();
    const state: IMutableQueryBuilderState = new RecordQueryBuilderManager();
    const visitor = new FieldCteVisitor(qb, this.dbProvider, tables, state);
    visitor.build();

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

    // Apply aggregation
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
        .groupQuery(qb, fieldMap, groupBy, undefined, { selectionMap })
        .appendGroupBuilder();
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

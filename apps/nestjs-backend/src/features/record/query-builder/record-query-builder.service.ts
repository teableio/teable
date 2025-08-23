import { Inject, Injectable } from '@nestjs/common';
import type { FieldCore, IFilter, ISortItem, TableDomain, Tables } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../../field/constant';
import { FieldCteVisitor } from '../../field/field-cte-visitor';
import { FieldSelectVisitor } from '../../field/field-select-visitor';
import { TableDomainQueryService } from '../../table-domain/table-domain-query.service';
import type {
  ICreateRecordAggregateBuilderOptions,
  ICreateRecordQueryBuilderOptions,
  IPrepareMaterializedViewParams,
  IRecordQueryBuilder,
  IRecordSelectionMap,
} from './record-query-builder.interface';
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
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    const { tableIdOrDbTableName, filter, sort, currentUserId } = options;
    const { qb, alias, tables } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    const table = tables.mustGetEntryTable();

    const visitor = new FieldCteVisitor(qb, this.dbProvider, tables);
    visitor.build();

    const selectionMap = this.buildSelect(qb, table, visitor.fieldCteMap);

    if (filter) {
      this.buildFilter(qb, table, filter, selectionMap, currentUserId);
    }

    if (sort) {
      this.buildSort(qb, table, sort, selectionMap);
    }

    return { qb, alias };
  }

  async createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    const { tableIdOrDbTableName, filter, aggregationFields, groupBy, currentUserId } = options;
    const { qb, tables, alias } = await this.createQueryBuilder(from, tableIdOrDbTableName);

    const table = tables.mustGetEntryTable();
    const visitor = new FieldCteVisitor(qb, this.dbProvider, tables);
    visitor.build();

    const selectionMap = this.buildAggregateSelect(qb, table, visitor.fieldCteMap);

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
      .aggregationQuery(qb, table.dbTableName, fieldMap, aggregationFields)
      .appendBuilder();

    // Apply grouping if specified
    if (groupBy && groupBy.length > 0) {
      this.dbProvider
        .groupQuery(qb, fieldMap, groupBy, undefined, { selectionMap })
        .appendGroupBuilder();
    }

    return { qb, alias };
  }

  private buildSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    fieldCteMap: ReadonlyMap<string, string>
  ): IRecordSelectionMap {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, fieldCteMap);
    const alias = getTableAliasFromTable(table);

    for (const field of preservedDbFieldNames) {
      qb.select(`${alias}.${field}`);
    }

    for (const field of table.fields) {
      const result = field.accept(visitor);
      if (result) {
        qb.select(result);
      }
    }

    return visitor.getSelectionMap();
  }

  private buildAggregateSelect(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    fieldCteMap: ReadonlyMap<string, string>
  ) {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, fieldCteMap);

    // Add field-specific selections using visitor pattern
    for (const field of table.fields) {
      field.accept(visitor);
    }

    return visitor.getSelectionMap();
  }

  private buildFilter(
    qb: Knex.QueryBuilder,
    table: TableDomain,
    filter: IFilter,
    selectionMap: IRecordSelectionMap,
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
    selectionMap: IRecordSelectionMap
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

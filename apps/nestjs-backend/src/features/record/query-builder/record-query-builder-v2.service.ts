import { Inject, Injectable } from '@nestjs/common';
import type { FieldCore, IFilter, ISortItem, TableDomain } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { preservedDbFieldNames } from '../../field/constant';
import { FieldSelectVisitor } from '../../field/field-select-visitor';
import type {
  ICreateRecordAggregateBuilderOptions,
  ICreateRecordQueryBuilderOptions,
  IRecordQueryBuilder,
  IRecordSelectionMap,
} from './record-query-builder.interface';
import { TableDomainQueryService } from './table-domain';

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

  async createRecordQueryBuilder(
    from: string,
    options: ICreateRecordQueryBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    const { tableIdOrDbTableName, filter, sort, currentUserId } = options;
    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: { OR: [{ id: tableIdOrDbTableName }, { dbTableName: tableIdOrDbTableName }] },
      select: { id: true },
    });

    const tables = await this.tableDomainQueryService.getAllRelatedTableDomains(tableRaw.id);
    const table = tables.mustGetEntryTable();
    const mainTableAlias = table.getTableNameAndId();
    const qb = this.knex.from({ [mainTableAlias]: from });

    const selectionMap = this.buildSelect(qb, table);

    if (filter) {
      this.buildFilter(qb, table, filter, selectionMap, currentUserId);
    }

    if (sort) {
      this.buildSort(qb, table, sort, selectionMap);
    }

    return { qb, alias: mainTableAlias };
  }

  private buildSelect(qb: Knex.QueryBuilder, table: TableDomain): IRecordSelectionMap {
    const visitor = new FieldSelectVisitor(qb, this.dbProvider, table, new Map());
    const alias = table.getTableNameAndId();

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

  buildFilter(
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

  buildSort(
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

  createRecordAggregateBuilder(
    from: string,
    options: ICreateRecordAggregateBuilderOptions
  ): Promise<{ qb: Knex.QueryBuilder; alias: string }> {
    throw new Error('Method not implemented.');
  }
}

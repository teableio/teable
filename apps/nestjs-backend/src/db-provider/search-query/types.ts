import type { CellValueType } from '@teable/core';
import type { TableIndex } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IRecordQueryFilterContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { SearchQueryAbstract } from './abstract';

export type ISearchCellValueType = Exclude<CellValueType, CellValueType.Boolean>;

export type ISearchQueryConstructor = {
  new (
    originQueryBuilder: Knex.QueryBuilder,
    field: IFieldInstance,
    search: [string, string?, boolean?],
    tableIndex: TableIndex[],
    context?: IRecordQueryFilterContext
  ): SearchQueryAbstract;
};

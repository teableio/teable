import type { DriverClient, IFilter } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IOpsData } from '../features/calculation/batch.service';
import type { ITopoLinkOrder } from '../features/calculation/reference.service';
import type { IFieldInstance } from '../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation/aggregation-function.interface';
import type { IFilterQueryInterface } from './filter-query/filter-query.interface';

export interface IDbProvider {
  driver: DriverClient;

  createSchema(schemaName: string): string[] | undefined;

  batchInsertSql(tableName: string, insertData: ReadonlyArray<unknown>): string;

  affectedRecordItemsQuerySql(
    topoOrder: ITopoLinkOrder[],
    originRecordIdItems: { dbTableName: string; id: string }[]
  ): string;

  executeUpdateRecordsSqlList(params: {
    dbTableName: string;
    fieldMap: { [fieldId: string]: IFieldInstance };
    opsData: IOpsData[];
    tempTableName: string;
    columnNames: string[];
    userId: string;
    updateTimeStr: string;
  }): { insertTempTableSql: string; updateRecordSql: string };

  aggregationFunction(dbTableName: string, field: IFieldInstance): IAggregationFunctionInterface;

  filterQuery(
    originKnex: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter | null
  ): IFilterQueryInterface;
}

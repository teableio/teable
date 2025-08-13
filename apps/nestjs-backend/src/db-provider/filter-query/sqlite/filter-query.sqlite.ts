import type { IFilter } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../features/field/model/factory';
import type { IRecordQueryFilterContext } from '../../../features/record/query-builder/record-query-builder.interface';
import type { IDbProvider, IFilterQueryExtra } from '../../db.provider.interface';
import type { AbstractCellValueFilter } from '../cell-value-filter.abstract';
import { AbstractFilterQuery } from '../filter-query.abstract';
import {
  BooleanCellValueFilterAdapter,
  DatetimeCellValueFilterAdapter,
  JsonCellValueFilterAdapter,
  MultipleBooleanCellValueFilterAdapter,
  MultipleDatetimeCellValueFilterAdapter,
  MultipleJsonCellValueFilterAdapter,
  MultipleNumberCellValueFilterAdapter,
  MultipleStringCellValueFilterAdapter,
  NumberCellValueFilterAdapter,
  StringCellValueFilterAdapter,
} from './cell-value-filter';
import type { CellValueFilterSqlite } from './cell-value-filter/cell-value-filter.sqlite';

export class FilterQuerySqlite extends AbstractFilterQuery {
  constructor(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    dbProvider?: IDbProvider,
    context?: IRecordQueryFilterContext
  ) {
    super(originQueryBuilder, fields, filter, extra, dbProvider, context);
  }
  booleanFilter(field: IFieldInstance, context?: IRecordQueryFilterContext): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(field, context);
    }
    return new BooleanCellValueFilterAdapter(field, context);
  }

  numberFilter(field: IFieldInstance, context?: IRecordQueryFilterContext): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(field, context);
    }
    return new NumberCellValueFilterAdapter(field, context);
  }

  dateTimeFilter(
    field: IFieldInstance,
    context?: IRecordQueryFilterContext
  ): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(field, context);
    }
    return new DatetimeCellValueFilterAdapter(field, context);
  }

  stringFilter(field: IFieldInstance, context?: IRecordQueryFilterContext): CellValueFilterSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(field, context);
    }
    return new StringCellValueFilterAdapter(field, context);
  }

  jsonFilter(field: IFieldInstance, context?: IRecordQueryFilterContext): AbstractCellValueFilter {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(field, context);
    }
    return new JsonCellValueFilterAdapter(field, context);
  }
}

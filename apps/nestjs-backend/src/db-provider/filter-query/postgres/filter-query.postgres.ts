import type { FieldCore, IFilter } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQueryFilterContext } from '../../../features/record/query-builder/record-query-builder.interface';
import type { IDbProvider, IFilterQueryExtra } from '../../db.provider.interface';
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
import type { CellValueFilterPostgres } from './cell-value-filter/cell-value-filter.postgres';

export class FilterQueryPostgres extends AbstractFilterQuery {
  constructor(
    originQueryBuilder: Knex.QueryBuilder,
    fields?: { [fieldId: string]: FieldCore },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    dbProvider?: IDbProvider,
    context?: IRecordQueryFilterContext
  ) {
    super(originQueryBuilder, fields, filter, extra, dbProvider, context);
  }
  booleanFilter(field: FieldCore, context?: IRecordQueryFilterContext): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(field, context);
    }
    return new BooleanCellValueFilterAdapter(field, context);
  }

  numberFilter(field: FieldCore, context?: IRecordQueryFilterContext): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(field, context);
    }
    return new NumberCellValueFilterAdapter(field, context);
  }

  dateTimeFilter(field: FieldCore, context?: IRecordQueryFilterContext): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(field, context);
    }
    return new DatetimeCellValueFilterAdapter(field, context);
  }

  stringFilter(field: FieldCore, context?: IRecordQueryFilterContext): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(field, context);
    }
    return new StringCellValueFilterAdapter(field, context);
  }

  jsonFilter(field: FieldCore, context?: IRecordQueryFilterContext): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(field, context);
    }
    return new JsonCellValueFilterAdapter(field, context);
  }
}

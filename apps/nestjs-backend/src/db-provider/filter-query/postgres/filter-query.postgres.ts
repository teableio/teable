import type { IFilter } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../features/field/model/factory';
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
    fields?: { [fieldId: string]: IFieldInstance },
    filter?: IFilter,
    extra?: IFilterQueryExtra,
    dbProvider?: IDbProvider
  ) {
    super(originQueryBuilder, fields, filter, extra, dbProvider);
  }
  booleanFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleBooleanCellValueFilterAdapter(field);
    }
    return new BooleanCellValueFilterAdapter(field);
  }

  numberFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberCellValueFilterAdapter(field);
    }
    return new NumberCellValueFilterAdapter(field);
  }

  dateTimeFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDatetimeCellValueFilterAdapter(field);
    }
    return new DatetimeCellValueFilterAdapter(field);
  }

  stringFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleStringCellValueFilterAdapter(field);
    }
    return new StringCellValueFilterAdapter(field);
  }

  jsonFilter(field: IFieldInstance): CellValueFilterPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonCellValueFilterAdapter(field);
    }
    return new JsonCellValueFilterAdapter(field);
  }
}

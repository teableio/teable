import type { FieldCore } from '@teable/core';
import type { IRecordQuerySortContext } from '../../../features/record/query-builder/record-query-builder.interface';
import { AbstractSortQuery } from '../sort-query.abstract';
import { MultipleDateTimeSortAdapter } from './multiple-value/multiple-datetime-sort.adapter';
import { MultipleJsonSortAdapter } from './multiple-value/multiple-json-sort.adapter';
import { MultipleNumberSortAdapter } from './multiple-value/multiple-number-sort.adapter';
import { DateSortAdapter } from './single-value/date-sort.adapter';
import { JsonSortAdapter } from './single-value/json-sort.adapter';
import { StringSortAdapter } from './single-value/string-sort.adapter';
import { SortFunctionPostgres } from './sort-query.function';

export class SortQueryPostgres extends AbstractSortQuery {
  booleanSort(field: FieldCore, context?: IRecordQuerySortContext): SortFunctionPostgres {
    return new SortFunctionPostgres(this.knex, field, context);
  }

  numberSort(field: FieldCore, context?: IRecordQuerySortContext): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleNumberSortAdapter(this.knex, field, context);
    }
    return new SortFunctionPostgres(this.knex, field, context);
  }

  dateTimeSort(field: FieldCore, context?: IRecordQuerySortContext): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleDateTimeSortAdapter(this.knex, field, context);
    }
    return new DateSortAdapter(this.knex, field, context);
  }

  stringSort(field: FieldCore, context?: IRecordQuerySortContext): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new SortFunctionPostgres(this.knex, field, context);
    }
    return new StringSortAdapter(this.knex, field, context);
  }

  jsonSort(field: FieldCore, context?: IRecordQuerySortContext): SortFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleJsonSortAdapter(this.knex, field, context);
    }
    return new JsonSortAdapter(this.knex, field, context);
  }
}

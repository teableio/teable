import type { FieldCore } from '@teable/core';
import { AbstractAggregationQuery } from '../aggregation-query.abstract';
import type { AggregationFunctionSqlite } from './aggregation-function.sqlite';
import { MultipleValueAggregationAdapter } from './multiple-value/multiple-value-aggregation.adapter';
import { SingleValueAggregationAdapter } from './single-value/single-value-aggregation.adapter';

export class AggregationQuerySqlite extends AbstractAggregationQuery {
  private coreAggregation(field: FieldCore): AggregationFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleValueAggregationAdapter(this.knex, field, this.context);
    }
    return new SingleValueAggregationAdapter(this.knex, field, this.context);
  }

  booleanAggregation(field: FieldCore): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  numberAggregation(field: FieldCore): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  dateTimeAggregation(field: FieldCore): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  stringAggregation(field: FieldCore): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  jsonAggregation(field: FieldCore): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }
}

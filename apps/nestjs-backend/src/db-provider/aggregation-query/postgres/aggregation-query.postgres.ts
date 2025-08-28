import type { FieldCore } from '@teable/core';
import { AbstractAggregationQuery } from '../aggregation-query.abstract';
import type { AggregationFunctionPostgres } from './aggregation-function.postgres';
import { MultipleValueAggregationAdapter } from './multiple-value/multiple-value-aggregation.adapter';
import { SingleValueAggregationAdapter } from './single-value/single-value-aggregation.adapter';

export class AggregationQueryPostgres extends AbstractAggregationQuery {
  private coreAggregation(field: FieldCore): AggregationFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleValueAggregationAdapter(this.knex, field, this.context);
    }
    return new SingleValueAggregationAdapter(this.knex, field, this.context);
  }

  booleanAggregation(field: FieldCore): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  numberAggregation(field: FieldCore): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  dateTimeAggregation(field: FieldCore): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  stringAggregation(field: FieldCore): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  jsonAggregation(field: FieldCore): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }
}

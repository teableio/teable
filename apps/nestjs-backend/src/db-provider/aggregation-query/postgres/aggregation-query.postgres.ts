import type { IFieldInstance } from '../../../features/field/model/factory';
import { AbstractAggregationQuery } from '../aggregation-query.abstract';
import type { AggregationFunctionPostgres } from './aggregation-function.postgres';
import { MultipleValueAggregationAdapter } from './multiple-value/multiple-value-aggregation.adapter';
import { SingleValueAggregationAdapter } from './single-value/single-value-aggregation.adapter';

export class AggregationQueryPostgres extends AbstractAggregationQuery {
  private coreAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleValueAggregationAdapter(this.knex, this.dbTableName, field);
    }
    return new SingleValueAggregationAdapter(this.knex, this.dbTableName, field);
  }

  booleanAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  numberAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  dateTimeAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  stringAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }

  jsonAggregation(field: IFieldInstance): AggregationFunctionPostgres {
    return this.coreAggregation(field);
  }
}

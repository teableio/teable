import type { IFieldInstance } from '../../../features/field/model/factory';
import { AbstractAggregationQuery } from '../aggregation-query.abstract';
import type { AggregationFunctionSqlite } from './aggregation-function.sqlite';
import { MultipleValueAggregationAdapter } from './multiple-value/multiple-value-aggregation.adapter';
import { SingleValueAggregationAdapter } from './single-value/single-value-aggregation.adapter';

export class AggregationQuerySqlite extends AbstractAggregationQuery {
  private coreAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    const { isMultipleCellValue } = field;
    if (isMultipleCellValue) {
      return new MultipleValueAggregationAdapter(this.knex, this.dbTableName, field);
    }
    return new SingleValueAggregationAdapter(this.knex, this.dbTableName, field);
  }

  booleanAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  numberAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  dateTimeAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  stringAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }

  jsonAggregation(field: IFieldInstance): AggregationFunctionSqlite {
    return this.coreAggregation(field);
  }
}

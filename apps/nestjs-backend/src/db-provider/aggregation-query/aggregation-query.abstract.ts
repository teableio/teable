import { BadRequestException } from '@nestjs/common';
import type { FieldCore } from '@teable/core';
import { CellValueType, DbFieldType, getValidStatisticFunc, StatisticsFunc } from '@teable/core';
import type { IAggregationField } from '@teable/openapi';
import type { Knex } from 'knex';
import type { IRecordQueryAggregateContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { IAggregationQueryExtra } from '../db.provider.interface';
import type { AbstractAggregationFunction } from './aggregation-function.abstract';
import type { IAggregationQueryInterface } from './aggregation-query.interface';

export abstract class AbstractAggregationQuery implements IAggregationQueryInterface {
  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: FieldCore },
    protected readonly aggregationFields?: IAggregationField[],
    protected readonly extra?: IAggregationQueryExtra,
    protected readonly context?: IRecordQueryAggregateContext
  ) {}

  get dbTableName() {
    return this.context?.tableDbName;
  }

  get tableAlias() {
    return this.context?.tableAlias;
  }

  appendBuilder(): Knex.QueryBuilder {
    const queryBuilder = this.originQueryBuilder;

    if (!this.aggregationFields || !this.aggregationFields.length) {
      return queryBuilder;
    }

    this.validAggregationField(this.aggregationFields, this.extra);

    this.aggregationFields.forEach(({ fieldId, statisticFunc, alias }) => {
      // TODO: handle all func type
      if (statisticFunc === StatisticsFunc.Count && fieldId === '*') {
        const field = Object.values(this.fields ?? {})[0];
        if (!field) {
          return queryBuilder;
        }
        this.getAggregationAdapter(field).compiler(queryBuilder, statisticFunc, alias);
        return;
      }
      const field = this.fields && this.fields[fieldId];
      if (!field) {
        return queryBuilder;
      }

      this.getAggregationAdapter(field).compiler(queryBuilder, statisticFunc, alias);
    });

    // Emit GROUP BY and grouped select columns when requested via extra.groupBy
    if (this.extra?.groupBy && this.extra.groupBy.length > 0) {
      const groupByExprs = this.extra.groupBy
        .map((fieldId) => {
          const mapped = this.context?.selectionMap.get(fieldId) as string | undefined;
          if (mapped) return mapped;
          const dbFieldName = this.fields?.[fieldId]?.dbFieldName;
          if (!dbFieldName) return null;
          return this.tableAlias ? `"${this.tableAlias}"."${dbFieldName}"` : `"${dbFieldName}"`;
        })
        .filter(Boolean) as string[];

      for (const expr of groupByExprs) {
        queryBuilder.groupByRaw(expr);
      }

      for (const fieldId of this.extra.groupBy) {
        const field = this.fields?.[fieldId];
        if (!field) continue;
        const mapped =
          (this.context?.selectionMap.get(fieldId) as string | undefined) ??
          (this.tableAlias
            ? `"${this.tableAlias}"."${field.dbFieldName}"`
            : `"${field.dbFieldName}"`);
        queryBuilder.select(this.knex.raw(`${mapped} AS ??`, [field.dbFieldName]));
      }

      // Ensure no stray ORDER BY (e.g., inherited from view default sort) remains after grouping
      queryBuilder.clearOrder();
    }

    return queryBuilder;
  }

  private validAggregationField(
    aggregationFields: IAggregationField[],
    _extra?: IAggregationQueryExtra
  ) {
    aggregationFields
      .filter(({ fieldId }) => !!fieldId && fieldId !== '*')
      .forEach(({ fieldId, statisticFunc }) => {
        const field = this.fields && this.fields[fieldId];

        if (!field) {
          throw new BadRequestException(`field: '${fieldId}' is invalid`);
        }

        const validStatisticFunc = getValidStatisticFunc(field);
        if (statisticFunc && !validStatisticFunc.includes(statisticFunc)) {
          throw new BadRequestException(
            `field: '${fieldId}', aggregation func: '${statisticFunc}' is invalid, Only the following func are allowed: [${validStatisticFunc}]`
          );
        }
      });
  }

  private getAggregationAdapter(field: FieldCore): AbstractAggregationFunction {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.Boolean:
        return this.booleanAggregation(field);
      case CellValueType.Number:
        return this.numberAggregation(field);
      case CellValueType.DateTime:
        return this.dateTimeAggregation(field);
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.jsonAggregation(field);
        }
        return this.stringAggregation(field);
      }
    }
  }

  abstract booleanAggregation(field: FieldCore): AbstractAggregationFunction;

  abstract numberAggregation(field: FieldCore): AbstractAggregationFunction;

  abstract dateTimeAggregation(field: FieldCore): AbstractAggregationFunction;

  abstract stringAggregation(field: FieldCore): AbstractAggregationFunction;

  abstract jsonAggregation(field: FieldCore): AbstractAggregationFunction;
}

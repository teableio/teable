/* eslint-disable sonarjs/no-identical-functions */
import {
  DateFormattingPreset,
  isFieldReferenceValue,
  type IDateFieldOptions,
  type IDateFilter,
  type IDatetimeFormatting,
  type IFilterOperator,
  type IFilterValue,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class DatetimeCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceEquality(builderClient, ref, 'is');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} BETWEEN ? AND ?`, dateTimeRange);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceEquality(builderClient, ref, 'isNot');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );

    // Wrap conditions in a nested `.whereRaw()` to ensure proper SQL grouping with parentheses,
    // generating `WHERE ("data" NOT BETWEEN ... OR "data" IS NULL) AND other_query`.
    builderClient.whereRaw(
      `(${this.tableColumnRef} NOT BETWEEN ? AND ? OR ${this.tableColumnRef} IS NULL)`,
      dateTimeRange
    );
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceComparison(builderClient, ref, 'gt');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} > ?`, [dateTimeRange[1]]);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceComparison(builderClient, ref, 'gte');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} >= ?`, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceComparison(builderClient, ref, 'lt');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} < ?`, [dateTimeRange[0]]);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      return this.applyFieldReferenceComparison(builderClient, ref, 'lte');
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} <= ?`, [dateTimeRange[1]]);
    return builderClient;
  }

  isWithInOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      return super.isOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    const { options } = this.field;

    const dateTimeRange = this.getFilterDateTimeRange(
      options as IDateFieldOptions,
      value as IDateFilter
    );
    builderClient.whereRaw(`${this.tableColumnRef} BETWEEN ? AND ?`, dateTimeRange);
    return builderClient;
  }

  private extractFormatting(): IDatetimeFormatting | undefined {
    const options = this.field.options as { formatting?: IDatetimeFormatting } | undefined;
    return options?.formatting;
  }

  private determineDateUnit(formatting?: IDatetimeFormatting): 'day' | 'month' | 'year' {
    const dateFormat = formatting?.date as DateFormattingPreset | undefined;
    switch (dateFormat) {
      case DateFormattingPreset.Y:
        return 'year';
      case DateFormattingPreset.YM:
      case DateFormattingPreset.M:
        return 'month';
      default:
        return 'day';
    }
  }

  private wrapWithTimeZone(expr: string, formatting?: IDatetimeFormatting): string {
    const tz = (formatting?.timeZone || 'UTC').replace(/'/g, "''");
    return `(${expr}) AT TIME ZONE '${tz}'`;
  }

  private applyFieldReferenceEquality(
    builderClient: Knex.QueryBuilder,
    referenceExpression: string,
    mode: 'is' | 'isNot'
  ): Knex.QueryBuilder {
    const formatting = this.extractFormatting();
    const unit = this.determineDateUnit(formatting);

    const left = this.buildTruncatedExpression(this.tableColumnRef, unit, formatting);
    const right = this.buildTruncatedExpression(referenceExpression, unit, formatting);

    if (mode === 'is') {
      builderClient.whereRaw(`${left} = ${right}`);
    } else {
      builderClient.whereRaw(`${left} IS DISTINCT FROM ${right}`);
    }

    return builderClient;
  }

  private applyFieldReferenceComparison(
    builderClient: Knex.QueryBuilder,
    referenceExpression: string,
    comparator: 'gt' | 'gte' | 'lt' | 'lte'
  ): Knex.QueryBuilder {
    const formatting = this.extractFormatting();
    const unit = this.determineDateUnit(formatting);

    const left = this.buildTruncatedExpression(this.tableColumnRef, unit, formatting);
    const right = this.buildTruncatedExpression(referenceExpression, unit, formatting);

    const comparatorMap = {
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
    } as const;

    builderClient.whereRaw(`${left} ${comparatorMap[comparator]} ${right}`);
    return builderClient;
  }

  private buildTruncatedExpression(
    expression: string,
    unit: 'day' | 'month' | 'year',
    formatting?: IDatetimeFormatting
  ): string {
    return `DATE_TRUNC('${unit}', ${this.wrapWithTimeZone(expression, formatting)})`;
  }
}

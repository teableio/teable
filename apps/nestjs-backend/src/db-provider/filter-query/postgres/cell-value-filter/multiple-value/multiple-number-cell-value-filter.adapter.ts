import type {
  FieldCore,
  IFieldReferenceValue,
  IFilterOperator,
  ILiteralValue,
  ILiteralValueList,
} from '@teable/core';
import { isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleNumberCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(`jsonb_exists_any(${selfArray}, ${referenceTextArray})`);
      return builderClient;
    }

    builderClient.whereRaw(`${this.tableColumnRef}::jsonb @> jsonb_build_array(?::numeric)`, [
      Number(value),
    ]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(
        `NOT jsonb_exists_any(COALESCE(${selfArray}, '[]'::jsonb), ${referenceTextArray})`
      );
      return builderClient;
    }

    builderClient.whereRaw(
      `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @> jsonb_build_array(?::numeric)`,
      [Number(value)]
    );
    return builderClient;
  }

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(this.buildComparisonSql(selfArray, referenceArray, '>'));
      return builderClient;
    }

    builderClient.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
        WHERE elem::numeric > ?::numeric
      )
      `,
      [Number(value)]
    );
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(this.buildComparisonSql(selfArray, referenceArray, '>='));
      return builderClient;
    }

    builderClient.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
        WHERE elem::numeric >= ?::numeric
      )
      `,
      [Number(value)]
    );
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(this.buildComparisonSql(selfArray, referenceArray, '<'));
      return builderClient;
    }

    builderClient.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
        WHERE elem::numeric < ?::numeric
      )
      `,
      [Number(value)]
    );
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(this.buildComparisonSql(selfArray, referenceArray, '<='));
      return builderClient;
    }

    builderClient.whereRaw(
      `
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
        WHERE elem::numeric <= ?::numeric
      )
      `,
      [Number(value)]
    );
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(`jsonb_exists_any(${selfArray}, ${referenceTextArray})`);
      return builderClient;
    }

    const numericList = (value as ILiteralValueList).map((entry) => Number(entry));
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb \\?| ARRAY[${this.createSqlPlaceholders(numericList)}]`,
      numericList
    );
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(
        `NOT jsonb_exists_any(COALESCE(${selfArray}, '[]'::jsonb), ${referenceTextArray})`
      );
      return builderClient;
    }

    const numericList = (value as ILiteralValueList).map((entry) => Number(entry));
    builderClient.whereRaw(
      `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb \\?| ARRAY[${this.createSqlPlaceholders(numericList)}]`,
      numericList
    );
    return builderClient;
  }

  hasAllOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(`jsonb_exists_all(${selfArray}, ${referenceTextArray})`);
      return builderClient;
    }

    const numericList = (value as ILiteralValueList).map((entry) => Number(entry));
    builderClient.whereRaw(
      `jsonb_exists_all(${this.tableColumnRef}::jsonb, ARRAY[${this.createSqlPlaceholders(numericList)}])`,
      numericList
    );
    return builderClient;
  }

  isExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(
        `${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray}`
      );
      return builderClient;
    }

    const numericList = (value as ILiteralValueList).map((entry) => Number(entry));
    const placeholders = this.createSqlPlaceholders(numericList);
    builderClient.whereRaw(
      `${this.tableColumnRef}::jsonb @> to_jsonb(ARRAY[${placeholders}]) AND to_jsonb(ARRAY[${placeholders}]) @> ${this.tableColumnRef}::jsonb`,
      [...numericList, ...numericList]
    );
    return builderClient;
  }

  isNotExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceArray = this.buildReferenceJsonArray(value);
      builderClient.whereRaw(
        `NOT (${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray})`
      );
      return builderClient;
    }

    const numericList = (value as ILiteralValueList).map((entry) => Number(entry));
    const placeholders = this.createSqlPlaceholders(numericList);
    builderClient.whereRaw(
      `(NOT (${this.tableColumnRef}::jsonb @> to_jsonb(ARRAY[${placeholders}]) AND to_jsonb(ARRAY[${placeholders}]) @> ${this.tableColumnRef}::jsonb) OR ${this.tableColumnRef} IS NULL)`,
      [...numericList, ...numericList]
    );
    return builderClient;
  }

  private buildJsonArrayExpression(columnExpression: string, field: FieldCore): string {
    if (field.isMultipleCellValue) {
      return `COALESCE(${columnExpression}, '[]'::jsonb)`;
    }
    return `jsonb_build_array(${columnExpression})`;
  }

  private buildReferenceJsonArray(value: IFieldReferenceValue): string {
    const referenceExpression = this.resolveFieldReference(value);
    const referenceField = this.getComparableReferenceField(value);
    return this.buildJsonArrayExpression(referenceExpression, referenceField);
  }

  private buildTextArrayExpression(jsonArrayExpression: string): string {
    return `COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(${jsonArrayExpression}) AS value), ARRAY[]::text[])`;
  }

  private buildComparisonSql(
    selfArray: string,
    referenceArray: string,
    operator: '>' | '>=' | '<' | '<='
  ): string {
    return `EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(${selfArray}) AS self_elem(value)
      CROSS JOIN jsonb_array_elements_text(${referenceArray}) AS ref_elem(value)
      WHERE (self_elem.value)::numeric ${operator} (ref_elem.value)::numeric
    )`;
  }
}

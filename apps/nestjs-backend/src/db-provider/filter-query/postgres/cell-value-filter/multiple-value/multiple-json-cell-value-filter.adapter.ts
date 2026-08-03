import type {
  FieldCore,
  IFieldReferenceValue,
  IFilterOperator,
  ILiteralValue,
  ILiteralValueList,
} from '@teable/core';
import { FieldType, isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
import { escapeJsonbRegex, escapePostgresRegex } from '../../../../../utils/postgres-regex-escape';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class MultipleJsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      builderClient.whereRaw(
        `${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray}`
      );
      return builderClient;
    }

    const { type } = this.field;
    const literalValues: ILiteralValueList = Array.isArray(value)
      ? (value as ILiteralValueList)
      : ([value] as ILiteralValueList);

    if (isUserOrLink(type)) {
      return this.isAnyOfOperatorHandler(builderClient, _operator, literalValues, _dbProvider);
    }

    if (type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: literalValues[0] });

      builderClient.whereRaw(`${this.tableColumnRef}::jsonb @> ?::jsonb`, [parseValue]);
    } else {
      const escapedValue = escapePostgresRegex(String(literalValues[0]));
      builderClient.whereRaw(
        `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${this.tableColumnRef}::jsonb) as elem
        WHERE elem ~* ?
      )`,
        [`^${escapedValue}$`]
      );
    }
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      builderClient.whereRaw(
        `NOT (${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray})`
      );
      return builderClient;
    }

    const { type } = this.field;
    const literalValues: ILiteralValueList = Array.isArray(value)
      ? (value as ILiteralValueList)
      : ([value] as ILiteralValueList);

    if (isUserOrLink(type)) {
      return this.isNoneOfOperatorHandler(builderClient, _operator, literalValues, _dbProvider);
    }

    if (type === FieldType.Link) {
      const parseValue = JSON.stringify({ title: literalValues[0] });

      builderClient.whereRaw(`NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @> ?::jsonb`, [
        parseValue,
      ]);
    } else {
      const escapedValue = escapePostgresRegex(String(literalValues[0]));
      builderClient.whereRaw(
        `NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(${this.tableColumnRef}, '[]')::jsonb) as elem
          WHERE elem ~* ?
        )`,
        [`^${escapedValue}$`]
      );
    }
    return builderClient;
  }

  isExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      builderClient.whereRaw(
        `${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray}`
      );
      return builderClient;
    }

    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id')`,
        [...value, ...value]
      );
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> ${this.tableColumnRef}::jsonb`,
        [...value, ...value]
      );
    }
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(`jsonb_exists_any(${selfArray}, ${referenceTextArray})`);
      return builderClient;
    }

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_exists_any(jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(`jsonb_exists_any(${this.tableColumnRef}::jsonb, ?::text[])`, [value]);
    }
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      const referenceTextArray = this.buildTextArrayExpression(referenceArray);
      builderClient.whereRaw(
        `NOT jsonb_exists_any(COALESCE(${selfArray}, '[]'::jsonb), ${referenceTextArray})`
      );
      return builderClient;
    }

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `NOT jsonb_exists_any(jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(
        `NOT jsonb_exists_any(COALESCE(${this.tableColumnRef}, '[]')::jsonb, ?::text[])`,
        [value]
      );
    }
    return builderClient;
  }

  hasAllOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      builderClient.whereRaw(`${selfArray} @> ${referenceArray}`);
      return builderClient;
    }

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_exists_all(jsonb_path_query_array(${this.tableColumnRef}::jsonb, '$[*].id'), ?::text[])`,
        [value]
      );
    } else {
      builderClient.whereRaw(`jsonb_exists_all(${this.tableColumnRef}::jsonb, ?::text[])`, [value]);
    }
    return builderClient;
  }

  isNotExactlyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    if (isFieldReferenceValue(value)) {
      const referenceArray = this.buildReferenceJsonArray(value);
      const selfArray = this.buildJsonArrayExpression(this.tableColumnRef, this.field);
      builderClient.whereRaw(
        `NOT (${selfArray} @> ${referenceArray} AND ${referenceArray} @> ${selfArray})`
      );
      return builderClient;
    }

    const { type } = this.field;
    const sqlPlaceholders = this.createSqlPlaceholders(value);

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `(NOT (jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id') @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> jsonb_path_query_array(COALESCE(${this.tableColumnRef}, '[]')::jsonb, '$[*].id')) OR ${this.tableColumnRef} IS NULL)`,
        [...value, ...value]
      );
    } else {
      builderClient.whereRaw(
        `(NOT (COALESCE(${this.tableColumnRef}, '[]')::jsonb @> to_jsonb(ARRAY[${sqlPlaceholders}]) AND to_jsonb(ARRAY[${sqlPlaceholders}]) @> COALESCE(${this.tableColumnRef}, '[]')::jsonb) OR ${this.tableColumnRef} IS NULL)`,
        [...value, ...value]
      );
    }

    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @\\? '$[*].title \\? (@ like_regex "${String(escapedValue)}" flag "i")'`
      );
    } else {
      builderClient.whereRaw(
        `${this.tableColumnRef}::jsonb @\\? '$[*] \\? (@ like_regex "${String(escapedValue)}" flag "i")'`
      );
    }
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const escapedValue = escapeJsonbRegex(String(value));

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*].title \\? (@ like_regex "${String(escapedValue)}" flag "i")'`
      );
    } else {
      builderClient.whereRaw(
        `NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb @\\? '$[*] \\? (@ like_regex "${String(escapedValue)}" flag "i")'`
      );
    }
    return builderClient;
  }

  private buildReferenceJsonArray(value: IFieldReferenceValue): string {
    const referenceExpression = this.resolveFieldReference(value);
    const referenceField = this.getComparableReferenceField(value);
    return this.buildJsonArrayExpression(referenceExpression, referenceField);
  }

  private buildJsonArrayExpression(columnExpression: string, field?: FieldCore): string {
    const targetField = field ?? this.field;
    const fallback = targetField.isMultipleCellValue ? "'[]'::jsonb" : "'null'::jsonb";
    return `jsonb_path_query_array(COALESCE(${columnExpression}, ${fallback}), ${this.getJsonPath(
      targetField
    )})`;
  }

  private buildTextArrayExpression(jsonArrayExpression: string): string {
    return `COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(${jsonArrayExpression}) AS value), ARRAY[]::text[])`;
  }

  private getJsonPath(field: FieldCore): string {
    if (isUserOrLink(field.type)) {
      return field.isMultipleCellValue ? "'$[*].id'" : "'$.id'";
    }
    return field.isMultipleCellValue ? "'$[*]'" : "'$'";
  }
}

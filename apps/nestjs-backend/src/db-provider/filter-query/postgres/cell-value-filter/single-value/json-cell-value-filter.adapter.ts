/* eslint-disable sonarjs/no-duplicate-string */
import type {
  FieldCore,
  IFieldReferenceValue,
  IFilterOperator,
  IFilterValue,
  ILiteralValue,
  ILiteralValueList,
} from '@teable/core';
import { FieldType, isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import { isUserOrLink } from '../../../../../utils/is-user-or-link';
import { escapeJsonPathRegexLiteral } from '../../../../../utils/postgres-regex-escape';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterPostgres } from '../cell-value-filter.postgres';

export class JsonCellValueFilterAdapter extends CellValueFilterPostgres {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);

      if (isUserOrLink(type)) {
        const referenceField = this.getComparableReferenceField(value);
        if (referenceField.isMultipleCellValue) {
          const leftIdExpr = `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id')`;
          const refArrayExpr = `jsonb_path_query_array(COALESCE(${ref}, '[]'::jsonb), '$[*].id')`;
          builderClient.whereRaw(
            `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${refArrayExpr}) AS ref_id WHERE ref_id = ${leftIdExpr})`
          );
          return builderClient;
        }
        builderClient.whereRaw(
          `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id') = jsonb_extract_path_text(${ref}::jsonb, 'id')`
        );
        return builderClient;
      }

      return super.isOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    if (isUserOrLink(type)) {
      builderClient.whereRaw(`jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id') = ?`, [
        value,
      ]);
    } else {
      builderClient.whereRaw(
        `jsonb_path_exists(${this.tableColumnRef}::jsonb, ?::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
        ['$[*] ? (@ like_regex $value flag "i")', value]
      );
    }
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { type } = this.field;

    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);

      if (isUserOrLink(type)) {
        const referenceField = this.getComparableReferenceField(value);
        if (referenceField.isMultipleCellValue) {
          const leftIdExpr = `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id')`;
          const refArrayExpr = `jsonb_path_query_array(COALESCE(${ref}, '[]'::jsonb), '$[*].id')`;
          builderClient.whereRaw(
            `NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${refArrayExpr}) AS ref_id WHERE ref_id = ${leftIdExpr})`
          );
          return builderClient;
        }
        builderClient.whereRaw(
          `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id') IS DISTINCT FROM jsonb_extract_path_text(${ref}::jsonb, 'id')`
        );
        return builderClient;
      }

      return super.isNotOperatorHandler(builderClient, _operator, value, dbProvider);
    }

    if (isUserOrLink(type)) {
      builderClient.whereRaw(
        `jsonb_extract_path_text(COALESCE(${this.tableColumnRef}, '{}'::jsonb), 'id') IS DISTINCT FROM ?`,
        [value]
      );
    } else {
      builderClient.whereRaw(
        `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, ?::jsonpath, jsonb_build_object('value', to_jsonb(?::text)))`,
        ['$[*] ? (@ like_regex $value flag "i")', value]
      );
    }
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue
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
        `jsonb_extract_path_text(${this.tableColumnRef}::jsonb, 'id') IN (${this.createSqlPlaceholders(value)})`,
        value
      );
    } else {
      builderClient.whereRaw(
        String.raw`${this.tableColumnRef}::jsonb \?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        value
      );
    }
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: ILiteralValueList | IFieldReferenceValue
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
        `COALESCE(jsonb_extract_path_text(COALESCE(${this.tableColumnRef}, '{}')::jsonb, 'id'), '') NOT IN (${this.createSqlPlaceholders(
          value
        )})`,
        value
      );
    } else {
      builderClient.whereRaw(
        String.raw`NOT COALESCE(${this.tableColumnRef}, '[]')::jsonb \?| ARRAY[${this.createSqlPlaceholders(value)}]`,
        value
      );
    }
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    // Bind the whole jsonpath as a parameter; the filter value must never be
    // spliced into the SQL text (a single quote would close the literal and
    // inject SQL).
    const jsonPath = this.buildLikeRegexJsonPath(value);
    builderClient.whereRaw(`jsonb_path_exists(${this.tableColumnRef}::jsonb, ?::jsonpath)`, [
      jsonPath,
    ]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { type } = this.field;
    const jsonPath = this.buildLikeRegexJsonPath(value);

    if (type === FieldType.Link) {
      builderClient.whereRaw(
        `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '{}')::jsonb, ?::jsonpath)`,
        [jsonPath]
      );
    } else {
      builderClient.whereRaw(
        `NOT jsonb_path_exists(COALESCE(${this.tableColumnRef}, '[]')::jsonb, ?::jsonpath)`,
        [jsonPath]
      );
    }
    return builderClient;
  }

  /**
   * Case-insensitive substring match over the link title (`$.title`) or over
   * the elements of a JSON array. The value is escaped for the jsonpath string
   * literal only; the caller binds the returned path as a parameter.
   */
  private buildLikeRegexJsonPath(value: IFilterValue): string {
    const pattern = escapeJsonPathRegexLiteral(String(value));
    const selector = this.field.type === FieldType.Link ? '$.title' : '$[*]';
    return `${selector} ? (@ like_regex "${pattern}" flag "i")`;
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

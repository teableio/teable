import type {
  IFieldReferenceValue,
  IFilterOperator,
  IFilterValue,
  ILiteralValue,
  ILiteralValueList,
} from '@teable/core';
import { FieldType, isFieldReferenceValue } from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../../db.provider.interface';
import { CellValueFilterSqlite } from '../cell-value-filter.sqlite';

export class JsonCellValueFilterAdapter extends CellValueFilterSqlite {
  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);

    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);

      if (
        [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(
          this.field.type
        )
      ) {
        const referenceField = this.getComparableReferenceField(value);
        if (referenceField.isMultipleCellValue) {
          const refColumn = "json_extract(json_each.value, '$.id')";
          builderClient.whereRaw(
            `exists (select 1 from json_each(${ref}) where lower(${refColumn}) = lower(${jsonColumn}))`
          );
          return builderClient;
        }
        const refColumn = `json_extract(${ref}, '$.id')`;
        builderClient.whereRaw(`lower(${jsonColumn}) = lower(${refColumn})`);
        return builderClient;
      }

      return super.isOperatorHandler(builderClient, operator, value, dbProvider);
    }

    const sql = `lower(${jsonColumn}) = lower(?)`;
    builderClient.whereRaw(sql, [value]);
    return builderClient;
  }

  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValue | IFieldReferenceValue,
    dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);

    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);

      if (
        [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy, FieldType.Link].includes(
          this.field.type
        )
      ) {
        const referenceField = this.getComparableReferenceField(value);
        if (referenceField.isMultipleCellValue) {
          const refColumn = "json_extract(json_each.value, '$.id')";
          builderClient.whereRaw(
            `not exists (select 1 from json_each(${ref}) where lower(${refColumn}) = lower(${jsonColumn}))`
          );
          return builderClient;
        }
        const refColumn = `json_extract(${ref}, '$.id')`;
        builderClient.whereRaw(`lower(ifnull(${jsonColumn}, '')) != lower(${refColumn})`);
        return builderClient;
      }

      return super.isNotOperatorHandler(builderClient, operator, value, dbProvider);
    }

    const sql = `lower(ifnull(${jsonColumn}, '')) != lower(?)`;
    builderClient.whereRaw(sql, [value]);
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `${jsonColumn} in (${this.createSqlPlaceholders(value)})`;
    builderClient.whereRaw(sql, [...value]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: ILiteralValueList
  ): Knex.QueryBuilder {
    const jsonColumn = this.getJsonQueryColumn(this.field, operator);
    const sql = `ifnull(${jsonColumn}, '') not in (${this.createSqlPlaceholders(value)})`;
    builderClient.whereRaw(sql, [...value]);
    return builderClient;
  }

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const sql = `${this.getJsonQueryColumn(this.field, operator)} like ?`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const sql = `ifnull(${this.getJsonQueryColumn(this.field, operator)}, '') not like ?`;
    builderClient.whereRaw(sql, [`%${value}%`]);
    return builderClient;
  }
}

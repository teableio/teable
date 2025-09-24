import type { FieldCore, IFilterOperator, IFilterValue } from '@teable/core';
import {
  CellValueType,
  contains,
  doesNotContain,
  FieldType,
  isFieldReferenceValue,
  isNoneOf,
  literalValueListSchema,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IDbProvider } from '../../../db.provider.interface';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterSqlite extends AbstractCellValueFilter {
  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    if (isFieldReferenceValue(value)) {
      const ref = this.resolveFieldReference(value);
      builderClient.whereRaw(`ifnull(${this.tableColumnRef}, '') != ${ref}`);
      return builderClient;
    }
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.whereRaw(`ifnull(${this.tableColumnRef}, '') != ?`, [parseValue]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, doesNotContain.value);
    builderClient.whereRaw(`ifnull(${this.tableColumnRef}, '') not like ?`, [`%${value}%`]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue,
    _dbProvider: IDbProvider
  ): Knex.QueryBuilder {
    this.ensureLiteralValue(value, isNoneOf.value);
    const valueList = literalValueListSchema.parse(value);

    const sql = `ifnull(${this.tableColumnRef}, '') not in (${this.createSqlPlaceholders(valueList)})`;
    builderClient.whereRaw(sql, [...valueList]);
    return builderClient;
  }

  protected getJsonQueryColumn(field: FieldCore, operator: IFilterOperator): string {
    const defaultJsonColumn = 'json_each.value';
    if (field.type === FieldType.Link) {
      const object = field.isMultipleCellValue ? defaultJsonColumn : field.dbFieldName;
      const path = ([contains.value, doesNotContain.value] as string[]).includes(operator)
        ? '$.title'
        : '$.id';

      return `json_extract(${object}, '${path}')`;
    }
    if ([FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(field.type)) {
      const object = field.isMultipleCellValue ? defaultJsonColumn : field.dbFieldName;
      const path = '$.id';

      return `json_extract(${object}, '${path}')`;
    } else if (field.type === FieldType.Attachment) {
      return defaultJsonColumn;
    }
    return defaultJsonColumn;
  }
}

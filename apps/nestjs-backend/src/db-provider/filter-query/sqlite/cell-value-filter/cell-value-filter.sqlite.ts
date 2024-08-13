import type { IFilterOperator, IFilterValue } from '@teable/core';
import {
  CellValueType,
  contains,
  doesNotContain,
  FieldType,
  literalValueListSchema,
} from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../features/field/model/factory';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterSqlite extends AbstractCellValueFilter {
  isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.whereRaw(`ifnull(${this.tableColumnRef}, '') != ?`, [parseValue]);
    return builderClient;
  }

  doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.whereRaw(`ifnull(${this.tableColumnRef}, '') not like ?`, [`%${value}%`]);
    return builderClient;
  }

  isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const valueList = literalValueListSchema.parse(value);

    const sql = `ifnull(${this.tableColumnRef}, '') not in (${this.createSqlPlaceholders(valueList)})`;
    builderClient.whereRaw(sql, [...valueList]);
    return builderClient;
  }

  protected getJsonQueryColumn(field: IFieldInstance, operator: IFilterOperator): string {
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

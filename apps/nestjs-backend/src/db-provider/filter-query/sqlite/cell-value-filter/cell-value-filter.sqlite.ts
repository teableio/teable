import type { IFilter, IFilterOperator, IFilterValue } from '@teable-group/core';
import { contains, doesNotContain, FieldType, literalValueListSchema } from '@teable-group/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../../features/field/model/factory';
import { AbstractCellValueFilter } from '../../cell-value-filter.abstract';

export class CellValueFilterSqlite extends AbstractCellValueFilter {
  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`ifnull(${field.dbFieldName}, '') != ?`, [value]);
    return queryBuilder;
  }

  doesNotContainOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`ifnull(${field.dbFieldName}, '') not like ?`, [`%${value}%`]);
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: {
      field: IFieldInstance;
      operator: IFilterOperator;
      value: IFilterValue;
    }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const valueList = literalValueListSchema.parse(value);

    const sql = `ifnull(${field.dbFieldName}, '') not in (${this.createSqlPlaceholders(
      valueList
    )})`;
    queryBuilder.whereRaw(sql, [...valueList]);
    return queryBuilder;
  }

  protected tableDbFieldName(field: IFieldInstance): string {
    return `${this._table}.${field.dbFieldName}`;
  }
  protected getJsonQueryColumn(field: IFieldInstance, operator: IFilterOperator): string {
    const defaultJsonColumn = 'json_each.value';
    if (field.type === FieldType.Link) {
      const object = field.isMultipleCellValue ? defaultJsonColumn : field.dbFieldName;
      const path = ([contains.value, doesNotContain.value] as string[]).includes(operator)
        ? '$.title'
        : '$.id';

      return `json_extract(${object}, '${path}')`;
    } else if (field.type === FieldType.Attachment) {
      return defaultJsonColumn;
    }
    return defaultJsonColumn;
  }
}

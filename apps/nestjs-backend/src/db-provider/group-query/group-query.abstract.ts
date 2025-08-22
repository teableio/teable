import { Logger } from '@nestjs/common';
import type { FieldCore } from '@teable/core';
import { CellValueType } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQueryGroupContext } from '../../features/record/query-builder/record-query-builder.interface';
import type { IGroupQueryInterface, IGroupQueryExtra } from './group-query.interface';

export abstract class AbstractGroupQuery implements IGroupQueryInterface {
  private logger = new Logger(AbstractGroupQuery.name);

  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fieldMap?: { [fieldId: string]: FieldCore },
    protected readonly groupFieldIds?: string[],
    protected readonly extra?: IGroupQueryExtra,
    protected readonly context?: IRecordQueryGroupContext
  ) {}

  appendGroupBuilder(): Knex.QueryBuilder {
    return this.parseGroups(this.originQueryBuilder, this.groupFieldIds);
  }

  protected getTableColumnName(field: FieldCore): string {
    const selection = this.context?.selectionMap.get(field.id);
    if (selection) {
      return selection as string;
    }
    return field.dbFieldName;
  }

  private parseGroups(
    queryBuilder: Knex.QueryBuilder,
    groupFieldIds?: string[]
  ): Knex.QueryBuilder {
    if (!groupFieldIds || !groupFieldIds.length) {
      return queryBuilder;
    }

    groupFieldIds.forEach((fieldId) => {
      const field = this.fieldMap?.[fieldId];

      if (!field) {
        return queryBuilder;
      }
      this.getGroupAdapter(field);
    });

    return queryBuilder;
  }

  private getGroupAdapter(field: FieldCore): Knex.QueryBuilder {
    if (!field) return this.originQueryBuilder;
    const { cellValueType, isMultipleCellValue, isStructuredCellValue } = field;

    if (isMultipleCellValue) {
      switch (cellValueType) {
        case CellValueType.DateTime:
          return this.multipleDate(field);
        case CellValueType.Number:
          return this.multipleNumber(field);
        case CellValueType.String:
          if (isStructuredCellValue) {
            return this.json(field);
          }
          return this.string(field);
        default:
          return this.originQueryBuilder;
      }
    }

    switch (cellValueType) {
      case CellValueType.DateTime:
        return this.date(field);
      case CellValueType.Number:
        return this.number(field);
      case CellValueType.Boolean:
      case CellValueType.String: {
        if (isStructuredCellValue) {
          return this.json(field);
        }
        return this.string(field);
      }
    }
  }

  abstract string(field: FieldCore): Knex.QueryBuilder;

  abstract date(field: FieldCore): Knex.QueryBuilder;

  abstract number(field: FieldCore): Knex.QueryBuilder;

  abstract json(field: FieldCore): Knex.QueryBuilder;

  abstract multipleDate(field: FieldCore): Knex.QueryBuilder;

  abstract multipleNumber(field: FieldCore): Knex.QueryBuilder;
}

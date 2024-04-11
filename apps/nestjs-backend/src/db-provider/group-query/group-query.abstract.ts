import { Logger } from '@nestjs/common';
import { CellValueType, DbFieldType } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IGroupQueryInterface, IGroupQueryExtra } from './group-query.interface';

export abstract class AbstractGroupQuery implements IGroupQueryInterface {
  private logger = new Logger(AbstractGroupQuery.name);

  constructor(
    protected readonly knex: Knex,
    protected readonly originQueryBuilder: Knex.QueryBuilder,
    protected readonly fieldMap?: { [fieldId: string]: IFieldInstance },
    protected readonly groupFieldIds?: string[],
    protected readonly extra?: IGroupQueryExtra
  ) {}

  appendGroupBuilder(): Knex.QueryBuilder {
    return this.parseGroups(this.originQueryBuilder, this.groupFieldIds);
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

  private getGroupAdapter(field: IFieldInstance): Knex.QueryBuilder {
    const { dbFieldType } = field;
    switch (field.cellValueType) {
      case CellValueType.DateTime:
        if (dbFieldType === DbFieldType.Json) {
          return this.json(field);
        }
        return this.date(field);
      case CellValueType.Boolean:
      case CellValueType.Number:
      case CellValueType.String: {
        if (dbFieldType === DbFieldType.Json) {
          return this.json(field);
        }
        return this.string(field);
      }
    }
  }

  abstract string(field: IFieldInstance): Knex.QueryBuilder;

  abstract date(field: IFieldInstance): Knex.QueryBuilder;

  abstract json(field: IFieldInstance): Knex.QueryBuilder;
}

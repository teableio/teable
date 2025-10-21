import { InternalServerErrorException } from '@nestjs/common';
import type { FieldCore } from '@teable/core';
import { SortFunc } from '@teable/core';
import type { Knex } from 'knex';
import type { IRecordQuerySortContext } from '../../../features/record/query-builder/record-query-builder.interface';
import type { ISortFunctionInterface } from './sort-function.interface';

export abstract class AbstractSortFunction implements ISortFunctionInterface {
  protected columnName: string;

  constructor(
    protected readonly knex: Knex,
    protected readonly field: FieldCore,
    protected readonly context?: IRecordQuerySortContext
  ) {
    const { dbFieldName, id } = field;

    const selection = context?.selectionMap.get(id);
    if (selection !== undefined && selection !== null) {
      this.columnName = this.normalizeSelection(selection) ?? this.quoteIdentifier(dbFieldName);
    } else {
      this.columnName = this.quoteIdentifier(dbFieldName);
    }
  }

  compiler(builderClient: Knex.QueryBuilder, sortFunc: SortFunc) {
    const functionHandlers = {
      [SortFunc.Asc]: this.asc,
      [SortFunc.Desc]: this.desc,
    };
    const chosenHandler = functionHandlers[sortFunc].bind(this);

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown function ${sortFunc} for sort`);
    }

    return chosenHandler(builderClient);
  }

  generateSQL(sortFunc: SortFunc) {
    const functionHandlers = {
      [SortFunc.Asc]: this.getAscSQL,
      [SortFunc.Desc]: this.getDescSQL,
    };
    const chosenHandler = functionHandlers[sortFunc].bind(this);

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown function ${sortFunc} for sort`);
    }

    return chosenHandler();
  }

  asc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`${this.columnName} ASC NULLS FIRST`);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`${this.columnName} DESC NULLS LAST`);
    return builderClient;
  }

  getAscSQL() {
    return this.knex.raw(`${this.columnName} ASC NULLS FIRST`).toQuery();
  }

  getDescSQL() {
    return this.knex.raw(`${this.columnName} DESC NULLS LAST`).toQuery();
  }

  protected createSqlPlaceholders(values: unknown[]): string {
    return values.map(() => '?').join(',');
  }

  private normalizeSelection(selection: unknown): string | undefined {
    if (typeof selection === 'string') {
      return selection;
    }
    if (selection && typeof (selection as Knex.Raw).toQuery === 'function') {
      return (selection as Knex.Raw).toQuery();
    }
    if (selection && typeof (selection as Knex.Raw).toSQL === 'function') {
      const { sql } = (selection as Knex.Raw).toSQL();
      if (sql) {
        return sql;
      }
    }
    return undefined;
  }

  private quoteIdentifier(identifier: string): string {
    if (!identifier) {
      return identifier;
    }
    if (identifier.startsWith('"') && identifier.endsWith('"')) {
      return identifier;
    }
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
  }
}

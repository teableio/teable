import { InternalServerErrorException } from '@nestjs/common';
import { SortFunc } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../../features/field/model/factory';
import type { ISortFunctionInterface } from './sort-function.interface';

export abstract class AbstractSortFunction implements ISortFunctionInterface {
  protected columnName: string;

  constructor(
    protected readonly knex: Knex,
    protected readonly field: IFieldInstance
  ) {
    const { dbFieldName } = this.field;

    this.columnName = dbFieldName;
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
    builderClient.orderByRaw(`?? ASC NULLS FIRST`, [this.columnName]);
    return builderClient;
  }

  desc(builderClient: Knex.QueryBuilder): Knex.QueryBuilder {
    builderClient.orderByRaw(`?? DESC NULLS LAST`, [this.columnName]);
    return builderClient;
  }

  getAscSQL() {
    return this.knex.raw(`?? ASC NULLS FIRST`, [this.columnName]).toQuery();
  }

  getDescSQL() {
    return this.knex.raw(`?? DESC NULLS LAST`, [this.columnName]).toQuery();
  }

  protected createSqlPlaceholders(values: unknown[]): string {
    return values.map(() => '?').join(',');
  }
}

import { InternalServerErrorException, Logger } from '@nestjs/common';
import { StatisticsFunc } from '@teable/core';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { IAggregationFunctionInterface } from './aggregation-function.interface';

export abstract class AbstractAggregationFunction implements IAggregationFunctionInterface {
  private logger = new Logger(AbstractAggregationFunction.name);

  protected tableColumnRef: string;

  constructor(
    protected readonly knex: Knex,
    protected readonly dbTableName: string,
    protected readonly field: IFieldInstance
  ) {
    const { dbFieldName } = this.field;

    this.tableColumnRef = `${dbFieldName}`;
  }

  compiler(builderClient: Knex.QueryBuilder, aggFunc: StatisticsFunc) {
    const functionHandlers = {
      [StatisticsFunc.Count]: this.count,
      [StatisticsFunc.Empty]: this.empty,
      [StatisticsFunc.Filled]: this.filled,
      [StatisticsFunc.Unique]: this.unique,
      [StatisticsFunc.Max]: this.max,
      [StatisticsFunc.Min]: this.min,
      [StatisticsFunc.Sum]: this.sum,
      [StatisticsFunc.Average]: this.average,
      [StatisticsFunc.Checked]: this.checked,
      [StatisticsFunc.UnChecked]: this.unChecked,
      [StatisticsFunc.PercentEmpty]: this.percentEmpty,
      [StatisticsFunc.PercentFilled]: this.percentFilled,
      [StatisticsFunc.PercentUnique]: this.percentUnique,
      [StatisticsFunc.PercentChecked]: this.percentChecked,
      [StatisticsFunc.PercentUnChecked]: this.percentUnChecked,
      [StatisticsFunc.EarliestDate]: this.earliestDate,
      [StatisticsFunc.LatestDate]: this.latestDate,
      [StatisticsFunc.DateRangeOfDays]: this.dateRangeOfDays,
      [StatisticsFunc.DateRangeOfMonths]: this.dateRangeOfMonths,
      [StatisticsFunc.TotalAttachmentSize]: this.totalAttachmentSize,
    };
    const chosenHandler = functionHandlers[aggFunc].bind(this);

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown function ${aggFunc} for aggregation`);
    }

    const { id: fieldId, isMultipleCellValue } = this.field;

    let rawSql: string = chosenHandler();

    const ignoreMcvFunc = [
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.UnChecked,
      StatisticsFunc.Filled,
      StatisticsFunc.Checked,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentUnChecked,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentChecked,
    ];

    if (isMultipleCellValue && !ignoreMcvFunc.includes(aggFunc)) {
      const joinTable = `${fieldId}_mcv`;

      builderClient.with(`${fieldId}_mcv`, this.knex.raw(rawSql));
      builderClient.joinRaw(`, ${this.knex.ref(joinTable)}`);

      rawSql = `MAX(${this.knex.ref(`${joinTable}.value`)})`;
    }

    return builderClient.select(this.knex.raw(`${rawSql} AS ??`, [`${fieldId}_${aggFunc}`]));
  }

  count(): string {
    return this.knex.raw('COUNT(*)').toQuery();
  }

  empty(): string {
    return this.knex.raw(`COUNT(*) - COUNT(??)`, [this.tableColumnRef]).toQuery();
  }

  filled(): string {
    return this.knex.raw(`COUNT(??)`, [this.tableColumnRef]).toQuery();
  }

  unique(): string {
    return this.knex.raw(`COUNT(DISTINCT ??)`, [this.tableColumnRef]).toQuery();
  }

  max(): string {
    return this.knex.raw(`MAX(??)`, [this.tableColumnRef]).toQuery();
  }

  min(): string {
    return this.knex.raw(`MIN(??)`, [this.tableColumnRef]).toQuery();
  }

  sum(): string {
    return this.knex.raw(`SUM(??)`, [this.tableColumnRef]).toQuery();
  }

  average(): string {
    return this.knex.raw(`AVG(??)`, [this.tableColumnRef]).toQuery();
  }

  checked(): string {
    return this.filled();
  }

  unChecked(): string {
    return this.empty();
  }

  abstract percentEmpty(): string;

  abstract percentFilled(): string;

  abstract percentUnique(): string;

  abstract percentChecked(): string;

  abstract percentUnChecked(): string;

  earliestDate(): string {
    return this.min();
  }

  latestDate(): string {
    return this.max();
  }

  abstract dateRangeOfDays(): string;

  abstract dateRangeOfMonths(): string;

  abstract totalAttachmentSize(): string;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  InternalServerErrorException,
  NotImplementedException,
} from '@nestjs/common';
import type {
  IDateFieldOptions,
  IDateFilter,
  IFilter,
  IFilterOperator,
  IFilterValue,
} from '@teable-group/core';
import {
  contains,
  dateFilterSchema,
  DateUtil,
  doesNotContain,
  FieldType,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  is,
  isAfter,
  isAnyOf,
  isBefore,
  isEmpty,
  isExactly,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isNoneOf,
  isNot,
  isNotEmpty,
  isOnOrAfter,
  isOnOrBefore,
  isWithIn,
  literalValueListSchema,
} from '@teable-group/core';
import type dayjs from 'dayjs';
import type { Knex } from 'knex';
import { get } from 'lodash';
import type { IFieldInstance } from '../../../field/model/factory';
import type { IFilterOperatorHandlers } from '../interface/filter-operator-handlers.interface';

export abstract class AbstractCellValueFilter implements IFilterOperatorHandlers {
  protected readonly _table: string;

  constructor(
    protected readonly queryBuilder: Knex.QueryBuilder,
    protected readonly fields?: { [fieldId: string]: IFieldInstance },
    protected readonly filter?: IFilter | null
  ) {
    this._table = get(queryBuilder, ['_single', 'table']);
  }

  filterStrategies(
    operator: IFilterOperator,
    params: {
      queryBuilder: Knex.QueryBuilder;
      field: IFieldInstance;
      value: IFilterValue;
    }
  ) {
    const operatorHandlers = {
      [is.value]: this.isOperatorHandler,
      [isExactly.value]: this.isExactlyOperatorHandler,
      [isNot.value]: this.isNotOperatorHandler,
      [contains.value]: this.containsOperatorHandler,
      [doesNotContain.value]: this.doesNotContainOperatorHandler,
      [isGreater.value]: this.isGreaterOperatorHandler,
      [isAfter.value]: this.isGreaterOperatorHandler,
      [isGreaterEqual.value]: this.isGreaterEqualOperatorHandler,
      [isOnOrAfter.value]: this.isGreaterEqualOperatorHandler,
      [isLess.value]: this.isLessOperatorHandler,
      [isBefore.value]: this.isLessOperatorHandler,
      [isLessEqual.value]: this.isLessEqualOperatorHandler,
      [isOnOrBefore.value]: this.isLessEqualOperatorHandler,
      [isAnyOf.value]: this.isAnyOfOperatorHandler,
      [hasAnyOf.value]: this.isAnyOfOperatorHandler,
      [isNoneOf.value]: this.isNoneOfOperatorHandler,
      [hasNoneOf.value]: this.isNoneOfOperatorHandler,
      [hasAllOf.value]: this.hasAllOfOperatorHandler,
      [isWithIn.value]: this.isWithInOperatorHandler,
      [isEmpty.value]: this.isEmptyOperatorHandler,
      [isNotEmpty.value]: this.isNotEmptyOperatorHandler,
    };
    const chosenHandler = operatorHandlers[operator].bind(this);

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown operator ${operator} for filter`);
    }

    const { field, value } = params;
    return chosenHandler(params.queryBuilder, { field, operator, value });
  }

  isOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, value);
    return queryBuilder;
  }

  isExactlyOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isNotOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.whereRaw(`ifnull(${field.dbFieldName}, '') != ?`, [value]);
    return queryBuilder;
  }

  containsOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, 'like', `%${value}%`);
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

  isGreaterOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, '>', value);
    return queryBuilder;
  }

  isGreaterEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, '>=', value);
    return queryBuilder;
  }

  isLessOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, '<', value);
    return queryBuilder;
  }

  isLessEqualOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;

    queryBuilder.where(field.dbFieldName, '<=', value);
    return queryBuilder;
  }

  isAnyOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const valueList = literalValueListSchema.parse(value);

    queryBuilder.whereIn(field.dbFieldName, [...valueList]);
    return queryBuilder;
  }

  isNoneOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field, value } = params;
    const valueList = literalValueListSchema.parse(value);

    const sql = `ifnull(${field.dbFieldName}, '') not in (${this.createSqlPlaceholders(
      valueList
    )})`;
    queryBuilder.whereRaw(sql, [...valueList]);
    return queryBuilder;
  }

  hasAllOfOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isWithInOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isEmptyOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field } = params;

    queryBuilder.whereNull(field.dbFieldName);
    return queryBuilder;
  }

  isNotEmptyOperatorHandler(
    queryBuilder: Knex.QueryBuilder,
    params: { field: IFieldInstance; operator: IFilterOperator; value: IFilterValue }
  ): Knex.QueryBuilder {
    const { field } = params;

    queryBuilder.whereNotNull(field.dbFieldName);
    return queryBuilder;
  }

  protected createSqlPlaceholders(values: unknown[]): string {
    return values.map(() => '?').join(',');
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

  protected getFilterDateTimeRange(
    dateFieldOptions: IDateFieldOptions,
    filterValue: IDateFilter
  ): [string, string] {
    const filterValueByDate = dateFilterSchema.parse(filterValue);

    const { mode, numberOfDays, exactDate } = filterValueByDate;
    const {
      formatting: { timeZone },
    } = dateFieldOptions;

    const dateUtil = new DateUtil(timeZone);

    // Helper function to calculate date range for fixed days like today, tomorrow, etc.
    const computeDateRangeForFixedDays = (
      methodName:
        | 'date'
        | 'tomorrow'
        | 'yesterday'
        | 'lastWeek'
        | 'nextWeek'
        | 'lastMonth'
        | 'nextMonth'
    ): [dayjs.Dayjs, dayjs.Dayjs] => {
      return [dateUtil[methodName]().startOf('day'), dateUtil[methodName]().endOf('day')];
    };

    // Helper function to calculate date range for offset days from current date.
    const calculateDateRangeForOffsetDays = (isPast: boolean): [dayjs.Dayjs, dayjs.Dayjs] => {
      if (!numberOfDays) {
        throw new BadRequestException('Number of days must be entered');
      }
      const offsetDays = isPast ? -numberOfDays : numberOfDays;
      return [
        dateUtil.offsetDay(offsetDays).startOf('day'),
        dateUtil.offsetDay(offsetDays).endOf('day'),
      ];
    };

    // Helper function to determine date range for a given exact date.
    const determineDateRangeForExactDate = (): [dayjs.Dayjs, dayjs.Dayjs] => {
      if (!exactDate) {
        throw new BadRequestException('Exact date must be entered');
      }
      return [dateUtil.date(exactDate).startOf('day'), dateUtil.date(exactDate).endOf('day')];
    };

    // Helper function to generate offset date range for a given unit (day, week, month, year).
    const generateOffsetDateRange = (
      isPast: boolean,
      unit: 'day' | 'week' | 'month' | 'year',
      numberOfDays?: number
    ): [dayjs.Dayjs, dayjs.Dayjs] => {
      if (numberOfDays === undefined || numberOfDays === null) {
        throw new BadRequestException('Number of days must be entered');
      }

      const currentDate = dateUtil.date();
      const startOfDay = currentDate.startOf('day');
      const endOfDay = currentDate.endOf('day');

      const startDate = isPast
        ? dateUtil.offset(unit, -numberOfDays, endOfDay).startOf('day')
        : startOfDay;
      const endDate = isPast
        ? endOfDay
        : dateUtil.offset(unit, numberOfDays, startOfDay).endOf('day');

      return [startDate, endDate];
    };

    // Map of operation functions based on date mode.
    const operationMap: Record<string, () => [dayjs.Dayjs, dayjs.Dayjs]> = {
      today: () => computeDateRangeForFixedDays('date'),
      tomorrow: () => computeDateRangeForFixedDays('tomorrow'),
      yesterday: () => computeDateRangeForFixedDays('yesterday'),
      oneWeekAgo: () => computeDateRangeForFixedDays('lastWeek'),
      oneWeekFromNow: () => computeDateRangeForFixedDays('nextWeek'),
      oneMonthAgo: () => computeDateRangeForFixedDays('lastMonth'),
      oneMonthFromNow: () => computeDateRangeForFixedDays('nextMonth'),
      daysAgo: () => calculateDateRangeForOffsetDays(true),
      daysFromNow: () => calculateDateRangeForOffsetDays(false),
      exactDate: () => determineDateRangeForExactDate(),
      pastWeek: () => generateOffsetDateRange(true, 'week', 1),
      pastMonth: () => generateOffsetDateRange(true, 'month', 1),
      pastYear: () => generateOffsetDateRange(true, 'year', 1),
      nextWeek: () => generateOffsetDateRange(false, 'week', 1),
      nextMonth: () => generateOffsetDateRange(false, 'month', 1),
      nextYear: () => generateOffsetDateRange(false, 'year', 1),
      pastNumberOfDays: () => generateOffsetDateRange(true, 'day', numberOfDays),
      nextNumberOfDays: () => generateOffsetDateRange(false, 'day', numberOfDays),
    };
    const [startDate, endDate] = operationMap[mode]();

    // Return the start and end date in ISO 8601 date format.
    return [startDate.toISOString(), endDate.toISOString()];
  }
}

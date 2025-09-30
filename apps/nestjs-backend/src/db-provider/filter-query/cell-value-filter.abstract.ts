import {
  BadRequestException,
  InternalServerErrorException,
  NotImplementedException,
} from '@nestjs/common';
import type { IDateFieldOptions, IDateFilter, IFilterOperator, IFilterValue } from '@teable/core';
import {
  CellValueType,
  contains,
  dateFilterSchema,
  DateFormattingPreset,
  DateUtil,
  doesNotContain,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isNotExactly,
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
} from '@teable/core';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type { Knex } from 'knex';
import type { IFieldInstance } from '../../features/field/model/factory';
import type { ICellValueFilterInterface } from './cell-value-filter.interface';

export abstract class AbstractCellValueFilter implements ICellValueFilterInterface {
  protected tableColumnRef: string;

  constructor(protected readonly field: IFieldInstance) {
    const { dbFieldName } = this.field;

    this.tableColumnRef = dbFieldName;
  }

  compiler(builderClient: Knex.QueryBuilder, operator: IFilterOperator, value: IFilterValue) {
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
      [isNotExactly.value]: this.isNotExactlyOperatorHandler,
      [isWithIn.value]: this.isWithInOperatorHandler,
      [isEmpty.value]: this.isEmptyOperatorHandler,
      [isNotEmpty.value]: this.isNotEmptyOperatorHandler,
    };
    const chosenHandler = operatorHandlers[operator].bind(this);

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown operator ${operator} for filter`);
    }

    return chosenHandler(builderClient, operator, value);
  }

  isOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const parseValue = this.field.cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.where(this.tableColumnRef, parseValue);
    return builderClient;
  }

  isExactlyOperatorHandler(
    _builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  abstract isNotOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder;

  containsOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    builderClient.where(this.tableColumnRef, 'LIKE', `%${value}%`);
    return builderClient;
  }

  abstract doesNotContainOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder;

  isGreaterOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.where(this.tableColumnRef, '>', parseValue);
    return builderClient;
  }

  isGreaterEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.where(this.tableColumnRef, '>=', parseValue);
    return builderClient;
  }

  isLessOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.where(this.tableColumnRef, '<', parseValue);
    return builderClient;
  }

  isLessEqualOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType } = this.field;
    const parseValue = cellValueType === CellValueType.Number ? Number(value) : value;

    builderClient.where(this.tableColumnRef, '<=', parseValue);
    return builderClient;
  }

  isAnyOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder {
    const valueList = literalValueListSchema.parse(value);

    builderClient.whereIn(this.tableColumnRef, [...valueList]);
    return builderClient;
  }

  abstract isNoneOfOperatorHandler(
    builderClient: Knex.QueryBuilder,
    operator: IFilterOperator,
    value: IFilterValue
  ): Knex.QueryBuilder;

  hasAllOfOperatorHandler(
    _builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isNotExactlyOperatorHandler(
    _builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isWithInOperatorHandler(
    _builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    throw new NotImplementedException();
  }

  isEmptyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    const tableColumnRef = this.tableColumnRef;
    const { cellValueType, isStructuredCellValue, isMultipleCellValue } = this.field;

    builderClient.where(function () {
      this.whereNull(tableColumnRef);

      if (
        cellValueType === CellValueType.String &&
        !isStructuredCellValue &&
        !isMultipleCellValue
      ) {
        this.orWhere(tableColumnRef, '=', '');
      }
    });
    return builderClient;
  }

  isNotEmptyOperatorHandler(
    builderClient: Knex.QueryBuilder,
    _operator: IFilterOperator,
    _value: IFilterValue
  ): Knex.QueryBuilder {
    const { cellValueType, isStructuredCellValue, isMultipleCellValue } = this.field;

    builderClient.whereNotNull(this.tableColumnRef);

    if (cellValueType === CellValueType.String && !isStructuredCellValue && !isMultipleCellValue) {
      builderClient.where(this.tableColumnRef, '!=', '');
    }
    return builderClient;
  }

  protected createSqlPlaceholders(values: unknown[]): string {
    return values.map(() => '?').join(',');
  }

  protected getFilterDateTimeRange(
    dateFieldOptions: IDateFieldOptions,
    filterValue: IDateFilter
  ): [string, string] {
    const filterValueByDate = dateFilterSchema.parse(filterValue);

    const { mode, numberOfDays, exactDate } = filterValueByDate;
    const {
      formatting: { timeZone, date: dateFormat },
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
    ): [Dayjs, Dayjs] => {
      return [dateUtil[methodName]().startOf('day'), dateUtil[methodName]().endOf('day')];
    };

    // Helper function to calculate date range for offset days from current date.
    const calculateDateRangeForOffsetDays = (isPast: boolean): [Dayjs, Dayjs] => {
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
    const determineDateRangeForExactDate = (): [Dayjs, Dayjs] => {
      if (!exactDate) {
        throw new BadRequestException('Exact date must be entered');
      }

      return [dateUtil.date(exactDate).startOf('day'), dateUtil.date(exactDate).endOf('day')];
    };

    // Helper function to determine date range for a given exact formatted date.
    const determineDateRangeForExactFormatDate = (): [Dayjs, Dayjs] => {
      if (!exactDate) {
        throw new BadRequestException('Exact date must be entered');
      }

      const parsedDate = dateUtil.date(exactDate);

      switch (dateFormat) {
        case DateFormattingPreset.Y:
          return [parsedDate.startOf('year'), parsedDate.endOf('year')];
        case DateFormattingPreset.YM:
        case DateFormattingPreset.M:
          return [parsedDate.startOf('month'), parsedDate.endOf('month')];
        case DateFormattingPreset.MD:
        case DateFormattingPreset.D:
        default:
          return [parsedDate.startOf('day'), parsedDate.endOf('day')];
      }
    };

    // Helper function to generate offset date range for a given unit (day, week, month, year).
    const generateOffsetDateRange = (
      isPast: boolean,
      unit: 'day' | 'week' | 'month' | 'year',
      numberOfDays?: number
    ): [Dayjs, Dayjs] => {
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

    const generateRelativeDateFromCurrentDateRange = (
      mode: 'current' | 'next' | 'last',
      unit: 'week' | 'month' | 'year'
    ): [Dayjs, Dayjs] => {
      dayjs.locale(dayjs.locale(), {
        weekStart: 1,
      });
      let cursorDate;
      switch (mode) {
        case 'current':
          cursorDate = dateUtil.date();
          break;
        case 'next':
          cursorDate = dateUtil.date().add(1, unit);
          break;
        case 'last':
          cursorDate = dateUtil.date().subtract(1, unit);
          break;
        default:
          cursorDate = dateUtil.date();
      }
      return [cursorDate.startOf(unit).startOf('day'), cursorDate.endOf(unit).endOf('day')];
    };

    // Map of operation functions based on date mode.
    const operationMap: Record<string, () => [Dayjs, Dayjs]> = {
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
      exactFormatDate: () => determineDateRangeForExactFormatDate(),
      currentWeek: () => generateRelativeDateFromCurrentDateRange('current', 'week'),
      currentMonth: () => generateRelativeDateFromCurrentDateRange('current', 'month'),
      currentYear: () => generateRelativeDateFromCurrentDateRange('current', 'year'),
      lastWeek: () => generateRelativeDateFromCurrentDateRange('last', 'week'),
      lastMonth: () => generateRelativeDateFromCurrentDateRange('last', 'month'),
      lastYear: () => generateRelativeDateFromCurrentDateRange('last', 'year'),
      nextWeekPeriod: () => generateRelativeDateFromCurrentDateRange('next', 'week'),
      nextMonthPeriod: () => generateRelativeDateFromCurrentDateRange('next', 'month'),
      nextYearPeriod: () => generateRelativeDateFromCurrentDateRange('next', 'year'),
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

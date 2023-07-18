import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type {
  FieldCore,
  IConjunction,
  IDateFieldOptions,
  IDateTimeFieldSubOperator,
  IDateTimeFieldSubOperatorByIsWithin,
  IFilter,
  IFilterMeta,
  IFilterMetaOperator,
  IFilterMetaValue,
  IFilterMetaValueByDate,
  IFilterSet,
} from '@teable-group/core';
import {
  CellValueType,
  contains,
  DateUtil,
  doesNotContain,
  getFilterOperatorMapping,
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
} from '@teable-group/core';
import type dayjs from 'dayjs';
import type { Knex } from 'knex';
import { get, includes, invert, isArray, size } from 'lodash';

export class FilterQueryTranslator {
  private readonly _table: string;

  constructor(
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: FieldCore },
    private readonly filter?: IFilter | null
  ) {
    this._table = get(queryBuilder, ['_single', 'table']);
  }

  private getDateTimeRange(
    dateTimeFieldOperator: IDateTimeFieldSubOperator | IDateTimeFieldSubOperatorByIsWithin,
    params: {
      timeZone: string;
      numberOfDays?: number;
      exactDate?: string;
    }
  ): [string, string] {
    const { timeZone, numberOfDays, exactDate } = params;
    const dateUtil = new DateUtil(timeZone);
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
    const determineDateRangeForExactDate = (): [dayjs.Dayjs, dayjs.Dayjs] => {
      if (!exactDate) {
        throw new BadRequestException('Exact date must be entered');
      }
      return [dateUtil.date(exactDate).startOf('day'), dateUtil.date(exactDate).endOf('day')];
    };
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
    const [startDate, endDate] = operationMap[dateTimeFieldOperator]();

    return [startDate.toISOString(), endDate.toISOString()];
  }

  private processIsOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.isMultipleCellValue && isArray(value)) {
      const placeholders = value.map(() => '?').join(',');
      const isExactlySql = `(
        select count(distinct json_each.value) from 
          json_each(${this._table}.${field.dbFieldName}) 
        where json_each.value in (${placeholders})
          and json_array_length(${this._table}.${field.dbFieldName}) = ?
      ) = ?`;
      const vLength = value.length;
      queryBuilder.whereRaw(isExactlySql, [...value, vLength, vLength]);
    } else if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
    } else {
      queryBuilder.where(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processIsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      queryBuilder.whereNotBetween(field.dbFieldName, dateTimeRange);
    } else {
      queryBuilder.whereNot(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processContainsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.where(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  };

  private processDoesNotContainOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    queryBuilder.whereNot(field.dbFieldName, 'like', `%${value}%`);

    return queryBuilder;
  };

  private processIsGreaterOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      newValue = dateTimeRange[1];
    }

    queryBuilder.where(field.dbFieldName, '>', newValue);
    return queryBuilder;
  };

  private processIsGreaterEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      newValue = dateTimeRange[0];
    }

    queryBuilder.where(field.dbFieldName, '>=', newValue);
    return queryBuilder;
  };

  private processIsLessOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      newValue = dateTimeRange[0];
    }

    queryBuilder.where(field.dbFieldName, '<', newValue);
    return queryBuilder;
  };

  private processIsLessEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      newValue = dateTimeRange[1];
    }

    queryBuilder.where(field.dbFieldName, '<=', newValue);
    return queryBuilder;
  };

  private processIsWithInOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.cellValueType === CellValueType.DateTime) {
      const { mode, numberOfDays, exactDate } = value as IFilterMetaValueByDate;
      const {
        formatting: { timeZone },
      } = field.options as IDateFieldOptions;
      const dateTimeRange = this.getDateTimeRange(mode, { timeZone, numberOfDays, exactDate });
      queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
    }

    return queryBuilder;
  };

  private processIsEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field } = params;
    queryBuilder.whereNull(field.dbFieldName);

    return queryBuilder;
  };

  private processIsNotEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field } = params;
    queryBuilder.whereNotNull(field.dbFieldName);

    return queryBuilder;
  };

  private processIsAnyOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException('value must be an array');
    }

    if (field.isMultipleCellValue) {
      const placeholders = value.map(() => '?').join(',');
      const hasAnyOfSql = `exists (
              select 1 from
                json_each(${this._table}.${field.dbFieldName})
              where json_each.value in (${placeholders})
            )`;
      queryBuilder.whereRaw(hasAnyOfSql, [...value]);
    } else {
      queryBuilder.whereIn(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processIsNoneOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException('value must be an array');
    }

    if (field.isMultipleCellValue) {
      const placeholders = value.map(() => '?').join(',');
      const hasNoneOfSql = `not exists (
              select 1 from
                json_each(${this._table}.${field.dbFieldName})
              where json_each.value in (${placeholders})
            )`;
      queryBuilder.whereRaw(hasNoneOfSql, [...value]);
    } else {
      queryBuilder.whereNotIn(field.dbFieldName, value);
    }

    return queryBuilder;
  };

  private processHasAllOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: FieldCore;
    value: IFilterMetaValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.isMultipleCellValue && isArray(value)) {
      const placeholders = value.map(() => '?').join(',');
      const hasAllSql = `(
          select count(distinct json_each.value) from 
            json_each(${this._table}.${field.dbFieldName}) 
          where json_each.value in (${placeholders})
        ) = ?`;
      queryBuilder.whereRaw(hasAllSql, [...value, size(value)]);
    }

    return queryBuilder;
  };

  private filterStrategies(
    operator: IFilterMetaOperator,
    params: {
      queryBuilder: Knex.QueryBuilder;
      field: FieldCore;
      value: IFilterMetaValue;
    }
  ) {
    const operatorHandlers = {
      [is.value]: this.processIsOperator,
      [isExactly.value]: this.processIsOperator,
      [isNot.value]: this.processIsNotOperator,
      [contains.value]: this.processContainsNotOperator,
      [doesNotContain.value]: this.processDoesNotContainOperator,
      [isGreater.value]: this.processIsGreaterOperator,
      [isAfter.value]: this.processIsGreaterOperator,
      [isGreaterEqual.value]: this.processIsGreaterEqualOperator,
      [isOnOrAfter.value]: this.processIsGreaterEqualOperator,
      [isLess.value]: this.processIsLessOperator,
      [isBefore.value]: this.processIsLessOperator,
      [isLessEqual.value]: this.processIsLessEqualOperator,
      [isOnOrBefore.value]: this.processIsLessEqualOperator,
      [isAnyOf.value]: this.processIsAnyOfOperator,
      [hasAnyOf.value]: this.processIsAnyOfOperator,
      [isNoneOf.value]: this.processIsNoneOfOperator,
      [hasNoneOf.value]: this.processIsNoneOfOperator,
      [hasAllOf.value]: this.processHasAllOfOperator,
      [isWithIn.value]: this.processIsWithInOperator,
      [isEmpty.value]: this.processIsEmptyOperator,
      [isNotEmpty.value]: this.processIsNotEmptyOperator,
    };

    const chosenHandler = operatorHandlers[operator];

    if (!chosenHandler) {
      throw new InternalServerErrorException(`Unknown operator ${operator} for filter`);
    }

    return chosenHandler(params);
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterMeta,
    conjunction: IConjunction
  ) {
    const { fieldId, operator, value, isSymbol } = filterMeta;

    const field = this.fields && this.fields[fieldId];
    if (!field) {
      return queryBuilder;
    }

    let convertOperator = operator;
    const filterOperatorMapping = getFilterOperatorMapping(field);
    const validFilterOperators = Object.keys(filterOperatorMapping);
    if (isSymbol) {
      convertOperator = invert(filterOperatorMapping)[operator] as IFilterMetaOperator;
    }

    if (!includes(validFilterOperators, operator)) {
      throw new InternalServerErrorException(
        `Unexpected operator received: '${convertOperator}', Field valid Operators: [${validFilterOperators}]`
      );
    }

    queryBuilder = queryBuilder[conjunction];
    this.filterStrategies(convertOperator as IFilterMetaOperator, { queryBuilder, field, value });

    return queryBuilder;
  }

  private parseFilters(
    queryBuilder: Knex.QueryBuilder,
    filter?: IFilter | null,
    parentConjunction?: IConjunction
  ): Knex.QueryBuilder {
    if (!filter || !filter.filterSet) {
      return queryBuilder;
    }
    const { filterSet, conjunction } = filter;

    filterSet.forEach((filterItem) => {
      if ('fieldId' in filterItem) {
        this.parseFilter(queryBuilder, filterItem as IFilterMeta, conjunction);
      } else {
        queryBuilder = queryBuilder[parentConjunction || conjunction];
        queryBuilder.where((builder) => {
          this.parseFilters(builder, filterItem as IFilterSet, conjunction);
        });
      }
    });

    return queryBuilder;
  }

  private filterNullValues(filter?: IFilter | null) {
    if (!filter || !Object.keys(filter).length) {
      return;
    }
    filter.filterSet = filter.filterSet.filter((filterItem) => {
      if ('filterSet' in filterItem) {
        this.filterNullValues(filterItem as IFilter);
        return true;
      }
      return (
        filterItem.value !== null ||
        filterItem.operator === 'isEmpty' ||
        filterItem.operator === 'isNotEmpty'
      );
    });
  }

  translateToSql(): Knex.QueryBuilder {
    this.filterNullValues(this.filter);

    return this.parseFilters(this.queryBuilder, this.filter);
  }
}

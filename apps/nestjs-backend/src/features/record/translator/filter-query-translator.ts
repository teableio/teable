import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type {
  IConjunction,
  IDateFieldOptions,
  IDateTimeFieldOperator,
  IFilter,
  IFilterItem,
  IFilterOperator,
  IFilterValue,
  IFilterSet,
} from '@teable-group/core';
import {
  CellValueType,
  contains,
  DateUtil,
  doesNotContain,
  FieldType,
  dateFilterSchema,
  getFilterOperatorMapping,
  getValidFilterSubOperators,
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
import { get, includes, invert, isArray, isObject, size } from 'lodash';
import type { IFieldInstance } from '../../field/model/factory';

export class FilterQueryTranslator {
  private readonly _table: string;

  constructor(
    private readonly queryBuilder: Knex.QueryBuilder,
    private readonly fields?: { [fieldId: string]: IFieldInstance },
    private readonly filter?: IFilter | null
  ) {
    this._table = get(queryBuilder, ['_single', 'table']);
  }

  translateToSql(): Knex.QueryBuilder {
    this.filterNullValues(this.filter);

    return this.parseFilters(this.queryBuilder, this.filter);
  }

  private filterStrategies(
    operator: IFilterOperator,
    params: {
      queryBuilder: Knex.QueryBuilder;
      field: IFieldInstance;
      value: IFilterValue;
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
        this.parseFilter(queryBuilder, filterItem as IFilterItem, conjunction);
      } else {
        queryBuilder = queryBuilder[parentConjunction || conjunction];
        queryBuilder.where((builder) => {
          this.parseFilters(builder, filterItem as IFilterSet, conjunction);
        });
      }
    });

    return queryBuilder;
  }

  private parseFilter(
    queryBuilder: Knex.QueryBuilder,
    filterMeta: IFilterItem,
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
      convertOperator = invert(filterOperatorMapping)[operator] as IFilterOperator;
    }

    if (!includes(validFilterOperators, operator)) {
      throw new BadRequestException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following types are allowed: [${validFilterOperators}]`
      );
    }

    const validFilterSubOperators = getValidFilterSubOperators(
      field.type,
      operator as IDateTimeFieldOperator
    );

    if (
      validFilterSubOperators &&
      isObject(value) &&
      'mode' in value &&
      !includes(validFilterSubOperators, value.mode)
    ) {
      throw new BadRequestException(
        `The '${convertOperator}' operation provided for the '${field.name}' filter is invalid. Only the following subtypes are allowed: [${validFilterSubOperators}]`
      );
    }

    queryBuilder = queryBuilder[conjunction];
    this.filterStrategies(convertOperator as IFilterOperator, { queryBuilder, field, value });

    return queryBuilder;
  }

  private processIsOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
    // eslint-disable-next-line sonarjs/cognitive-complexity
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.isMultipleCellValue && isArray(value)) {
      const getIsExactlySqlSql = (field: IFieldInstance, placeholders: string) => {
        let column = `json_each.value`;
        if (field.type === FieldType.Link) {
          column = `json_extract(json_each.value, '$.id')`;
        }
        return `(
          select count(distinct json_each.value) from 
            json_each(${this._table}.${field.dbFieldName}) 
          where ${column} in (${placeholders})
            and json_array_length(${this._table}.${field.dbFieldName}) = ?
        ) = ?`;
      };

      const isExactlySql = getIsExactlySqlSql(field, this.createSqlPlaceholders(value));
      const vLength = value.length;
      queryBuilder.whereRaw(isExactlySql, [...value, vLength, vLength]);
    } else if (field.isMultipleCellValue && field.isLookup) {
      let newValue = value;
      if (value && !isArray(value) && !(isObject(value) && 'mode' in value)) {
        newValue = [value];
      }

      this.processIsAnyOfOperator({ ...params, value: newValue });
    } else {
      switch (field.cellValueType) {
        case CellValueType.DateTime: {
          const dateTimeRange = this.getFilterDateTimeRange(
            field.options as IDateFieldOptions,
            value
          );
          queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
          break;
        }
        case CellValueType.Boolean: {
          (value ? this.processIsNotEmptyOperator : this.processIsEmptyOperator)(params);
          break;
        }
        default: {
          if (field.type === FieldType.Link) {
            const isSql = `json_extract(${field.dbFieldName}, '$.id') = ?`;
            queryBuilder.whereRaw(isSql, [value]);
          } else {
            queryBuilder.where(field.dbFieldName, value);
          }
        }
      }
    }
    return queryBuilder;
  };

  private processIsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      queryBuilder.whereNotBetween(field.dbFieldName, dateTimeRange);
    } else {
      const getIsNotSql = (field: IFieldInstance) => {
        let column = field.dbFieldName;
        if (field.type === FieldType.Link) {
          column = `json_extract(${field.dbFieldName}, '$.id')`;
        }
        return `ifnull(${column}, '') != ?`;
      };

      const isNotSql = getIsNotSql(field);
      queryBuilder.whereRaw(isNotSql, [value]);
    }
    return queryBuilder;
  };

  private processContainsNotOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.type === FieldType.Link) {
      const containsSql = field.isMultipleCellValue
        ? `exists (
            select 1 from
              json_each(${this._table}.${field.dbFieldName})
            where json_extract(json_each.value, '$.title') like ?
          )`
        : `json_extract(${field.dbFieldName}, '$.title') like ?`;

      queryBuilder.whereRaw(containsSql, [`%${value}%`]);
    } else {
      queryBuilder.where(field.dbFieldName, 'like', `%${value}%`);
    }
    return queryBuilder;
  };

  private processDoesNotContainOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.type === FieldType.Link) {
      const doesNotContainSql = field.isMultipleCellValue
        ? `not exists (
            select 1 from
              json_each(${this._table}.${field.dbFieldName})
            where json_extract(json_each.value, '$.title') like ?
          )`
        : `ifnull(json_extract(${field.dbFieldName}, '$.title'), '') not like ?`;

      queryBuilder.whereRaw(doesNotContainSql, [`%${value}%`]);
    } else {
      queryBuilder.whereRaw(`ifnull(${field.dbFieldName}, '') not like ?`, [`%${value}%`]);
    }
    return queryBuilder;
  };

  private processIsGreaterOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      newValue = dateTimeRange[1];
    }

    queryBuilder.where(field.dbFieldName, '>', newValue);
    return queryBuilder;
  };

  private processIsGreaterEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      newValue = dateTimeRange[0];
    }

    queryBuilder.where(field.dbFieldName, '>=', newValue);
    return queryBuilder;
  };

  private processIsLessOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      newValue = dateTimeRange[0];
    }

    queryBuilder.where(field.dbFieldName, '<', newValue);
    return queryBuilder;
  };

  private processIsLessEqualOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    let newValue = value;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      newValue = dateTimeRange[1];
    }

    queryBuilder.where(field.dbFieldName, '<=', newValue);
    return queryBuilder;
  };

  private processIsWithInOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;

    if (field.cellValueType === CellValueType.DateTime) {
      const dateTimeRange = this.getFilterDateTimeRange(field.options as IDateFieldOptions, value);
      queryBuilder.whereBetween(field.dbFieldName, dateTimeRange);
    }
    return queryBuilder;
  };

  private processIsEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field } = params;

    queryBuilder.whereNull(field.dbFieldName);
    return queryBuilder;
  };

  private processIsNotEmptyOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field } = params;

    queryBuilder.whereNotNull(field.dbFieldName);
    return queryBuilder;
  };

  private processIsAnyOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException(`Invalid input for field '${field.name}': expected an array`);
    }

    if (field.isMultipleCellValue) {
      const getHasAnyOfSql = (field: IFieldInstance, placeholders: string) => {
        let column = `json_each.value`;
        if (field.type === FieldType.Link) {
          column = `json_extract(json_each.value, '$.id')`;
        }
        return `exists (
          select 1 from 
            json_each(${this._table}.${field.dbFieldName})
          where ${column} in (${placeholders})
        )`;
      };

      const hasAnyOfSql = getHasAnyOfSql(field, this.createSqlPlaceholders(value));
      queryBuilder.whereRaw(hasAnyOfSql, [...value]);
    } else {
      if (field.type === FieldType.Link) {
        const inSql = `json_extract(${field.dbFieldName}, '$.id') in (${this.createSqlPlaceholders(
          value
        )})`;

        queryBuilder.whereRaw(inSql, [...value]);
      } else {
        queryBuilder.whereIn(field.dbFieldName, [...value]);
      }
    }
    return queryBuilder;
  };

  private processIsNoneOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException(`Invalid input for field '${field.name}': expected an array`);
    }

    if (field.isMultipleCellValue) {
      const getHasNoneOfSql = (field: IFieldInstance, placeholders: string) => {
        let column = `json_each.value`;
        if (field.type === FieldType.Link) {
          column = `json_extract(json_each.value, '$.id')`;
        }
        return `not exists (
          select 1 from 
            json_each(${this._table}.${field.dbFieldName})
          where ${column} in (${placeholders})
        )`;
      };

      const hasNoneOfSql = getHasNoneOfSql(field, this.createSqlPlaceholders(value));
      queryBuilder.whereRaw(hasNoneOfSql, [...value]);
    } else {
      const getNotInSql = (field: IFieldInstance, placeholders: string) => {
        let column = field.dbFieldName;
        if (field.type === FieldType.Link) {
          column = `json_extract(${field.dbFieldName}, '$.id')`;
        }
        return `ifnull(${column}, '') not in (${placeholders})`;
      };

      const notInSql = getNotInSql(field, this.createSqlPlaceholders(value));
      queryBuilder.whereRaw(notInSql, [...value]);
    }
    return queryBuilder;
  };

  private processHasAllOfOperator = (params: {
    queryBuilder: Knex.QueryBuilder;
    field: IFieldInstance;
    value: IFilterValue;
  }) => {
    const { queryBuilder, field, value } = params;
    if (!isArray(value)) {
      throw new BadRequestException(`Invalid input for field '${field.name}': expected an array`);
    }

    if (field.isMultipleCellValue) {
      const getHasAllSql = (field: IFieldInstance, placeholders: string) => {
        let column = `json_each.value`;
        if (field.type === FieldType.Link) {
          column = `json_extract(json_each.value, '$.id')`;
        }
        return `(
          select count(distinct json_each.value) from 
            json_each(${this._table}.${field.dbFieldName}) 
          where ${column} in (${placeholders})
        ) = ?`;
      };

      const hasAllSql = getHasAllSql(field, this.createSqlPlaceholders(value));
      queryBuilder.whereRaw(hasAllSql, [...value, size(value)]);
    }

    return queryBuilder;
  };

  private filterNullValues(filter?: IFilter | null) {
    // If the filter is not defined or has no keys, exit the function
    if (!filter || !Object.keys(filter).length) {
      return;
    }
    filter.filterSet = filter.filterSet.filter((filterItem) => {
      // If 'filterSet' exists in filterItem, recursively call filterNullValues
      // Always keep the filterItem, as we are modifying it in-place
      if ('filterSet' in filterItem) {
        this.filterNullValues(filterItem as IFilter);
        return true;
      }
      const { fieldId, operator, value } = filterItem;
      // Get the corresponding field from the fields object using fieldId
      // If it doesn't exist, filter out the item
      const field = this.fields?.[fieldId];
      if (!field) return false;

      // Keep the filterItem if any of the following conditions are met:
      // - The value is not null
      // - The field type is a checkbox
      // - The operator is either 'isEmpty' or 'isNotEmpty'
      return (
        value !== null ||
        field.type === FieldType.Checkbox ||
        ['isEmpty', 'isNotEmpty'].includes(operator)
      );
    });
  }

  private getFilterDateTimeRange(
    dateFieldOptions: IDateFieldOptions,
    filterValue: IFilterValue
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

  private createSqlPlaceholders(values: unknown[]): string {
    return values.map(() => '?').join(',');
  }
}

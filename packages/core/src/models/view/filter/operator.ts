/* eslint-disable @typescript-eslint/naming-convention */
import { pick, pullAll, uniq } from 'lodash';
import { z } from 'zod';
import { CellValueType, FieldType } from '../../field/constant';
import type { FieldCore } from '../../field/field';

export const is = z.literal('is');
export const isNot = z.literal('isNot');
export const contains = z.literal('contains');
export const doesNotContain = z.literal('doesNotContain');
export const isEmpty = z.literal('isEmpty');
export const isNotEmpty = z.literal('isNotEmpty');
export const isGreater = z.literal('isGreater');
export const isGreaterEqual = z.literal('isGreaterEqual');
export const isLess = z.literal('isLess');
export const isLessEqual = z.literal('isLessEqual');
export const isAnyOf = z.literal('isAnyOf');
export const isNoneOf = z.literal('isNoneOf');
export const hasAnyOf = z.literal('hasAnyOf');
export const hasAllOf = z.literal('hasAllOf');
export const isNotExactly = z.literal('isNotExactly');
export const hasNoneOf = z.literal('hasNoneOf');
export const isExactly = z.literal('isExactly');
export const isWithIn = z.literal('isWithIn');
export const isBefore = z.literal('isBefore');
export const isAfter = z.literal('isAfter');
export const isOnOrBefore = z.literal('isOnOrBefore');
export const isOnOrAfter = z.literal('isOnOrAfter');

// date sub operation
export const today = z.literal('today');
export const tomorrow = z.literal('tomorrow');
export const yesterday = z.literal('yesterday');
export const currentWeek = z.literal('currentWeek');
export const currentMonth = z.literal('currentMonth');
export const currentYear = z.literal('currentYear');
export const lastWeek = z.literal('lastWeek');
export const lastMonth = z.literal('lastMonth');
export const lastYear = z.literal('lastYear');
export const nextWeekPeriod = z.literal('nextWeekPeriod');
export const nextMonthPeriod = z.literal('nextMonthPeriod');
export const nextYearPeriod = z.literal('nextYearPeriod');
export const oneWeekAgo = z.literal('oneWeekAgo');
export const oneWeekFromNow = z.literal('oneWeekFromNow');
export const oneMonthAgo = z.literal('oneMonthAgo');
export const oneMonthFromNow = z.literal('oneMonthFromNow');
export const daysAgo = z.literal('daysAgo');
export const daysFromNow = z.literal('daysFromNow');
export const exactDate = z.literal('exactDate');
export const exactFormatDate = z.literal('exactFormatDate');

// date sub operation by isWithin
export const pastWeek = z.literal('pastWeek');
export const pastMonth = z.literal('pastMonth');
export const pastYear = z.literal('pastYear');
export const nextWeek = z.literal('nextWeek');
export const nextMonth = z.literal('nextMonth');
export const nextYear = z.literal('nextYear');
export const pastNumberOfDays = z.literal('pastNumberOfDays');
export const nextNumberOfDays = z.literal('nextNumberOfDays');

export const operators = z.union([
  is,
  isNot,
  contains,
  doesNotContain,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isEmpty,
  isNotEmpty,
  isAnyOf,
  isNoneOf,
  hasAnyOf,
  hasAllOf,
  isNotExactly,
  hasNoneOf,
  isExactly,
  isWithIn,
  isBefore,
  isAfter,
  isOnOrBefore,
  isOnOrAfter,
]);
export type IOperator = z.infer<typeof operators>;

export const subOperators = z.union([
  // date sub operation
  today,
  tomorrow,
  yesterday,
  currentWeek,
  lastWeek,
  nextWeekPeriod,
  currentMonth,
  lastMonth,
  nextMonthPeriod,
  currentYear,
  lastYear,
  nextYearPeriod,
  oneWeekAgo,
  oneWeekFromNow,
  oneMonthAgo,
  oneMonthFromNow,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
  // date sub operation by isWithin
  pastWeek,
  pastMonth,
  pastYear,
  nextWeek,
  nextMonth,
  nextYear,
  pastNumberOfDays,
  nextNumberOfDays,
]);
export type ISubOperator = z.infer<typeof subOperators>;

/*  antlr4ts char  */
export const $eq = z.literal('=');
export const $neq = z.literal('!=');
export const $gt = z.literal('>');
export const $gte = z.literal('>=');
export const $lt = z.literal('<');
export const $lte = z.literal('<=');
export const $like = z.literal('LIKE');
export const $in = z.literal('IN');
export const $has = z.literal('HAS');
export const $between = z.literal('BETWEEN');
export const $notLike = z.literal('NOT LIKE');
export const $notIn = z.literal('NOT IN');
export const $isNull = z.literal('IS NULL');
export const $isNotNull = z.literal('IS NOT NULL');
export const $isWithIn = z.literal('IS WITH IN');

export const symbols = z.union([
  $eq,
  $neq,
  $gt,
  $gte,
  $lt,
  $lte,
  $like,
  $in,
  $has,
  $notLike,
  $notIn,
  $isNull,
  $isNotNull,
]);
export type ISymbol = z.infer<typeof symbols>;

const mappingOperatorSymbol = {
  [is.value]: $eq.value,
  [isExactly.value]: $eq.value,

  [isNot.value]: $neq.value,

  [isGreater.value]: $gt.value,
  [isAfter.value]: $gt.value,
  [isGreaterEqual.value]: $gte.value,
  [isOnOrAfter.value]: $gte.value,

  [isLess.value]: $lt.value,
  [isBefore.value]: $lt.value,
  [isLessEqual.value]: $lte.value,
  [isOnOrBefore.value]: $lte.value,

  [contains.value]: $like.value,
  [doesNotContain.value]: $notLike.value,

  [isAnyOf.value]: $in.value,
  [hasAnyOf.value]: $in.value,
  [isNoneOf.value]: $notIn.value,
  [hasNoneOf.value]: $notIn.value,

  [hasAllOf.value]: $has.value,
  [isNotExactly.value]: $neq.value,

  // [isWithIn.value]: $between.value,

  [isEmpty.value]: $isNull.value,
  [isNotEmpty.value]: $isNotNull.value,

  [isWithIn.value]: $isWithIn.value,
};
/*  antlr4ts char  */

export const textFieldOperators = z.union([
  is,
  isNot,
  contains,
  doesNotContain,
  isEmpty,
  isNotEmpty,
]);
export type ITextFieldOperator = z.infer<typeof textFieldOperators>;
export const textFieldValidOperators = [
  is.value,
  isNot.value,
  contains.value,
  doesNotContain.value,
  isEmpty.value,
  isNotEmpty.value,
];

export const numberFieldOperators = z.union([
  is,
  isNot,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isEmpty,
  isNotEmpty,
]);
export type INumberFieldOperator = z.infer<typeof numberFieldOperators>;
export const numberFieldValidOperators = [
  is.value,
  isNot.value,
  isGreater.value,
  isGreaterEqual.value,
  isLess.value,
  isLessEqual.value,
  isEmpty.value,
  isNotEmpty.value,
];

export const booleanFieldOperators = is;
export type IBooleanFieldOperator = z.infer<typeof booleanFieldOperators>;
export const booleanFieldValidOperators = [is.value];

export const dateTimeFieldOperators = z.union([
  is,
  isNot,
  isWithIn,
  isBefore,
  isAfter,
  isOnOrBefore,
  isOnOrAfter,
  isEmpty,
  isNotEmpty,
]);
export type IDateTimeFieldOperator = z.infer<typeof dateTimeFieldOperators>;
export const dateTimeFieldValidOperators = [
  is.value,
  isNot.value,
  isWithIn.value,
  isBefore.value,
  isAfter.value,
  isOnOrBefore.value,
  isOnOrAfter.value,
  isEmpty.value,
  isNotEmpty.value,
];

export const dateTimeFieldSubOperators = z.union([
  today,
  tomorrow,
  yesterday,
  currentWeek,
  lastWeek,
  nextWeekPeriod,
  currentMonth,
  lastMonth,
  nextMonthPeriod,
  currentYear,
  lastYear,
  nextYearPeriod,
  oneWeekAgo,
  oneWeekFromNow,
  oneMonthAgo,
  oneMonthFromNow,
  daysAgo,
  daysFromNow,
  exactDate,
  exactFormatDate,
]);
export type IDateTimeFieldSubOperator = z.infer<typeof dateTimeFieldSubOperators>;
export const dateTimeFieldValidSubOperators = [
  today.value,
  tomorrow.value,
  yesterday.value,
  currentWeek.value,
  lastWeek.value,
  nextWeekPeriod.value,
  currentMonth.value,
  lastMonth.value,
  nextMonthPeriod.value,
  currentYear.value,
  lastYear.value,
  nextYearPeriod.value,
  oneWeekAgo.value,
  oneWeekFromNow.value,
  oneMonthAgo.value,
  oneMonthFromNow.value,
  daysAgo.value,
  daysFromNow.value,
  exactDate.value,
  exactFormatDate.value,
];

export const dateTimeFieldSubOperatorsByIsWithin = z.union([
  pastWeek,
  pastMonth,
  pastYear,
  nextWeek,
  nextMonth,
  nextYear,
  pastNumberOfDays,
  nextNumberOfDays,
]);
export type IDateTimeFieldSubOperatorByIsWithin = z.infer<
  typeof dateTimeFieldSubOperatorsByIsWithin
>;
export const dateTimeFieldValidSubOperatorsByIsWithin = [
  pastWeek.value,
  pastMonth.value,
  pastYear.value,
  nextWeek.value,
  nextMonth.value,
  nextYear.value,
  pastNumberOfDays.value,
  nextNumberOfDays.value,
];

export function getFilterOperatorMapping(field: FieldCore) {
  const validFilterOperators = getValidFilterOperators(field);

  return pick(mappingOperatorSymbol, validFilterOperators);
}

/**
 * Returns the valid filter operators for a given field value type.
 */
export function getValidFilterOperators(field: {
  cellValueType: CellValueType;
  type: FieldType;
  isMultipleCellValue?: boolean;
}): IOperator[] {
  let operationSet: IOperator[] = [];

  const { cellValueType, type, isMultipleCellValue } = field;

  // 1. First determine the operator roughly according to cellValueType
  switch (cellValueType) {
    case CellValueType.String: {
      operationSet = [...textFieldValidOperators];
      break;
    }
    case CellValueType.Number: {
      operationSet = [...numberFieldValidOperators];
      break;
    }
    case CellValueType.Boolean: {
      operationSet = [...booleanFieldValidOperators];
      break;
    }
    case CellValueType.DateTime: {
      operationSet = [...dateTimeFieldValidOperators];
      break;
    }
  }

  // 2. Then repair the operator according to fieldType
  switch (type) {
    case FieldType.SingleSelect: {
      if (isMultipleCellValue) {
        operationSet = [
          hasAnyOf.value,
          hasAllOf.value,
          isExactly.value,
          isNotExactly.value,
          hasNoneOf.value,
          isEmpty.value,
          isNotEmpty.value,
        ];
      } else {
        pullAll(operationSet, [contains.value, doesNotContain.value]);
        operationSet.splice(2, 0, isAnyOf.value, isNoneOf.value);
      }

      break;
    }
    case FieldType.MultipleSelect: {
      operationSet = [
        hasAnyOf.value,
        hasAllOf.value,
        isExactly.value,
        isNotExactly.value,
        hasNoneOf.value,
        isEmpty.value,
        isNotEmpty.value,
      ];
      break;
    }
    case FieldType.User:
    case FieldType.CreatedBy:
    case FieldType.LastModifiedBy:
    case FieldType.Link: {
      operationSet = isMultipleCellValue
        ? [hasAnyOf.value, hasAllOf.value, isExactly.value, hasNoneOf.value, isNotExactly.value]
        : [is.value, isNot.value, isAnyOf.value, isNoneOf.value];

      const fixLinkOperator = type === FieldType.Link ? [contains.value, doesNotContain.value] : [];

      operationSet = [...operationSet, ...fixLinkOperator, isEmpty.value, isNotEmpty.value];
      break;
    }
    case FieldType.Attachment: {
      operationSet = [isEmpty.value, isNotEmpty.value];
      break;
    }
  }

  return uniq(operationSet);
}

export function getValidFilterSubOperators(
  fieldType: FieldType,
  parentOperator: IDateTimeFieldOperator
): ISubOperator[] | undefined {
  if (fieldType !== FieldType.Date) {
    return undefined;
  }

  if (parentOperator === isWithIn.value) {
    return dateTimeFieldValidSubOperatorsByIsWithin;
  } else {
    return dateTimeFieldValidSubOperators;
  }
}

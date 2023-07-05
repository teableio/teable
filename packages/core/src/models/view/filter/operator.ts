/* eslint-disable @typescript-eslint/naming-convention */
import { pullAll } from 'lodash';
import { z } from 'zod';
import type { FieldCore } from '../../field';
import { CellValueType, FieldType } from '../../field';

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
export const hasAllOf = z.literal('hasAllOf');

/*  antlr4ts char  */
export const $eq = z.literal('=');
export const $neq = z.literal('!=');
export const $neq2 = z.literal('<>');
export const $gt = z.literal('>');
export const $gte = z.literal('>=');
export const $lt = z.literal('<');
export const $lte = z.literal('<=');
export const $like = z.literal('LIKE');
export const $in = z.literal('IN');
export const $has = z.literal('HAS');
export const $notLike = z.literal('NOT LIKE');
export const $notIn = z.literal('NOT IN');
export const $isNull = z.literal('IS NULL');
export const $isNotNull = z.literal('IS NOT NULL');

export const operatorCrossReferenceTable = new Map<string, string>([
  [$eq.value, is.value],

  [$neq.value, isNot.value],
  [$neq2.value, isNot.value],

  [$gt.value, isGreater.value],
  [$gte.value, isGreaterEqual.value],

  [$lt.value, isLess.value],
  [$lte.value, isLessEqual.value],

  [$like.value, contains.value],
  [$notLike.value, doesNotContain.value],

  [$in.value, isAnyOf.value],
  [$notIn.value, isNoneOf.value],

  [$has.value, hasAllOf.value],

  [$isNull.value, isEmpty.value],
  [$isNotNull.value, isNotEmpty.value],
]);
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
export const textFieldValidOperators: ITextFieldOperator[] = [
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
export const numberFieldValidOperators: INumberFieldOperator[] = [
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
export const booleanFieldValidOperators: IBooleanFieldOperator[] = [is.value];

export const dateTimeFieldOperators = numberFieldOperators;
export type IDateTimeFieldOperator = z.infer<typeof dateTimeFieldOperators>;
export const dateTimeFieldValidOperators: IDateTimeFieldOperator[] = numberFieldValidOperators;

export const allFieldOperators = z.array(
  z.union([
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
    hasAllOf,
  ])
);
export type IAllFieldOperators = z.infer<typeof allFieldOperators>;

/**
 * Returns the valid filter operators for a given field value type.
 */
export function getValidFilterOperators(field: FieldCore): IAllFieldOperators {
  const operationSet: IAllFieldOperators = [];

  // 1. First determine the operator roughly according to cellValueType
  switch (field.cellValueType) {
    case CellValueType.String: {
      operationSet.push(...textFieldValidOperators);
      break;
    }
    case CellValueType.Number: {
      operationSet.push(...numberFieldValidOperators);
      break;
    }
    case CellValueType.Boolean: {
      operationSet.push(...booleanFieldValidOperators);
      break;
    }
    case CellValueType.DateTime: {
      operationSet.push(...dateTimeFieldValidOperators);
      break;
    }
  }

  // 2. Then repair the operator according to fieldType
  switch (field.type) {
    case FieldType.SingleSelect: {
      pullAll(operationSet, [contains.value, doesNotContain.value]);
      operationSet.push(...[isAnyOf.value, isNoneOf.value]);
      break;
    }
    case FieldType.MultipleSelect: {
      pullAll(operationSet, [isNot.value, contains.value, doesNotContain.value]);
      operationSet.push(...[hasAllOf.value, isNoneOf.value]);
    }
  }

  // 3. Finally, the operator is determined according to isMultipleCellValue
  // if (field.isMultipleCellValue) {
  // }

  return operationSet;
}

import { z } from 'zod';

import type { Field } from '../../fields/Field';
import { FieldType } from '../../fields/FieldType';
import { CellValueType } from '../../fields/types/CellValueType';
import type { FieldValueType } from '../../fields/visitors/FieldValueTypeVisitor';

export const recordConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isNotExactly',
  'hasNoneOf',
  'isExactly',
  'isWithIn',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
]);
export type RecordConditionOperator = z.infer<typeof recordConditionOperatorSchema>;

export const textConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
]);
export type TextConditionOperator = z.infer<typeof textConditionOperatorSchema>;

export const numberConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
  'isEmpty',
  'isNotEmpty',
]);
export type NumberConditionOperator = z.infer<typeof numberConditionOperatorSchema>;

export const booleanConditionOperatorSchema = z.enum(['is']);
export type BooleanConditionOperator = z.infer<typeof booleanConditionOperatorSchema>;

export const dateConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'isWithIn',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isEmpty',
  'isNotEmpty',
]);
export type DateConditionOperator = z.infer<typeof dateConditionOperatorSchema>;

export const singleSelectConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'isEmpty',
  'isNotEmpty',
]);
export type SingleSelectConditionOperator = z.infer<typeof singleSelectConditionOperatorSchema>;

export const multipleSelectConditionOperatorSchema = z.enum([
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'isEmpty',
  'isNotEmpty',
]);
export type MultipleSelectConditionOperator = z.infer<typeof multipleSelectConditionOperatorSchema>;

export const userConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'isEmpty',
  'isNotEmpty',
]);
export type UserConditionOperator = z.infer<typeof userConditionOperatorSchema>;

export const linkConditionOperatorSchema = z.enum([
  'is',
  'isNot',
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isNotExactly',
  'hasNoneOf',
  'contains',
  'doesNotContain',
  'isEmpty',
  'isNotEmpty',
]);
export type LinkConditionOperator = z.infer<typeof linkConditionOperatorSchema>;

export const attachmentConditionOperatorSchema = z.enum(['isEmpty', 'isNotEmpty']);
export type AttachmentConditionOperator = z.infer<typeof attachmentConditionOperatorSchema>;

export const recordConditionOperatorsExpectingNull: ReadonlyArray<RecordConditionOperator> = [
  'isEmpty',
  'isNotEmpty',
];

export const recordConditionOperatorsExpectingArray: ReadonlyArray<RecordConditionOperator> = [
  'isAnyOf',
  'isNoneOf',
  'hasAnyOf',
  'hasAllOf',
  'isNotExactly',
  'hasNoneOf',
  'isExactly',
];

export const recordConditionDateModeSchema = z.enum([
  'today',
  'tomorrow',
  'yesterday',
  'currentWeek',
  'currentMonth',
  'currentYear',
  'lastWeek',
  'lastMonth',
  'lastYear',
  'nextWeekPeriod',
  'nextMonthPeriod',
  'nextYearPeriod',
  'oneWeekAgo',
  'oneWeekFromNow',
  'oneMonthAgo',
  'oneMonthFromNow',
  'daysAgo',
  'daysFromNow',
  'exactDate',
  'exactFormatDate',
  'pastWeek',
  'pastMonth',
  'pastYear',
  'nextWeek',
  'nextMonth',
  'nextYear',
  'pastNumberOfDays',
  'nextNumberOfDays',
]);
export type RecordConditionDateMode = z.infer<typeof recordConditionDateModeSchema>;

const unique = (values: ReadonlyArray<RecordConditionOperator>): RecordConditionOperator[] =>
  Array.from(new Set(values));

export const getValidRecordConditionOperators = (
  field: Field,
  valueType: FieldValueType
): RecordConditionOperator[] => {
  const cellType = valueType.cellValueType;
  const isMultiple = valueType.isMultipleCellValue.isMultiple();

  let operators: RecordConditionOperator[] = [];

  if (cellType.equals(CellValueType.string())) {
    operators = [...textConditionOperatorSchema.options];
  }

  if (cellType.equals(CellValueType.number())) {
    operators = [...numberConditionOperatorSchema.options];
  }

  if (cellType.equals(CellValueType.boolean())) {
    operators = [...booleanConditionOperatorSchema.options];
  }

  if (cellType.equals(CellValueType.dateTime())) {
    operators = [...dateConditionOperatorSchema.options];
  }

  const fieldType = field.type();

  if (fieldType.equals(FieldType.singleSelect())) {
    // For singleSelect with isMultiple (e.g., lookup/rollup), use multipleSelect operators
    // This matches v1 behavior where hasAnyOf, hasAllOf, etc. are valid for multiple single-selects
    operators = isMultiple
      ? [...multipleSelectConditionOperatorSchema.options]
      : [...singleSelectConditionOperatorSchema.options];
  }

  if (fieldType.equals(FieldType.multipleSelect())) {
    operators = [...multipleSelectConditionOperatorSchema.options];
  }

  if (
    fieldType.equals(FieldType.user()) ||
    fieldType.equals(FieldType.createdBy()) ||
    fieldType.equals(FieldType.lastModifiedBy())
  ) {
    operators = isMultiple
      ? ['hasAnyOf', 'hasAllOf', 'isExactly', 'hasNoneOf', 'isNotExactly', 'isEmpty', 'isNotEmpty']
      : ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'];
  }

  if (fieldType.equals(FieldType.link())) {
    operators = isMultiple
      ? [
          'hasAnyOf',
          'hasAllOf',
          'isExactly',
          'hasNoneOf',
          'isNotExactly',
          'contains',
          'doesNotContain',
          'isEmpty',
          'isNotEmpty',
        ]
      : [
          'is',
          'isNot',
          'isAnyOf',
          'isNoneOf',
          'contains',
          'doesNotContain',
          'isEmpty',
          'isNotEmpty',
        ];
  }

  if (fieldType.equals(FieldType.attachment())) {
    operators = [...attachmentConditionOperatorSchema.options];
  }

  // ConditionalLookup and ConditionalRollup are "flexible" computed field types
  // that may wrap any inner field type. Their ConditionSpec classes handle all
  // operators via exhaustive match, so accept all operators here.
  if (
    fieldType.equals(FieldType.conditionalLookup()) ||
    fieldType.equals(FieldType.conditionalRollup())
  ) {
    operators = [...recordConditionOperatorSchema.options];
  }

  return unique(operators);
};

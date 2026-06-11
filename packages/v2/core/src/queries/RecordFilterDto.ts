import { z } from 'zod';
import {
  recordConditionDateModeSchema,
  recordConditionOperatorSchema,
  recordConditionOperatorsExpectingArray,
  recordConditionOperatorsExpectingNull,
  type RecordConditionDateMode,
  type RecordConditionOperator,
} from '../domain/table/records/specs/RecordConditionOperators';

export const recordFilterOperatorSchema = recordConditionOperatorSchema;
export type RecordFilterOperator = RecordConditionOperator;

export const recordFilterDateModeSchema = recordConditionDateModeSchema;
export type RecordFilterDateMode = RecordConditionDateMode;

const dateValueSchema = z
  .object({
    mode: recordFilterDateModeSchema,
    numberOfDays: z.coerce.number().int().nonnegative().optional(),
    exactDate: z.string().datetime({ precision: 3, offset: true }).optional(),
    timeZone: z.string(),
  })
  .superRefine((val, ctx) => {
    const requiresExact = val.mode === 'exactDate' || val.mode === 'exactFormatDate';
    const requiresDays =
      val.mode === 'daysAgo' ||
      val.mode === 'daysFromNow' ||
      val.mode === 'pastNumberOfDays' ||
      val.mode === 'nextNumberOfDays';

    if (requiresExact && !val.exactDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When mode is '${val.mode}', exactDate is required`,
      });
    }

    if (requiresDays && val.numberOfDays == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When mode is '${val.mode}', numberOfDays is required`,
      });
    }
  });

export type RecordFilterDateValue = z.infer<typeof dateValueSchema>;

const literalValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const literalValueListSchema = literalValueSchema.array().nonempty();

const fieldReferenceValueSchema = z.object({
  type: z.literal('field'),
  fieldId: z.string(),
  tableId: z.string().optional(),
});
export type RecordFilterFieldReferenceValue = z.infer<typeof fieldReferenceValueSchema>;

export const recordFilterValueSchema = z
  .union([literalValueSchema, literalValueListSchema, dateValueSchema, fieldReferenceValueSchema])
  .nullable();
export type RecordFilterValue = z.infer<typeof recordFilterValueSchema>;

const operatorsExpectingNull = recordConditionOperatorsExpectingNull;
const operatorsExpectingArray = recordConditionOperatorsExpectingArray;

const normalizeUnaryOperatorValue = (input: unknown): unknown => {
  if (input == null || typeof input !== 'object') return input;

  const value = input as Record<string, unknown>;
  if (typeof value.operator !== 'string') {
    return input;
  }

  const operator = value.operator as RecordFilterOperator;
  if (!operatorsExpectingNull.includes(operator)) {
    return input;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return input;

  return {
    ...value,
    value: null,
  };
};

export const recordFilterConditionSchema = z.preprocess(
  normalizeUnaryOperatorValue,
  z
    .object({
      fieldId: z.string(),
      operator: recordFilterOperatorSchema,
      value: recordFilterValueSchema,
    })
    .superRefine((val, ctx) => {
      if (operatorsExpectingNull.includes(val.operator)) {
        if (val.value !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Operator '${val.operator}' requires null value`,
          });
        }
        return;
      }

      if (val.value === null) {
        // Allow is/isNot with null until field-aware normalization can distinguish
        // checkbox unchecked checks from incomplete non-checkbox UI filters.
        if (val.operator !== 'is' && val.operator !== 'isNot') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Operator '${val.operator}' does not allow null value`,
          });
        }
        return;
      }

      if (operatorsExpectingArray.includes(val.operator)) {
        if (!Array.isArray(val.value) && !isRecordFilterFieldReferenceValue(val.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Operator '${val.operator}' requires an array value`,
          });
        }
        return;
      }

      if (Array.isArray(val.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Operator '${val.operator}' does not allow array values`,
        });
      }
    })
);

export type RecordFilterCondition = z.infer<typeof recordFilterConditionSchema>;

export const recordFilterConjunctionSchema = z.enum(['and', 'or']);
export type RecordFilterConjunction = z.infer<typeof recordFilterConjunctionSchema>;

export type RecordFilterGroup = {
  conjunction: RecordFilterConjunction;
  items: RecordFilterNode[];
};

export type RecordFilterNot = {
  not: RecordFilterNode;
};

export type RecordFilterNode = RecordFilterCondition | RecordFilterGroup | RecordFilterNot;

const recordFilterGroupSchema: z.ZodType<RecordFilterGroup> = z.object({
  conjunction: recordFilterConjunctionSchema,
  items: z.array(z.lazy(() => recordFilterNodeSchema)).min(1),
});

const recordFilterNotSchema: z.ZodType<RecordFilterNot> = z.object({
  not: z.lazy(() => recordFilterNodeSchema),
});

export const recordFilterNodeSchema: z.ZodType<RecordFilterNode> = z.lazy(() =>
  z.union([recordFilterConditionSchema, recordFilterGroupSchema, recordFilterNotSchema])
);

export const recordFilterSchema = recordFilterNodeSchema.nullable();
export type RecordFilter = z.infer<typeof recordFilterSchema>;

export const isRecordFilterFieldReferenceValue = (
  value: unknown
): value is RecordFilterFieldReferenceValue => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as { type?: string }).type === 'field' &&
    typeof (value as { fieldId?: unknown }).fieldId === 'string'
  );
};

export const isRecordFilterDateValue = (value: unknown): value is RecordFilterDateValue => {
  return typeof value === 'object' && value !== null && 'mode' in value;
};

export const isRecordFilterCondition = (node: RecordFilterNode): node is RecordFilterCondition => {
  return typeof (node as RecordFilterCondition).fieldId === 'string';
};

export const isRecordFilterGroup = (node: RecordFilterNode): node is RecordFilterGroup => {
  return typeof (node as RecordFilterGroup).conjunction === 'string';
};

export const isRecordFilterNot = (node: RecordFilterNode): node is RecordFilterNot => {
  return typeof (node as RecordFilterNot).not === 'object';
};

export const recordFilterOperatorsExpectingNull = operatorsExpectingNull;
export const recordFilterOperatorsExpectingArray = operatorsExpectingArray;

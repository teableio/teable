import { z } from 'zod';
import { dataFieldCellValueSchema } from '../../field/derivate/date.field';
import { timeZoneStringSchema } from '../../field/formatting/time-zone';
import type { IOperator, ISymbol } from './operator';
import {
  daysAgo,
  daysFromNow,
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isAnyOf,
  isEmpty,
  isExactly,
  isNoneOf,
  isNotEmpty,
  nextNumberOfDays,
  operators,
  pastNumberOfDays,
  subOperators,
  symbols,
  isNotExactly,
} from './operator';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const modesRequiringDays: string[] = [
  daysAgo.value,
  daysFromNow.value,
  pastNumberOfDays.value,
  nextNumberOfDays.value,
];

export const dateFilterSchema = z
  .object({
    mode: subOperators,
    numberOfDays: z.coerce.number().int().nonnegative().optional(),
    exactDate: dataFieldCellValueSchema.optional(),
    timeZone: timeZoneStringSchema,
  })
  .superRefine((val, ctx) => {
    if (['exactDate', 'exactFormatDate'].includes(val.mode) && !val.exactDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When the mode is set to '${val.mode}', an '${val.mode}' must be provided`,
      });
    } else if (modesRequiringDays.includes(val.mode) && val.numberOfDays == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When the mode is '${val.mode}', a numerical value for '${val.mode}' must be provided`,
      });
    }
  });
export type IDateFilter = z.infer<typeof dateFilterSchema>;

export const literalValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ILiteralValue = z.infer<typeof literalValueSchema>;
export const literalValueListSchema = literalValueSchema.array().nonempty();
export type ILiteralValueList = z.infer<typeof literalValueListSchema>;

export const filterValueSchema = z
  .union([literalValueSchema, literalValueListSchema, dateFilterSchema])
  .nullable();
export type IFilterValue = z.infer<typeof filterValueSchema>;

export type IFilterOperator = IOperator;
export type IFilterSymbolOperator = ISymbol;

const operatorsExpectingNull: string[] = [isEmpty.value, isNotEmpty.value];
const operatorsExpectingArray: string[] = [
  isAnyOf.value,
  isNoneOf.value,
  hasAnyOf.value,
  hasAllOf.value,
  isNotExactly.value,
  hasNoneOf.value,
  isExactly.value,
];

export const baseFilterOperatorSchema = z.object({
  isSymbol: z.literal(false).optional(),
  fieldId: z.string(),
  value: filterValueSchema,
  operator: operators,
});

const filterOperatorRefineBase = z.object({
  value: filterValueSchema,
  operator: operators,
});

export const refineExtendedFilterOperatorSchema = <
  T extends z.infer<typeof filterOperatorRefineBase>,
>(
  schema: z.ZodSchema<T>
): z.ZodSchema<T> =>
  schema.superRefine((val, ctx) => {
    if (!val.value) {
      return z.NEVER;
    }
    if (operatorsExpectingNull.includes(val.operator)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `For the operator '${val.operator}', the 'value' should be null`,
      });
    }

    if (operatorsExpectingArray.includes(val.operator) && !Array.isArray(val.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `For the operator '${val.operator}', the 'value' should be an array`,
      });
    }

    if (!operatorsExpectingArray.includes(val.operator) && Array.isArray(val.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `For the operator '${val.operator}', the 'value' should not be an array`,
      });
    }
  });

export const filterOperatorSchema = refineExtendedFilterOperatorSchema(baseFilterOperatorSchema);

export const filterSymbolOperatorSchema = z.object({
  isSymbol: z.literal(true),
  fieldId: z.string(),
  value: filterValueSchema,
  operator: symbols,
});

export const filterItemSchema = z.union([filterOperatorSchema, filterSymbolOperatorSchema]);

export type IFilterItem = z.infer<typeof filterItemSchema>;

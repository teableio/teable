import { z } from 'zod';
import { dataFieldCellValueSchema, timeZoneStringSchema } from '../../field';
import type { IOperator, ISymbol } from './operator';
import { operators, subOperators, symbols } from './operator';

export const filterMetaValueByDate = z
  .object({
    mode: subOperators,
    numberOfDays: z.number().int().nonnegative().optional(),
    exactDate: dataFieldCellValueSchema.optional(),
    timeZone: timeZoneStringSchema,
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'exactDate' && !val.exactDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mode is '${val.mode}', 'exactDate' must be entered`,
      });
    } else if (
      ['daysAgo', 'daysFromNow', 'pastNumberOfDays', 'nextNumberOfDays'].includes(val.mode) &&
      (val.numberOfDays === null || val.numberOfDays === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mode is '${val.mode}', 'numberOfDays' must be entered`,
      });
    }
  });
export type IFilterMetaValueByDate = z.infer<typeof filterMetaValueByDate>;

const filterMetaValue = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
    filterMetaValueByDate,
  ])
  .nullable();
export type IFilterMetaValue = z.infer<typeof filterMetaValue>;

export type IFilterMetaOperator = IOperator;
export type IFilterMetaOperatorBySymbol = ISymbol;

const filterMetaOperator = z
  .object({
    isSymbol: z.literal(false).optional(),
    fieldId: z.string(),
    value: filterMetaValue,
    operator: operators,
  })
  .superRefine((val, ctx) => {
    if ((val.operator === 'isEmpty' || val.operator === 'isNotEmpty') && val.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator is '${val.operator}', 'value' should be null.`,
      });
    } else if (
      ['isAnyOf', 'isNoneOf', 'hasAnyOf', 'hasAllOf', 'hasNoneOf', 'isExactly'].includes(
        val.operator
      ) &&
      !Array.isArray(val.value)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator is '${val.operator}', 'value' should be array.`,
      });
    }
  });

const filterMetaOperatorBySymbol = z.object({
  isSymbol: z.literal(true),
  fieldId: z.string(),
  value: filterMetaValue,
  operator: symbols,
});

export const filterMeta = z.union([filterMetaOperator, filterMetaOperatorBySymbol]);

export type IFilterMeta = z.infer<typeof filterMeta>;

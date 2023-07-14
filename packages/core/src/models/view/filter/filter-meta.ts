import { z } from 'zod';
import type { IOperator, ISymbol } from './operator';
import { operators, symbols } from './operator';

const filterMetaValue = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .nullable();
export type IFilterMetaValue = z.infer<typeof filterMetaValue>;

export type IFilterMetaOperator = IOperator;
export type IFilterMetaOperatorBySymbol = ISymbol;

const filterMetaOperator = z.object({
  isSymbol: z.literal(false).optional(),
  fieldId: z.string(),
  value: filterMetaValue,
  operator: operators,
});

const filterMetaOperatorBySymbol = z.object({
  isSymbol: z.literal(true),
  fieldId: z.string(),
  value: filterMetaValue,
  operator: symbols,
});

export const filterMeta = z.union([filterMetaOperator, filterMetaOperatorBySymbol]);

export type IFilterMeta = z.infer<typeof filterMeta>;

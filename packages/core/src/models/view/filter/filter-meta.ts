import { z } from 'zod';
import {
  booleanFieldOperators,
  dateTimeFieldOperators,
  numberFieldOperators,
  textFieldOperators,
} from './operator';

const filterMetaValue = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .nullable();
export type IFilterMetaValue = z.infer<typeof filterMetaValue>;

const filterMetaOperator = z.union([
  textFieldOperators,
  numberFieldOperators,
  booleanFieldOperators,
  dateTimeFieldOperators,
]);
export type IFilterMetaOperator = z.infer<typeof filterMetaOperator>;

export const filterMeta = z.object({
  fieldId: z.string(),
  operator: filterMetaOperator,
  value: filterMetaValue,
});

export type IFilterMeta = z.infer<typeof filterMeta>;

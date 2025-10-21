import { z } from '../../../zod';
import { filterSchema } from '../../view/filter';
import { SortFunc } from '../../view/sort';
import { CONDITIONAL_QUERY_MAX_LIMIT } from '../conditional.constants';
import { rollupFieldOptionsSchema } from './rollup-option.schema';

export const conditionalRollupFieldOptionsSchema = rollupFieldOptionsSchema.extend({
  baseId: z.string().optional(),
  foreignTableId: z.string().optional(),
  lookupFieldId: z.string().optional(),
  filter: filterSchema.optional(),
  sort: z
    .object({
      fieldId: z.string(),
      order: z.nativeEnum(SortFunc),
    })
    .optional(),
  limit: z.number().int().positive().max(CONDITIONAL_QUERY_MAX_LIMIT).optional(),
});

export type IConditionalRollupFieldOptions = z.infer<typeof conditionalRollupFieldOptionsSchema>;

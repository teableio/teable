import { z } from '../../../zod';
import { filterSchema } from '../../view/filter';
import { rollupFieldOptionsSchema } from './rollup-option.schema';

export const referenceLookupFieldOptionsSchema = rollupFieldOptionsSchema.extend({
  baseId: z.string().optional(),
  foreignTableId: z.string().optional(),
  lookupFieldId: z.string().optional(),
  filter: filterSchema.optional(),
});

export type IReferenceLookupFieldOptions = z.infer<typeof referenceLookupFieldOptionsSchema>;

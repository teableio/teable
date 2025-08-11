import { z } from '../../../zod';

// Last modified by field options
export const lastModifiedByFieldOptionsSchema = z.object({}).strict();

export type ILastModifiedByFieldOptions = z.infer<typeof lastModifiedByFieldOptionsSchema>;

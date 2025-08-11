import { z } from '../../../zod';

export const lastModifiedByFieldOptionsSchema = z.object({}).strict();

export type ILastModifiedByFieldOptions = z.infer<typeof lastModifiedByFieldOptionsSchema>;

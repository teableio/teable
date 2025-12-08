import { z } from '../../../zod';

export const lastModifiedByFieldOptionsSchema = z
  .object({
    trackedFieldIds: z.array(z.string()).optional(),
  })
  .strict();

export type ILastModifiedByFieldOptions = z.infer<typeof lastModifiedByFieldOptionsSchema>;

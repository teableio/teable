import { z } from '../zod';

export const crossSpaceAffectedFieldBaseSchema = z.object({
  fieldId: z.string(),
  fieldName: z.string(),
  type: z.string(),
});

export type ICrossSpaceAffectedFieldBase = z.infer<typeof crossSpaceAffectedFieldBaseSchema>;

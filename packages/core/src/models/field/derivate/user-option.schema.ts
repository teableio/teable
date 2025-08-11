import { z } from '../../../zod';

const userIdSchema = z
  .string()
  .startsWith('usr')
  .or(z.enum(['me']));

export const userFieldOptionsSchema = z.object({
  isMultiple: z.boolean().optional().openapi({
    description: 'Allow adding multiple users',
  }),
  shouldNotify: z.boolean().optional().openapi({
    description: 'Notify users when their name is added to a cell',
  }),
  defaultValue: z.union([userIdSchema, z.array(userIdSchema)]).optional(),
});

export type IUserFieldOptions = z.infer<typeof userFieldOptionsSchema>;

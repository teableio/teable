import { z } from '../../../zod';

const userIdSchema = z
  .string()
  .startsWith('usr')
  .or(z.enum(['me']));

export const userFieldOptionsSchema = z.object({
  isMultiple: z.boolean().optional().meta({
    description: 'Allow adding multiple users',
  }),
  shouldNotify: z.boolean().optional().meta({
    description: 'Notify users when their name is added to a cell',
  }),
  defaultValue: z
    .union([userIdSchema, z.array(userIdSchema)])
    .optional()
    .nullable(),
});

export type IUserFieldOptions = z.infer<typeof userFieldOptionsSchema>;

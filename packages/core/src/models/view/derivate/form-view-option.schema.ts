import { z } from '../../../zod';

export const formViewOptionSchema = z
  .object({
    coverUrl: z.string().optional().openapi({ description: 'The cover url of the form' }),
    logoUrl: z.string().optional().openapi({ description: 'The logo url of the form' }),
    submitLabel: z
      .string()
      .optional()
      .openapi({ description: 'The submit button text of the form' }),
  })
  .strict();

export type IFormViewOptions = z.infer<typeof formViewOptionSchema>;

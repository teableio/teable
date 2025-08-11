import { z } from '../../../zod';

export const kanbanViewOptionSchema = z
  .object({
    stackFieldId: z
      .string()
      .optional()
      .openapi({ description: 'The field id of the Kanban stack.' }),
    coverFieldId: z.string().optional().nullable().openapi({
      description:
        'The cover field id is a designated attachment field id, the contents of which appear at the top of each Kanban card.',
    }),
    isCoverFit: z.boolean().optional().openapi({
      description: 'If true, cover images are resized to fit Kanban cards.',
    }),
    isFieldNameHidden: z.boolean().optional().openapi({
      description: 'If true, hides field name in the Kanban cards.',
    }),
    isEmptyStackHidden: z.boolean().optional().openapi({
      description: 'If true, hides empty stacks in the Kanban.',
    }),
  })
  .strict();

export type IKanbanViewOptions = z.infer<typeof kanbanViewOptionSchema>;

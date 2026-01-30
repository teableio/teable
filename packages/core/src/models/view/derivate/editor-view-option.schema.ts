import { z } from '../../../zod';

export const editorViewOptionSchema = z
  .object({
    editorFieldId: z.string().optional().nullable().meta({
      description:
        'The field id of the long text field to edit in the Editor view. Only long text fields are supported.',
    }),
  })
  .strict();

export type IEditorViewOptions = z.infer<typeof editorViewOptionSchema>;

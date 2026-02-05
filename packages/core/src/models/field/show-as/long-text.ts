import { z } from 'zod';

export enum LongTextDisplayType {
  Markdown = 'markdown',
}

export const longTextShowAsSchema = z
  .object({
    type: z.nativeEnum(LongTextDisplayType).meta({
      description:
        'can display as markdown in long text field with a button to open a rich text editor',
    }),
  })
  .describe('Only be used in long text field');

export type ILongTextShowAs = z.infer<typeof longTextShowAsSchema>;

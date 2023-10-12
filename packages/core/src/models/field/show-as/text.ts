import { z } from 'zod';

export enum SingleLineTextDisplayType {
  Url = 'url',
  Email = 'email',
  Phone = 'phone',
}

export const singleLineTextShowAsSchema = z.object({
  type: z.nativeEnum(SingleLineTextDisplayType),
});

export type ISingleLineTextShowAs = z.infer<typeof singleLineTextShowAsSchema>;

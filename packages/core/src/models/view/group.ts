import { z } from 'zod';
import { orders } from './sort';

export const groupItemSchema = z.object({
  fieldId: z.string(),
  order: orders,
});

export const groupSchema = groupItemSchema.array().nullable();

export type IGroupItem = z.infer<typeof groupItemSchema>;

export type IGroup = z.infer<typeof groupSchema>;

export const groupStringSchema = z.string().transform((val, ctx) => {
  let jsonValue;
  try {
    jsonValue = JSON.parse(val);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid JSON string',
    });
    return z.NEVER;
  }
  return groupSchema.parse(jsonValue);
});

export function parseGroup(queryGroup?: IGroup): IGroup | undefined {
  if (queryGroup == null) return;

  const parsedGroup = groupSchema.safeParse(queryGroup);
  return parsedGroup.success ? parsedGroup.data?.slice(0, 3) : undefined;
}

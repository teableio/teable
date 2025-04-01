import { z } from '../../../zod';
import { orderSchema } from '../sort';

export const groupItemSchema = z.object({
  fieldId: z.string().openapi({
    description: 'The id of the field.',
  }),
  order: orderSchema,
});

export const groupSchema = groupItemSchema.array().nullable();

export const viewGroupRoSchema = z.object({
  group: groupSchema.nullable(),
});

export type IViewGroupRo = z.infer<typeof viewGroupRoSchema>;

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

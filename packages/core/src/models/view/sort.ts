import { z } from 'zod';

export const asc = z.literal('asc');

export const desc = z.literal('desc');

export type IOrder = z.infer<typeof orders>;

const orders = z.union([asc, desc]);

export const sortItemSchema = z.object({
  fieldId: z.string(),
  order: orders,
});

export const sortSchema = z.object({
  sortObjs: sortItemSchema.array(),
  shouldAutoSort: z.boolean(),
});

export const sortStringSchema = z.string().transform((val, ctx) => {
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
  return sortSchema.parse(jsonValue);
});

export type ISortItem = z.infer<typeof sortItemSchema>;

export type ISort = z.infer<typeof sortSchema>;

export function mergeWithDefaultSort(
  defaultViewSort: string | null,
  querySort?: ISort['sortObjs']
) {
  if (!defaultViewSort && !querySort) {
    return [];
  }

  const parseSort = sortStringSchema.safeParse(defaultViewSort);

  const viewSort = parseSort.success ? parseSort.data : undefined;

  let mergeSort = viewSort?.sortObjs || [];

  if (querySort?.length) {
    mergeSort = mergeSort.concat(querySort);
  }

  return mergeSort;
}

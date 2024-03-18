import { IdPrefix } from '../../../utils';
import { z } from '../../../zod';
import { SortFunc } from './sort-func.enum';

export const orderSchema = z.nativeEnum(SortFunc);

export const sortItemSchema = z.object({
  fieldId: z.string().startsWith(IdPrefix.Field).openapi({
    description: 'The id of the field.',
  }),
  order: orderSchema,
});

export const sortSchema = z
  .object({
    sortObjs: sortItemSchema.array(),
    manualSort: z.boolean().optional(),
  })
  .nullable();

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

export const manualSortRoSchema = z.object({
  sortObjs: sortItemSchema.array(),
});

export type IManualSortRo = z.infer<typeof manualSortRoSchema>;

export function mergeWithDefaultSort(
  defaultViewSort?: string | null,
  querySort?: ISortItem[]
): ISortItem[] {
  if (!defaultViewSort && !querySort) {
    return [];
  }

  const parseSort = sortStringSchema.safeParse(defaultViewSort);

  const viewSort = parseSort.success ? parseSort.data : undefined;

  // should clear sort query when sort manually
  if (viewSort?.manualSort && !querySort?.length) {
    return [];
  }

  let mergeSort = querySort || [];
  const sortObjs = viewSort?.sortObjs || [];

  if (sortObjs?.length) {
    // merge the same fieldId item, query first
    const map = new Map(mergeSort.map((sortItem) => [sortItem.fieldId, sortItem]));
    sortObjs.forEach((sortItem) => map.set(sortItem.fieldId, sortItem));
    mergeSort = Array.from(map.values());
  }

  return mergeSort;
}

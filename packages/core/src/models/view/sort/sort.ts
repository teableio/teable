import { z } from '../../../zod';
import { SortFunc } from './sort-func.enum';

export const orderSchema = z.enum(SortFunc);

export const sortItemSchema = z.object({
  fieldId: z.string().meta({
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

/**
 * Drop sort items that reference fields outside `readableFieldIds`.
 *
 * Use this only for persisted view defaults (view/share-view sort), so a
 * permission change does not make the saved view unusable. Explicit
 * client-supplied sorts must NOT be stripped — they are rejected server-side
 * so a query cannot silently change ordering semantics. A `undefined`
 * readable set means the readable fields are unknown (e.g. fields not loaded
 * yet) and passes the sort through unchanged.
 */
export const stripSortByReadableFieldIds = (
  sort: ISort | null | undefined,
  readableFieldIds: ReadonlySet<string> | undefined
): ISort | undefined => {
  if (!sort) {
    return undefined;
  }
  if (readableFieldIds == null) {
    return sort;
  }
  const sortObjs = sort.sortObjs.filter((item) => readableFieldIds.has(item.fieldId));
  return sortObjs.length ? { ...sort, sortObjs } : undefined;
};

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

  const mergeSort = viewSort?.sortObjs || [];

  if (querySort?.length) {
    // merge the same fieldId item, query first
    const map = new Map(querySort.map((sortItem) => [sortItem.fieldId, sortItem]));
    mergeSort.forEach((sortItem) => {
      !map.has(sortItem.fieldId) && map.set(sortItem.fieldId, sortItem);
    });
    return Array.from(map.values());
  }

  return mergeSort;
}

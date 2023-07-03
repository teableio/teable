import { z } from 'zod';
import { conjunction } from './conjunction';
import type { IFilterMeta } from './filter-meta';
import { filterMeta } from './filter-meta';

const baseFilterSet = z.object({
  conjunction: conjunction,
});

export type IFilterSet = z.infer<typeof baseFilterSet> & {
  filterSet: (IFilterMeta | IFilterSet)[];
};

export const filterSet: z.ZodType<IFilterSet> = z.lazy(() =>
  baseFilterSet.extend({
    filterSet: z.array(z.union([filterMeta, filterSet])),
  })
);

export const filter = z.object({
  filterSet: z.array(z.union([filterMeta, filterSet])),
  conjunction: conjunction,
});

export type IFilter = z.infer<typeof filter>;

export const filterString = z
  .string()
  .refine(
    (value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: 'Invalid JSON string',
    }
  )
  .transform((value) => JSON.parse(value) as IFilter);

export async function mergeWithDefaultFilter(
  defaultViewFilter?: string | null,
  queryFilter?: IFilter
): Promise<IFilter | undefined> {
  if (!defaultViewFilter && !queryFilter) {
    return undefined;
  }

  const parseFilter = await filterString.safeParseAsync(defaultViewFilter);
  const viewFilter = parseFilter.success ? parseFilter.data : undefined;

  let mergeFilter = viewFilter;
  if (queryFilter) {
    if (viewFilter) {
      mergeFilter = {
        filterSet: [{ filterSet: [viewFilter, queryFilter], conjunction: 'and' }],
        conjunction: 'and',
      };
    } else {
      mergeFilter = queryFilter;
    }
  }
  return mergeFilter;
}

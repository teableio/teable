import { z } from 'zod';
import { conjunctionSchema } from './conjunction';
import type { IFilterItem } from './filter-item';
import { filterItemSchema } from './filter-item';

export const baseFilterSetSchema = z.object({
  conjunction: conjunctionSchema,
});

export type IFilterSet = z.infer<typeof baseFilterSetSchema> & {
  filterSet: (IFilterItem | IFilterSet)[];
};

export const nestedFilterItemSchema: z.ZodType<IFilterSet> = baseFilterSetSchema.extend({
  filterSet: z.lazy(() => z.union([filterItemSchema, nestedFilterItemSchema]).array()),
});

export const FILTER_DESCRIPTION =
  'A filter object used to filter results. It allows complex query conditions based on fields, operators, and values. For a more convenient experience, filterByTql is recommended, notice: if filterByTql is provided, current filter option will not take effect.';

export const filterSchema = nestedFilterItemSchema.nullable().openapi({
  type: 'object',
  description: FILTER_DESCRIPTION,
});

export type IFilter = z.infer<typeof filterSchema>;

export const filterRoSchema = z.object({
  filter: filterSchema,
});

export type IFilterRo = z.infer<typeof filterRoSchema>;

export const filterStringSchema = z.string().transform((val, ctx) => {
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
  return filterSchema.parse(jsonValue);
});

export function mergeWithDefaultFilter(
  defaultViewFilter?: string | null,
  queryFilter?: IFilter
): IFilter | undefined {
  if (!defaultViewFilter && !queryFilter) {
    return undefined;
  }

  const parseFilter = filterStringSchema.safeParse(defaultViewFilter);
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

export const mergeFilter = (filter1?: IFilter, filter2?: IFilter) => {
  const parsedFilter1 = filterSchema.safeParse(filter1);
  const finalFilter1 = parsedFilter1.success ? parsedFilter1.data : undefined;
  const parsedFilter2 = filterSchema.safeParse(filter2);
  const finalFilter2 = parsedFilter2.success ? parsedFilter2.data : undefined;

  if (!finalFilter1 && !finalFilter2) return;

  if (!finalFilter1) return finalFilter2;

  if (!finalFilter2) return finalFilter1;

  return {
    filterSet: [{ filterSet: [finalFilter1, finalFilter2], conjunction: 'and' }],
    conjunction: 'and',
  } as IFilter;
};

export function extractDefaultFieldsFromFilters(filters: IFilterSet | null | undefined): {
  [fieldId: string]: unknown;
} {
  const result: { [fieldId: string]: unknown } = {};
  const repeatedFieldIds = new Set<string>();

  function handleFilterItem(filter: IFilterItem | null | undefined) {
    if (filter?.operator === 'is' && filter.fieldId) {
      if (filter.fieldId in result) {
        // mark as repeat and delete
        delete result[filter.fieldId];
        repeatedFieldIds.add(filter.fieldId);
      } else if (!repeatedFieldIds.has(filter.fieldId)) result[filter.fieldId] = filter.value;
    }
  }

  // recursively traverse the filters object
  function traverse(filter: IFilterSet | IFilterItem | null | undefined) {
    if (filter && 'filterSet' in filter) filter.filterSet.forEach(traverse);
    else if (filter) handleFilterItem(filter);
  }

  traverse(filters);

  return result;
}

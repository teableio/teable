import { z } from 'zod';
import type { IConjunction } from './conjunction';
import { and, conjunctionSchema } from './conjunction';
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
  'A filter object for complex query conditions based on fields, operators, and values. Use our visual query builder at https://app.teable.ai/developer/tool/query-builder to build filters.';

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

export const mergeFilter = (
  filter1?: IFilter,
  filter2?: IFilter,
  conjunction: IConjunction = and.value
) => {
  const parsedFilter1 = filterSchema.safeParse(filter1);
  const finalFilter1 = parsedFilter1.success ? parsedFilter1.data : undefined;
  const parsedFilter2 = filterSchema.safeParse(filter2);
  const finalFilter2 = parsedFilter2.success ? parsedFilter2.data : undefined;

  if (!finalFilter1 && !finalFilter2) return;

  if (!finalFilter1) return finalFilter2;

  if (!finalFilter2) return finalFilter1;

  return {
    filterSet: [{ filterSet: [finalFilter1, finalFilter2], conjunction }],
    conjunction,
  } as IFilter;
};

export const extractFieldIdsFromFilter = (filter?: IFilter): string[] => {
  if (!filter) return [];

  const fieldIds: string[] = [];

  const traverse = (filterItem: IFilter | IFilterItem) => {
    if (filterItem && 'fieldId' in filterItem) {
      fieldIds.push(filterItem.fieldId);
    } else if (filterItem && 'filterSet' in filterItem) {
      filterItem.filterSet.forEach((item) => traverse(item));
    }
  };

  traverse(filter);
  return [...new Set(fieldIds)];
};

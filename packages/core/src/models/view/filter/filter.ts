import { z } from 'zod';
import { FieldType } from '../../field/constant';
import type { IConjunction } from './conjunction';
import { and, conjunctionSchema } from './conjunction';
import type { IFilterItem } from './filter-item';
import { filterItemSchema, isFieldReferenceValue } from './filter-item';
import type { IDateTimeFieldOperator } from './operator';
import { getValidFilterSubOperators, isWithIn } from './operator';

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

export const filterSchema = nestedFilterItemSchema.nullable().meta({
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
  const finalFilter1 = filter1;
  const finalFilter2 = filter2;

  if (!finalFilter1 && !finalFilter2) return;

  if (!finalFilter1) return finalFilter2;

  if (!finalFilter2) return finalFilter1;

  return {
    filterSet: [{ filterSet: [finalFilter1, finalFilter2], conjunction }],
    conjunction,
  } as IFilter;
};

export const extractFieldIdsFromFilter = (
  filter?: IFilter,
  includeValueFieldIds = false
): string[] => {
  if (!filter) return [];

  const fieldIds: string[] = [];

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const traverse = (filterItem: IFilter | IFilterItem) => {
    if (filterItem && 'fieldId' in filterItem) {
      fieldIds.push(filterItem.fieldId);

      if (includeValueFieldIds) {
        const value = filterItem.value;
        if (isFieldReferenceValue(value)) {
          fieldIds.push(value.fieldId);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            if (isFieldReferenceValue(entry)) {
              fieldIds.push(entry.fieldId);
            }
          }
        }
      }
    } else if (filterItem && 'filterSet' in filterItem) {
      filterItem.filterSet.forEach((item) => traverse(item));
    }
  };

  traverse(filter);
  return [...new Set(fieldIds)];
};

export interface IFilterValidationError {
  fieldId: string;
  operator: string;
  mode?: string;
  message: string;
}

/**
 * Validate filter operator and mode compatibility
 * Returns an array of validation errors if any, empty array if valid
 * @param filter - The filter to validate
 * @param fieldTypeMap - A map of fieldId to FieldType
 */
export const validateFilterOperatorModeCompatibility = (
  filter: IFilter | null | undefined,
  fieldTypeMap: Record<string, FieldType>
): IFilterValidationError[] => {
  if (!filter) return [];

  const errors: IFilterValidationError[] = [];

  const traverse = (filterItem: IFilter | IFilterItem) => {
    if (filterItem && 'fieldId' in filterItem) {
      const { fieldId, operator, value } = filterItem;
      const fieldType = fieldTypeMap[fieldId];

      // Only validate date fields with date filter value
      if (fieldType === FieldType.Date && value && typeof value === 'object' && 'mode' in value) {
        const dateValue = value as { mode: string };
        const validSubOperators = getValidFilterSubOperators(
          fieldType,
          operator as IDateTimeFieldOperator
        );

        if (validSubOperators && !validSubOperators.includes(dateValue.mode as never)) {
          const operatorName = operator === isWithIn.value ? 'isWithIn' : operator;
          errors.push({
            fieldId,
            operator: operator as string,
            mode: dateValue.mode,
            message: `The '${operatorName}' operation with mode '${dateValue.mode}' is invalid. Allowed modes: [${validSubOperators.join(',')}]`,
          });
        }
      }
    } else if (filterItem && 'filterSet' in filterItem) {
      filterItem.filterSet.forEach((item) => traverse(item));
    }
  };

  traverse(filter);
  return errors;
};

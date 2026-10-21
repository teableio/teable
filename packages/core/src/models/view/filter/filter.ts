import { z } from 'zod';
import { CellValueType, type FieldType } from '../../field/constant';
import type { IConjunction } from './conjunction';
import { and, conjunctionSchema } from './conjunction';
import { filterItemSchema, isFieldReferenceValue, type IFilterItem } from './filter-item';
import type { IDateTimeFieldOperator, IOperator } from './operator';
import {
  getFilterOperatorMapping,
  getValidFilterOperators,
  getValidFilterSubOperators,
  isEmpty,
  isNotEmpty,
  isWithIn,
} from './operator';

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

/**
 * Drop conditions that reference fields outside `readableFieldIds`.
 *
 * Use this only for persisted view defaults (view/share-view filter), so a
 * permission change does not make the saved view unusable. Explicit
 * client-supplied filters must NOT be stripped — they are rejected server-side
 * so a query cannot silently broaden. A `undefined` readable set means the
 * readable fields are unknown (e.g. fields not loaded yet) and passes the
 * filter through unchanged.
 */
export const stripFilterByReadableFieldIds = (
  filter: IFilter | null | undefined,
  readableFieldIds: ReadonlySet<string> | undefined
): IFilter | undefined => {
  if (!filter) {
    return undefined;
  }
  if (readableFieldIds == null) {
    return filter;
  }

  const isReadableCondition = (item: IFilterItem): boolean => {
    if (!readableFieldIds.has(item.fieldId)) {
      return false;
    }
    const value = item.value;
    if (isFieldReferenceValue(value)) {
      return readableFieldIds.has(value.fieldId);
    }
    if (Array.isArray(value)) {
      return value.every(
        (entry) => !isFieldReferenceValue(entry) || readableFieldIds.has(entry.fieldId)
      );
    }
    return true;
  };

  const sanitizeSet = (set: IFilterSet): IFilterSet | undefined => {
    const filterSet = set.filterSet.flatMap((item): Array<IFilterItem | IFilterSet> => {
      if ('fieldId' in item) {
        return isReadableCondition(item) ? [item] : [];
      }
      const sanitized = sanitizeSet(item);
      return sanitized ? [sanitized] : [];
    });
    return filterSet.length ? { ...set, filterSet } : undefined;
  };

  return sanitizeSet(filter);
};

/**
 * Drop conditions whose value is still missing ("in-progress" — the user has
 * picked a field and an operator but has not entered a value yet).
 *
 * The query backends ignore such conditions (v1 silently, v2 for most
 * operators), but inlined query filters (personal view / share-view proxy)
 * re-create the record subscription on every content change, so letting an
 * in-progress condition through flashes the whole grid — and on v2, where
 * `is`/`isNot` with a null value compile to IS NULL, it even filters rows.
 * Mirrors the v1 query builder: conditions on boolean cell values and the
 * value-less operators (isEmpty/isNotEmpty) keep their null value. A field
 * absent from `fieldMetaMap` (e.g. fields not loaded yet) is kept as-is, the
 * same pass-through stance as `stripFilterByReadableFieldIds` with an
 * unknown readable set; permission stripping runs separately. Only for
 * client-composed queries — never strip explicit API filters server-side.
 */
export const stripInProgressFilterItems = (
  filter: IFilter | null | undefined,
  fieldMetaMap: Record<string, Pick<IFilterValidationFieldMeta, 'cellValueType'>>
): IFilter | undefined => {
  if (!filter) {
    return undefined;
  }

  const keepCondition = (item: IFilterItem): boolean => {
    if (item.value != null) {
      return true;
    }
    const fieldMeta = fieldMetaMap[item.fieldId];
    if (!fieldMeta) {
      return true;
    }
    if (([isEmpty.value, isNotEmpty.value] as string[]).includes(item.operator)) {
      return true;
    }
    return fieldMeta.cellValueType === CellValueType.Boolean;
  };

  const sanitizeSet = (set: IFilterSet): IFilterSet | undefined => {
    const filterSet = set.filterSet.flatMap((item): Array<IFilterItem | IFilterSet> => {
      if ('fieldId' in item) {
        return keepCondition(item) ? [item] : [];
      }
      const sanitized = sanitizeSet(item);
      return sanitized ? [sanitized] : [];
    });
    return filterSet.length ? { ...set, filterSet } : undefined;
  };

  return sanitizeSet(filter);
};

export interface IFilterValidationError {
  code: 'FIELD_NOT_FOUND' | 'OPERATOR_NOT_ALLOWED' | 'MODE_NOT_ALLOWED' | 'VALUE_SHAPE_INVALID';
  path: number[];
  fieldId: string;
  operator: string;
  mode?: string;
  message: string;
}

export interface IFilterValidationFieldMeta {
  type: FieldType;
  cellValueType: CellValueType;
  isMultipleCellValue?: boolean;
}

const normalizeFilterOperator = (
  operator: string,
  isSymbol: boolean | undefined,
  fieldMeta: IFilterValidationFieldMeta
): IOperator | undefined => {
  if (!isSymbol) {
    return operator as IOperator;
  }

  const operatorMapping = getFilterOperatorMapping(fieldMeta);
  return (Object.entries(operatorMapping).find(([, symbol]) => symbol === operator)?.[0] ??
    undefined) as IOperator | undefined;
};

const analyzeFilterItemValidationIssues = (
  filterItem: IFilterItem,
  path: number[],
  fieldMetaMap: Record<string, IFilterValidationFieldMeta>
): IFilterValidationError[] => {
  const { fieldId, operator, value, isSymbol } = filterItem;
  const fieldMeta = fieldMetaMap[fieldId];
  if (!fieldMeta) {
    return [
      {
        code: 'FIELD_NOT_FOUND',
        path,
        fieldId,
        operator,
        message: `The field '${fieldId}' was not found and this filter condition will be ignored.`,
      },
    ];
  }

  const normalizedOperator = normalizeFilterOperator(operator, isSymbol, fieldMeta);
  const validFilterOperators = getValidFilterOperators(fieldMeta);
  if (!normalizedOperator || !validFilterOperators.includes(normalizedOperator)) {
    return [
      {
        code: 'OPERATOR_NOT_ALLOWED',
        path,
        fieldId,
        operator,
        message: `The '${operator}' operation provided for '${fieldId}' is invalid. Allowed operators: [${validFilterOperators.join(',')}].`,
      },
    ];
  }

  const validFilterSubOperators = getValidFilterSubOperators(
    fieldMeta.type,
    normalizedOperator as IDateTimeFieldOperator
  );
  // Operator without sub-operators (isEmpty / isNotEmpty / ...) has no mode to check.
  if (!validFilterSubOperators) return [];

  // null/undefined is treated as "in-progress" — backend drops these silently.
  if (value == null) return [];

  // Date operators support comparing against another field directly.
  if (isFieldReferenceValue(value)) return [];

  const operatorName = normalizedOperator === isWithIn.value ? 'isWithIn' : normalizedOperator;
  // Shape mismatch: operator expects { mode, ... } but value is a primitive/array.
  if (typeof value !== 'object' || Array.isArray(value) || !('mode' in (value as object))) {
    return [
      {
        code: 'VALUE_SHAPE_INVALID',
        path,
        fieldId,
        operator: normalizedOperator,
        message: `The '${operatorName}' operation requires an object value with a 'mode' field. Valid modes: [${validFilterSubOperators.join(',')}]. Example: { mode: "${validFilterSubOperators[0]}", timeZone: "UTC" }`,
      },
    ];
  }

  const mode = String((value as { mode: unknown }).mode);
  if (!validFilterSubOperators.includes(mode as never)) {
    return [
      {
        code: 'MODE_NOT_ALLOWED',
        path,
        fieldId,
        operator: normalizedOperator,
        mode,
        message: `The '${operatorName}' operation with mode '${mode}' is invalid. Allowed modes: [${validFilterSubOperators.join(',')}].`,
      },
    ];
  }

  return [];
};

export const analyzeFilterValidationIssues = (
  filter: IFilter | null | undefined,
  fieldMetaMap: Record<string, IFilterValidationFieldMeta>
): IFilterValidationError[] => {
  if (!filter) return [];

  const errors: IFilterValidationError[] = [];

  const traverse = (filterItem: IFilter | IFilterItem, path: number[]) => {
    if (filterItem && 'fieldId' in filterItem) {
      errors.push(...analyzeFilterItemValidationIssues(filterItem, path, fieldMetaMap));
      return;
    }

    if (filterItem && 'filterSet' in filterItem) {
      filterItem.filterSet.forEach((item, index) => traverse(item, [...path, index]));
    }
  };

  traverse(filter, []);
  return errors;
};

import type { DotTeaFieldInput, NormalizedDotTeaField } from '@teable/v2-core';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const readString = (value: Record<string, unknown> | undefined, key: string): string | undefined =>
  typeof value?.[key] === 'string' ? (value[key] as string) : undefined;

const normalizeSelectOptionName = (name: unknown): unknown =>
  typeof name === 'string' ? name.trim() : name;

const normalizeSelectDefaultValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : item));
  }
  return value;
};

const normalizeSelectChoices = (
  options: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!options || !Array.isArray(options.choices)) {
    return options;
  }

  const seen = new Set<string>();
  const choices = options.choices.flatMap((choice) => {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
      return [choice];
    }

    const rawChoice = choice as Record<string, unknown>;
    const normalizedName = normalizeSelectOptionName(rawChoice.name);
    if (typeof normalizedName === 'string') {
      if (seen.has(normalizedName)) {
        return [];
      }
      seen.add(normalizedName);
    }

    return [{ ...rawChoice, name: normalizedName }];
  });

  return {
    ...options,
    choices,
    ...(options.defaultValue !== undefined
      ? { defaultValue: normalizeSelectDefaultValue(options.defaultValue) }
      : {}),
  };
};

/**
 * Extract field IDs from a formula expression.
 */
export const extractFieldReferences = (expression: string): ReadonlyArray<string> => {
  const matches = expression.match(/fld[0-9a-zA-Z]{16}/g);
  return matches ? Array.from(new Set(matches)) : [];
};

/**
 * Normalize formula options from v1 to v2 format.
 */
const normalizeFormulaOptions = (
  options: Record<string, unknown> | undefined,
  fallbackExpression: string
): Record<string, unknown> | undefined => {
  const expression =
    typeof options?.expression === 'string' ? options.expression : fallbackExpression;
  if (!expression) return undefined;
  return {
    expression,
    ...(typeof options?.timeZone === 'string' ? { timeZone: options.timeZone } : {}),
    ...(options?.formatting && typeof options.formatting === 'object'
      ? { formatting: options.formatting }
      : {}),
    ...(options?.showAs && typeof options.showAs === 'object' ? { showAs: options.showAs } : {}),
  };
};

/**
 * Normalize lookup options from v1 to v2 format.
 */
const normalizeLookupOptions = (
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const foreignTableId = readString(value, 'foreignTableId');
  const linkFieldId = readString(value, 'linkFieldId');
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (!foreignTableId || !linkFieldId || !lookupFieldId) return undefined;
  return { foreignTableId, linkFieldId, lookupFieldId };
};

/**
 * Normalize link options from v1 to v2 format.
 */
const normalizeLinkOptions = (
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const relationship = readString(value, 'relationship');
  const foreignTableId = readString(value, 'foreignTableId');
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (!relationship || !foreignTableId || !lookupFieldId) return undefined;
  return {
    relationship,
    foreignTableId,
    lookupFieldId,
    ...(readString(value, 'baseId') ? { baseId: readString(value, 'baseId') } : {}),
    ...(typeof value?.isOneWay === 'boolean' ? { isOneWay: value.isOneWay } : {}),
    ...(readString(value, 'symmetricFieldId')
      ? { symmetricFieldId: readString(value, 'symmetricFieldId') }
      : {}),
    ...(typeof value?.filterByViewId === 'string' || value?.filterByViewId === null
      ? { filterByViewId: value.filterByViewId as string | null }
      : {}),
    ...(Array.isArray(value?.visibleFieldIds) ? { visibleFieldIds: value.visibleFieldIds } : {}),
  };
};

/**
 * Normalize condition from v1 to v2 format.
 */
const normalizeCondition = (value: Record<string, unknown> | undefined) => {
  const condition =
    value?.condition && typeof value.condition === 'object'
      ? (value.condition as Record<string, unknown>)
      : undefined;
  const filter = condition?.filter ?? value?.filter;
  const filterSet = (filter as { filterSet?: unknown[] } | undefined)?.filterSet;
  if (!filter || !Array.isArray(filterSet) || filterSet.length === 0) return undefined;
  return {
    filter,
    sort: (condition?.sort ?? value?.sort) as
      | { fieldId: string; order: 'asc' | 'desc' }
      | undefined,
    limit:
      typeof (condition?.limit ?? value?.limit) === 'number'
        ? condition?.limit ?? value?.limit
        : undefined,
  };
};

type NormalizedFieldOptions = {
  type?: string;
  options?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

/**
 * Normalize a field's options from v1 (dottea) format to v2 format.
 * This handles the conversion of link, lookup, formula, rollup, conditionalRollup,
 * and conditionalLookup field types.
 *
 * @param field - The raw field input from dottea
 * @param fieldTypesById - Map of field IDs to their types (used to detect computed dependencies)
 * @returns Normalized options with optional type override
 */
export const normalizeFieldOptions = (
  field: DotTeaFieldInput,
  fieldTypesById: ReadonlyMap<string, string>
): NormalizedFieldOptions => {
  const rawOptions = asRecord(field.options);
  const normalizedSelectOptions =
    field.type === 'singleSelect' || field.type === 'multipleSelect'
      ? normalizeSelectChoices(rawOptions)
      : rawOptions;
  const rawLookupOptions = asRecord(field.lookupOptions);

  if (field.type === 'link') {
    const options = normalizeLinkOptions(normalizedSelectOptions);
    return options
      ? { type: 'link', options }
      : { type: 'singleLineText', options: normalizedSelectOptions };
  }

  const lookupOptions = normalizeLookupOptions(rawLookupOptions);
  if ((field.type === 'lookup' || field.isLookup) && lookupOptions) {
    return { type: 'lookup', options: lookupOptions };
  }

  if (field.type === 'rollup') {
    const options = normalizeFormulaOptions(normalizedSelectOptions, 'countall({values})');
    return options && lookupOptions
      ? { type: 'rollup', options, config: lookupOptions }
      : { type: 'singleLineText', options: normalizedSelectOptions };
  }

  // Check conditionalLookup BEFORE formula, because v1 dottea stores conditional lookups
  // with the looked-up field's type (e.g., "formula") and isConditionalLookup: true flag.
  // The lookupOptions contains foreignTableId, lookupFieldId, and filter (condition).
  if (field.type === 'conditionalLookup' || field.isConditionalLookup) {
    // Config can be in rawOptions or rawLookupOptions depending on v1 export format
    const foreignTableId =
      readString(rawLookupOptions, 'foreignTableId') ??
      readString(normalizedSelectOptions, 'foreignTableId');
    const lookupFieldId =
      readString(rawLookupOptions, 'lookupFieldId') ??
      readString(normalizedSelectOptions, 'lookupFieldId');
    const condition =
      normalizeCondition(rawLookupOptions) ?? normalizeCondition(normalizedSelectOptions);
    if (foreignTableId && lookupFieldId && condition) {
      return { type: 'conditionalLookup', options: { foreignTableId, lookupFieldId, condition } };
    }
    return { type: 'singleLineText', options: normalizedSelectOptions };
  }

  if (field.type === 'conditionalRollup') {
    const options = normalizeFormulaOptions(normalizedSelectOptions, 'countall({values})');
    const foreignTableId = readString(normalizedSelectOptions, 'foreignTableId');
    const lookupFieldId = readString(normalizedSelectOptions, 'lookupFieldId');
    const condition = normalizeCondition(normalizedSelectOptions);
    if (options && foreignTableId && lookupFieldId && condition) {
      return {
        type: 'conditionalRollup',
        options,
        config: { foreignTableId, lookupFieldId, condition },
      };
    }
    return { type: 'singleLineText', options: normalizedSelectOptions };
  }

  if (field.type === 'formula') {
    const expression =
      typeof normalizedSelectOptions?.expression === 'string'
        ? normalizedSelectOptions.expression
        : '';
    const refs = expression ? extractFieldReferences(expression) : [];
    const hasMissingDependency = refs.some((ref) => !fieldTypesById.has(ref));
    const hasComputedDependency = refs.some((ref) => {
      const type = fieldTypesById.get(ref);
      return type === 'rollup' || type === 'conditionalRollup';
    });
    if (hasMissingDependency || hasComputedDependency) {
      return { type: 'singleLineText', options: normalizedSelectOptions };
    }
    const options = normalizeFormulaOptions(normalizedSelectOptions, '0');
    return options
      ? { type: 'formula', options }
      : { type: 'singleLineText', options: normalizedSelectOptions };
  }

  return { options: normalizedSelectOptions };
};

/**
 * Build a NormalizedDotTeaField from raw DotTeaFieldInput.
 */
export const normalizeField = (
  field: DotTeaFieldInput,
  fieldTypesById: ReadonlyMap<string, string>
): NormalizedDotTeaField => {
  const normalized = normalizeFieldOptions(field, fieldTypesById);
  const resolvedType = normalized.type ?? field.type;

  const baseField: NormalizedDotTeaField = {
    ...(field.id ? { id: field.id } : {}),
    type: resolvedType,
    name: field.name ?? resolvedType,
    isPrimary: field.isPrimary,
    notNull: field.notNull,
    unique: field.unique,
    ...(normalized.options ? { options: normalized.options } : {}),
    ...(normalized.config ? { config: normalized.config } : {}),
  };

  // Add result type for rollup/conditionalRollup fields
  if (
    (resolvedType === 'rollup' || resolvedType === 'conditionalRollup') &&
    typeof field.cellValueType === 'string'
  ) {
    return {
      ...baseField,
      cellValueType: field.cellValueType,
      isMultipleCellValue:
        typeof field.isMultipleCellValue === 'boolean' ? field.isMultipleCellValue : false,
    };
  }

  return baseField;
};

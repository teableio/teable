type DotTeaExportFieldOptions = Record<string, unknown>;

export type DotTeaExportField = {
  id: string;
  type: string;
  options?: unknown;
  lookupOptions?: unknown;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
  isMultipleCellValue?: boolean;
  dbFieldType?: string;
  cellValueType?: string;
  [key: string]: unknown;
};

export type DotTeaExportFieldNormalizationOptions = {
  allowCrossBase?: boolean;
};

const textFieldType = 'singleLineText';
const textDbFieldType = 'TEXT';
const textCellValueType = 'string';

const isObject = (value: unknown): value is DotTeaExportFieldOptions =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasBaseId = (value: unknown): boolean => isObject(value) && Boolean(value.baseId);

const linkFieldId = (value: unknown): string | undefined => {
  if (!isObject(value) || typeof value.linkFieldId !== 'string') {
    return undefined;
  }
  return value.linkFieldId;
};

const isDirectCrossBaseLinkField = (field: DotTeaExportField) =>
  field.type === 'link' && !field.isLookup && hasBaseId(field.options);

const isRelativeCrossBaseField = (
  field: DotTeaExportField,
  crossBaseLinkFieldIds: ReadonlySet<string>
) => {
  if (!(field.isLookup || field.type === 'rollup' || field.type === 'conditionalRollup')) {
    return false;
  }

  // Lookup fields can expose a cross-base link field through a local link field.
  if (field.type === 'link' && hasBaseId(field.options)) {
    return true;
  }

  const dependencyLinkFieldId = linkFieldId(field.lookupOptions);
  return Boolean(dependencyLinkFieldId && crossBaseLinkFieldIds.has(dependencyLinkFieldId));
};

const isDirectCrossBaseConditionalField = (field: DotTeaExportField) => {
  if (field.isLookup && field.isConditionalLookup) {
    return hasBaseId(field.lookupOptions);
  }

  if (field.type === 'conditionalRollup') {
    return hasBaseId(field.options);
  }

  return false;
};

const omitComputedRelationConfig = (field: DotTeaExportField): DotTeaExportField => {
  const normalized = { ...field };
  delete normalized.options;
  delete normalized.lookupOptions;
  delete normalized.isLookup;
  delete normalized.isConditionalLookup;
  delete normalized.isMultipleCellValue;
  return normalized;
};

const asTextField = (field: DotTeaExportField, options?: { forceTextStorage?: boolean }) => ({
  ...omitComputedRelationConfig(field),
  type: textFieldType,
  ...(options?.forceTextStorage
    ? {
        dbFieldType: textDbFieldType,
        cellValueType: textCellValueType,
      }
    : {}),
});

export const normalizeDotTeaExportFieldsForSelfContainedBase = (
  fields: ReadonlyArray<DotTeaExportField>,
  options?: DotTeaExportFieldNormalizationOptions
): DotTeaExportField[] => {
  if (options?.allowCrossBase) {
    return fields.map((field) => ({ ...field }));
  }

  const crossBaseLinkFieldIds = new Set(
    fields.filter(isDirectCrossBaseLinkField).map((field) => field.id)
  );
  const normalizedIds = new Set<string>();

  return fields.map((field) => {
    if (isDirectCrossBaseLinkField(field)) {
      normalizedIds.add(field.id);
      return asTextField(field);
    }

    if (isRelativeCrossBaseField(field, crossBaseLinkFieldIds)) {
      normalizedIds.add(field.id);
      return asTextField(field, { forceTextStorage: true });
    }

    if (!normalizedIds.has(field.id) && isDirectCrossBaseConditionalField(field)) {
      return asTextField(field, { forceTextStorage: true });
    }

    return { ...field };
  });
};

import { FieldType } from '@teable/core';
import type { IFieldRo } from '@teable/core';
import type { ICreateTableWithDefault } from '@teable/openapi';
import type { ICreateTableCommandInput, ITableFieldInput } from '@teable/v2-core';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const withDefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
};

const normalizeLegacyTimeZone = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyTimeZone(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'timeZone' && raw === 'UTC') {
      normalized[key] = 'utc';
      continue;
    }
    normalized[key] = normalizeLegacyTimeZone(raw);
  }

  return normalized;
};

const getResultTypePair = (field: Record<string, unknown>): Record<string, unknown> => {
  const cellValueType = field.cellValueType;
  const isMultipleCellValue = field.isMultipleCellValue;

  if (typeof cellValueType === 'string' && typeof isMultipleCellValue === 'boolean') {
    return isMultipleCellValue ? { cellValueType, isMultipleCellValue } : { cellValueType };
  }

  return {};
};

const pickLookupOptions = (lookupOptions: Record<string, unknown> | undefined) =>
  withDefined({
    linkFieldId: lookupOptions?.linkFieldId as string | undefined,
    foreignTableId: lookupOptions?.foreignTableId as string | undefined,
    lookupFieldId: lookupOptions?.lookupFieldId as string | undefined,
    filter: lookupOptions?.filter,
    sort: lookupOptions?.sort,
    limit: lookupOptions?.limit,
  });

const pickCondition = (lookupOptions: Record<string, unknown> | undefined) =>
  withDefined({
    filter: lookupOptions?.filter,
    sort: lookupOptions?.sort,
    limit: lookupOptions?.limit,
  });

const pickFormulaOptions = (options: Record<string, unknown> | undefined) =>
  withDefined({
    expression: options?.expression as string | undefined,
    timeZone: options?.timeZone as string | undefined,
    formatting: options?.formatting,
    showAs: options?.showAs,
  });

const pickRollupConfig = (
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
) =>
  withDefined({
    linkFieldId: (options?.linkFieldId ?? lookupOptions?.linkFieldId) as string | undefined,
    foreignTableId: (options?.foreignTableId ?? lookupOptions?.foreignTableId) as
      | string
      | undefined,
    lookupFieldId: (options?.lookupFieldId ?? lookupOptions?.lookupFieldId) as string | undefined,
  });

const pickLinkOptions = (options: Record<string, unknown> | undefined) =>
  withDefined({
    baseId: options?.baseId as string | undefined,
    relationship: options?.relationship,
    foreignTableId: options?.foreignTableId as string | undefined,
    lookupFieldId: options?.lookupFieldId as string | undefined,
    isOneWay: options?.isOneWay as boolean | undefined,
    fkHostTableName: options?.fkHostTableName as string | undefined,
    selfKeyName: options?.selfKeyName as string | undefined,
    foreignKeyName: options?.foreignKeyName as string | undefined,
    symmetricFieldId: options?.symmetricFieldId as string | undefined,
    filterByViewId: (options?.filterByViewId ?? undefined) as string | null | undefined,
    visibleFieldIds: (options?.visibleFieldIds ?? undefined) as string[] | null | undefined,
    filter: options?.filter,
  });

const mapBaseField = (field: IFieldRo) =>
  withDefined({
    id: field.id,
    name: field.name,
    dbFieldName: field.dbFieldName,
    description: field.description ?? undefined,
    aiConfig: field.aiConfig ?? undefined,
    isPrimary: (field as Record<string, unknown>).isPrimary === true ? true : undefined,
    notNull: field.notNull,
    unique: field.unique,
  });

const mapLegacyFieldToV2Field = (field: IFieldRo): ITableFieldInput => {
  const baseField = mapBaseField(field);
  const rawField = field as Record<string, unknown>;
  const options = asRecord(field.options);
  const lookupOptions = asRecord(field.lookupOptions);

  if (field.isLookup) {
    if (field.isConditionalLookup) {
      return mapLegacyConditionalLookupField(
        baseField,
        rawField,
        field.type,
        options,
        lookupOptions
      );
    }

    return mapLegacyLookupField(baseField, rawField, lookupOptions, options);
  }

  if (field.type === FieldType.Rollup) {
    return mapLegacyRollupField(baseField, rawField, options, lookupOptions);
  }

  if (field.type === FieldType.Link) {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'link',
      options: pickLinkOptions(options),
    }) as ITableFieldInput;
  }

  if (field.type === FieldType.ConditionalRollup || rawField.type === 'conditionalRollup') {
    return mapLegacyConditionalRollupField(baseField, rawField, options);
  }

  return normalizeLegacyTimeZone(
    withDefined({
      ...baseField,
      type: field.type as ITableFieldInput['type'],
      ...(options ? { options } : {}),
    })
  ) as ITableFieldInput;
};

const mapLegacyConditionalLookupField = (
  baseField: ReturnType<typeof mapBaseField>,
  rawField: Record<string, unknown>,
  fieldType: IFieldRo['type'],
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
): ITableFieldInput => {
  const foreignTableId = lookupOptions?.foreignTableId as string | undefined;
  const lookupFieldId = lookupOptions?.lookupFieldId as string | undefined;
  const condition = pickCondition(lookupOptions);

  if (fieldType === FieldType.Rollup) {
    return normalizeLegacyTimeZone({
      ...baseField,
      type: 'conditionalRollup',
      ...getResultTypePair(rawField),
      options: pickFormulaOptions(options),
      config: {
        foreignTableId: foreignTableId ?? '',
        lookupFieldId: lookupFieldId ?? '',
        condition,
      },
    }) as ITableFieldInput;
  }

  return normalizeLegacyTimeZone({
    ...baseField,
    type: 'conditionalLookup',
    options: {
      foreignTableId: foreignTableId ?? '',
      lookupFieldId: lookupFieldId ?? '',
      condition,
    },
    ...(typeof rawField.isMultipleCellValue === 'boolean'
      ? { isMultipleCellValue: rawField.isMultipleCellValue }
      : {}),
    innerOptions: options,
  }) as ITableFieldInput;
};

const mapLegacyLookupField = (
  baseField: ReturnType<typeof mapBaseField>,
  rawField: Record<string, unknown>,
  lookupOptions: Record<string, unknown> | undefined,
  options: Record<string, unknown> | undefined
): ITableFieldInput =>
  normalizeLegacyTimeZone({
    ...baseField,
    type: 'lookup',
    legacyMultiplicityDerivation: true,
    ...(rawField.isMultipleCellValue === true ? { isMultipleCellValue: true } : {}),
    options: pickLookupOptions(lookupOptions),
    innerOptions: options,
  }) as ITableFieldInput;

const mapLegacyRollupField = (
  baseField: ReturnType<typeof mapBaseField>,
  rawField: Record<string, unknown>,
  options: Record<string, unknown> | undefined,
  lookupOptions: Record<string, unknown> | undefined
): ITableFieldInput =>
  normalizeLegacyTimeZone({
    ...baseField,
    type: 'rollup',
    ...getResultTypePair(rawField),
    options: pickFormulaOptions(options),
    config: pickRollupConfig(options, lookupOptions),
  }) as ITableFieldInput;

const mapLegacyConditionalRollupField = (
  baseField: ReturnType<typeof mapBaseField>,
  rawField: Record<string, unknown>,
  options: Record<string, unknown> | undefined
): ITableFieldInput =>
  normalizeLegacyTimeZone({
    ...baseField,
    type: 'conditionalRollup',
    ...getResultTypePair(rawField),
    options: pickFormulaOptions(options),
    config: {
      foreignTableId: options?.foreignTableId as string,
      lookupFieldId: options?.lookupFieldId as string,
      condition: pickCondition(options),
    },
  }) as ITableFieldInput;

export const mapLegacyCreateTableToV2Input = (
  baseId: string,
  table: ICreateTableWithDefault
): ICreateTableCommandInput => {
  return {
    baseId,
    name: table.name ?? 'New table',
    ...(table.dbTableName ? { dbTableName: table.dbTableName } : {}),
    fields: table.fields.map(mapLegacyFieldToV2Field),
    views: table.views.map((view) =>
      withDefined({
        type: view.type,
        name: view.name,
      })
    ),
    records: table.records?.map((record) =>
      withDefined({
        id: 'id' in record && typeof record.id === 'string' ? record.id : undefined,
        fields: record.fields,
      })
    ),
  };
};

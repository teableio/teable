import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { tableFieldInputSchema, type ITableFieldInput } from '../schemas/field';

const LOOKUP_INPUT_OPTION_KEYS = [
  'linkFieldId',
  'foreignTableId',
  'lookupFieldId',
  'filter',
  'sort',
  'limit',
] as const;

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) {
      continue;
    }
    result[key] = stripUndefinedDeep(nested);
  }
  return result;
};

const defined = (entries: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

const normalizeLookupOptions = (options: unknown): Record<string, unknown> | undefined => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined;
  }

  const raw = options as Record<string, unknown>;
  return defined(Object.fromEntries(LOOKUP_INPUT_OPTION_KEYS.map((key) => [key, raw[key]])));
};

export const toRestoreFieldCreateInput = (
  rawField: unknown
): Result<ITableFieldInput, DomainError> => {
  if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
    return err(
      domainError.validation({
        message: 'Invalid restore field snapshot',
        code: 'restore_field_stream.invalid_field_snapshot',
      })
    );
  }

  const field = rawField as Record<string, unknown>;
  const common = defined({
    id: field.id,
    name: field.name,
    dbFieldName: field.dbFieldName,
    description: field.description,
    aiConfig: field.aiConfig,
    isPrimary: field.isPrimary,
    notNull: field.notNull,
    unique: field.unique,
  });

  const normalized: Record<string, unknown> = (() => {
    if (field.type === 'rollup') {
      return defined({
        ...common,
        type: 'rollup',
        options: field.options,
        config: field.config,
        cellValueType: field.cellValueType,
        isMultipleCellValue: field.isMultipleCellValue,
      });
    }

    if (field.type === 'conditionalRollup') {
      return defined({
        ...common,
        type: 'conditionalRollup',
        options: field.options,
        config: field.config,
        cellValueType: field.cellValueType,
        isMultipleCellValue: field.isMultipleCellValue,
      });
    }

    if (field.type === 'conditionalLookup') {
      return defined({
        ...common,
        type: 'conditionalLookup',
        options: field.options,
        innerOptions: field.innerOptions,
        isMultipleCellValue: field.isMultipleCellValue,
      });
    }

    if (field.isLookup === true && field.lookupOptions) {
      return defined({
        ...common,
        type: 'lookup',
        options: normalizeLookupOptions(field.lookupOptions),
        innerOptions: field.options,
        isMultipleCellValue: field.isMultipleCellValue,
      });
    }

    return defined({
      ...common,
      type: field.type,
      options: field.options,
    });
  })();

  const parsed = tableFieldInputSchema.safeParse(stripUndefinedDeep(normalized));
  if (!parsed.success) {
    return err(
      domainError.validation({
        message: 'Invalid restore field create input',
        code: 'restore_field_stream.invalid_field_create_input',
        details: z.formatError(parsed.error),
      })
    );
  }

  return ok(parsed.data);
};

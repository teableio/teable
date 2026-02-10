import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  LinkRelationship,
  ParsedConditionalOptions,
  ParsedLinkOptions,
  ParsedLookupOptions,
} from './types';

/**
 * Parse a JSON string into an object.
 */
export const parseJson = (raw: string, label: string): Result<unknown, DomainError> => {
  try {
    return ok(JSON.parse(raw));
  } catch {
    return err(domainError.validation({ message: `Invalid JSON for ${label}` }));
  }
};

/**
 * Read a required string value from an object.
 */
export const readString = (
  value: Record<string, unknown>,
  key: string
): Result<string, DomainError> => {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return err(domainError.validation({ message: `Missing string "${key}" in config` }));
  }
  return ok(candidate);
};

/**
 * Read an optional string value from an object.
 */
export const readOptionalString = (
  value: Record<string, unknown>,
  key: string
): Result<string | undefined, DomainError> => {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return ok(undefined);
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return err(domainError.validation({ message: `Invalid string "${key}" in config` }));
  }
  return ok(candidate);
};

/**
 * Extract field IDs from a condition filter object.
 * Handles nested filter structures with conjunction (and/or) and filterSet.
 *
 * Filter structure:
 * {
 *   conjunction: 'and' | 'or',
 *   filterSet: Array<{ fieldId: string, operator: string, value: unknown } | NestedFilter>
 * }
 */
export const extractConditionFieldIds = (filter: unknown): string[] => {
  const fieldIds: string[] = [];

  const extractFieldRefs = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(extractFieldRefs);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      record.type === 'field' &&
      typeof record.fieldId === 'string' &&
      record.fieldId.length > 0
    ) {
      fieldIds.push(record.fieldId);
    }
  };

  const extractFromFilterSet = (filterSet: unknown): void => {
    if (!Array.isArray(filterSet)) return;

    for (const item of filterSet) {
      if (typeof item !== 'object' || item === null) continue;

      const record = item as Record<string, unknown>;

      // If it has a fieldId, it's a filter condition
      if (typeof record.fieldId === 'string' && record.fieldId.length > 0) {
        fieldIds.push(record.fieldId);
      }

      if ('value' in record) {
        extractFieldRefs(record.value);
      }

      // If it has a filterSet, it's a nested filter group (recursive)
      if (Array.isArray(record.filterSet)) {
        extractFromFilterSet(record.filterSet);
      }
    }
  };

  if (typeof filter !== 'object' || filter === null) return fieldIds;

  const filterRecord = filter as Record<string, unknown>;
  if (Array.isArray(filterRecord.filterSet)) {
    extractFromFilterSet(filterRecord.filterSet);
  }

  return fieldIds;
};

/**
 * Parse link field options.
 */
export const parseLinkOptions = (
  raw: string | null
): Result<ParsedLinkOptions | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.options');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;
  const foreignTableId = readString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);
  const symmetricFieldId = readOptionalString(value, 'symmetricFieldId');
  if (symmetricFieldId.isErr()) return err(symmetricFieldId.error);
  const fkHostTableName = readOptionalString(value, 'fkHostTableName');
  if (fkHostTableName.isErr()) return err(fkHostTableName.error);
  const relationship = readOptionalString(value, 'relationship');
  if (relationship.isErr()) return err(relationship.error);

  return ok({
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
    ...(symmetricFieldId.value ? { symmetricFieldId: symmetricFieldId.value } : {}),
    ...(fkHostTableName.value ? { fkHostTableName: fkHostTableName.value } : {}),
    ...(relationship.value ? { relationship: relationship.value as LinkRelationship } : {}),
  });
};

/**
 * Parse lookup/rollup field options.
 */
export const parseLookupOptions = (
  raw: string | null
): Result<ParsedLookupOptions | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.lookup_options');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;
  const linkFieldId = readString(value, 'linkFieldId');
  if (linkFieldId.isErr()) return err(linkFieldId.error);
  const foreignTableId = readString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);

  // Extract filter field IDs if filter exists in lookup options
  const filter = value.filter;
  const filterFieldIds = extractConditionFieldIds(filter);

  return ok({
    linkFieldId: linkFieldId.value,
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
    ...(filterFieldIds.length > 0 ? { filterFieldIds, filterDto: filter } : {}),
  });
};

/**
 * Parse conditional field options (for conditionalRollup/conditionalLookup).
 *
 * Supports two formats:
 * - v1 format: foreignTableId, lookupFieldId, filter directly in options
 * - v2 format: foreignTableId, lookupFieldId, condition.filter in config/options
 */
export const parseConditionalFieldOptions = (
  raw: string | null
): Result<ParsedConditionalOptions | null, DomainError> => {
  if (!raw) return ok(null);
  const parsed = parseJson(raw, 'field.options (conditional)');
  if (parsed.isErr()) return err(parsed.error);
  const value = parsed.value as Record<string, unknown>;

  // Read foreignTableId and lookupFieldId
  const foreignTableId = readOptionalString(value, 'foreignTableId');
  if (foreignTableId.isErr()) return err(foreignTableId.error);
  const lookupFieldId = readOptionalString(value, 'lookupFieldId');
  if (lookupFieldId.isErr()) return err(lookupFieldId.error);

  // If both are missing, return null (field might be incomplete)
  if (!foreignTableId.value || !lookupFieldId.value) {
    return ok(null);
  }

  // Extract filter from either v1 format (value.filter) or v2 format (value.condition.filter)
  let filter: unknown = value.filter;
  if (!filter && typeof value.condition === 'object' && value.condition !== null) {
    const condition = value.condition as Record<string, unknown>;
    filter = condition.filter;
  }

  // Extract field IDs from the condition filter
  const conditionFieldIds = extractConditionFieldIds(filter);

  return ok({
    foreignTableId: foreignTableId.value,
    lookupFieldId: lookupFieldId.value,
    conditionFieldIds,
    // Save original filter for precise dirty propagation
    filterDto: filter,
  });
};

/**
 * Describe an error for logging purposes.
 */
export const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};

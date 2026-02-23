/**
 * Helper utilities for update-field e2e tests.
 *
 * NOTE: The updateField HTTP endpoint is not yet implemented in v2-contract-http.
 * These helpers will need to be connected once the endpoint is added.
 */

import type { SharedTestContext } from '../shared/globalTestContext';

/**
 * Update a field in a table.
 *
 * TODO: Implement once updateField endpoint is added to v2-contract-http
 */
export const updateField = async (
  ctx: SharedTestContext,
  payload: {
    tableId: string;
    fieldId: string;
    field: Record<string, unknown>;
  }
): Promise<ReturnType<typeof ctx.getTableById>> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseId: ctx.baseId,
      ...payload,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update field: ${errorText}`);
  }
  const rawBody = await response.json();
  // TODO: Add proper response parsing once contract is defined
  return rawBody.data?.table ?? rawBody;
};

/**
 * Get field by ID from table.
 */
export const getFieldById = (
  table: { fields: Array<{ id: string; [key: string]: unknown }> },
  fieldId: string
) => {
  return table.fields.find((f) => f.id === fieldId);
};

/**
 * Assert field has expected options.
 */
export const expectFieldOptions = (
  field: { options?: Record<string, unknown> } | undefined,
  expected: Record<string, unknown>
) => {
  if (!field) throw new Error('Field not found');
  const options = field.options ?? {};
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(options[key]) !== JSON.stringify(value)) {
      throw new Error(
        `Field option ${key} mismatch: expected ${JSON.stringify(value)}, got ${JSON.stringify(options[key])}`
      );
    }
  }
};

/**
 * Assert field type matches expected.
 */
export const expectFieldType = (field: { type?: string } | undefined, expectedType: string) => {
  if (!field) throw new Error('Field not found');
  if (field.type !== expectedType) {
    throw new Error(`Field type mismatch: expected ${expectedType}, got ${field.type}`);
  }
};

/**
 * Assert field has error state.
 */
export const expectFieldHasError = (
  field: { hasError?: boolean | null } | undefined,
  expected: boolean
) => {
  if (!field) throw new Error('Field not found');
  const hasError = field.hasError === true;
  if (hasError !== expected) {
    throw new Error(`Field hasError mismatch: expected ${expected}, got ${hasError}`);
  }
};

/**
 * Get record values for a specific field.
 */
export const getRecordFieldValues = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldId: string
): Array<unknown> => {
  return records.map((r) => r.fields[fieldId]);
};

/**
 * Assert record values match expected array.
 * Values are compared using JSON.stringify for deep equality.
 */
export const expectRecordValues = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldId: string,
  expected: Array<unknown>
) => {
  const actual = getRecordFieldValues(records, fieldId);
  if (actual.length !== expected.length) {
    throw new Error(`Record count mismatch: expected ${expected.length}, got ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) {
      throw new Error(
        `Record ${i} value mismatch: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`
      );
    }
  }
};

/**
 * Find select option by name from field options.
 */
export const findOptionByName = (
  field:
    | { options?: { choices?: Array<{ id: string; name: string; color?: string }> } }
    | undefined,
  name: string
) => {
  if (!field?.options?.choices) return undefined;
  return field.options.choices.find((c) => c.name === name);
};

/**
 * Assert select option exists with expected properties.
 */
export const expectSelectOption = (
  field:
    | { options?: { choices?: Array<{ id: string; name: string; color?: string }> } }
    | undefined,
  optionName: string,
  expected?: { id?: string; color?: string }
) => {
  const option = findOptionByName(field, optionName);
  if (!option) {
    throw new Error(`Option '${optionName}' not found in field choices`);
  }
  if (expected?.id && option.id !== expected.id) {
    throw new Error(
      `Option '${optionName}' id mismatch: expected ${expected.id}, got ${option.id}`
    );
  }
  if (expected?.color && option.color !== expected.color) {
    throw new Error(
      `Option '${optionName}' color mismatch: expected ${expected.color}, got ${option.color}`
    );
  }
  return option;
};

/**
 * Assert select option does not exist.
 */
export const expectSelectOptionNotExists = (
  field: { options?: { choices?: Array<{ id: string; name: string }> } } | undefined,
  optionName: string
) => {
  const option = findOptionByName(field, optionName);
  if (option) {
    throw new Error(`Option '${optionName}' should not exist but found: ${JSON.stringify(option)}`);
  }
};

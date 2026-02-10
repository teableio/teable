/**
 * Generators for test data - field values, formula expressions, etc.
 */

import { FieldId } from '@teable/v2-core';

import type { SourceFieldType, ValueTransition, LinkRelationship } from './types';

// =============================================================================
// Field Value Generator
// =============================================================================

interface FieldValuePair {
  initial: unknown;
  updated: unknown;
}

const VALUE_MAP: Record<SourceFieldType, Partial<Record<ValueTransition, FieldValuePair>>> = {
  number: {
    nullToValue: { initial: null, updated: 10 },
    valueToValue: { initial: 10, updated: 20 },
    valueToNull: { initial: 10, updated: null },
  },
  singleLineText: {
    nullToValue: { initial: null, updated: 'hello' },
    valueToValue: { initial: 'hello', updated: 'world' },
    valueToNull: { initial: 'hello', updated: null },
  },
  longText: {
    nullToValue: { initial: null, updated: 'long text content' },
    valueToValue: { initial: 'old text', updated: 'new text' },
    valueToNull: { initial: 'some text', updated: null },
  },
  checkbox: {
    nullToValue: { initial: null, updated: true },
    valueToValue: { initial: true, updated: false },
    valueToNull: { initial: true, updated: null },
  },
  rating: {
    nullToValue: { initial: null, updated: 3 },
    valueToValue: { initial: 3, updated: 5 },
    valueToNull: { initial: 3, updated: null },
  },
  date: {
    nullToValue: { initial: null, updated: '2024-01-15' },
    valueToValue: { initial: '2024-01-15', updated: '2024-06-20' },
    valueToNull: { initial: '2024-01-15', updated: null },
  },
  singleSelect: {
    nullToValue: { initial: null, updated: 'option1' },
    valueToValue: { initial: 'option1', updated: 'option2' },
    valueToNull: { initial: 'option1', updated: null },
  },
  formula: {
    // Formula is computed, so we can't set values directly
    // These are used when formula is a source for another computed field
    nullToValue: { initial: null, updated: 10 },
    valueToValue: { initial: 10, updated: 20 },
    valueToNull: { initial: 10, updated: null },
  },
  lookup: {
    // Lookup values are arrays
    nullToValue: { initial: null, updated: [10] },
    valueToValue: { initial: [10], updated: [20] },
    valueToNull: { initial: [10], updated: null },
    emptyToValues: { initial: [], updated: [10, 20] },
    valuesToEmpty: { initial: [10, 20], updated: [] },
    addItem: { initial: [10], updated: [10, 20] },
    removeItem: { initial: [10, 20], updated: [10] },
  },
  rollup: {
    // Rollup produces single values (aggregated)
    nullToValue: { initial: null, updated: 30 },
    valueToValue: { initial: 30, updated: 50 },
    valueToNull: { initial: 30, updated: null },
  },
};

export const getFieldValues = (
  fieldType: SourceFieldType,
  transition: ValueTransition
): FieldValuePair => {
  const values = VALUE_MAP[fieldType]?.[transition];
  if (!values) {
    // Default fallback
    return {
      initial: transition === 'nullToValue' ? null : 'initial',
      updated: transition === 'valueToNull' ? null : 'updated',
    };
  }
  return values;
};

// =============================================================================
// Formula Expression Generator
// =============================================================================

export const getFormulaExpression = (
  sourceFieldId: string,
  sourceType: SourceFieldType,
  chainLevel: number = 1
): string => {
  // For chain level > 1, use simpler expressions that work with computed field outputs
  if (chainLevel > 1) {
    return `{${sourceFieldId}} + 10`;
  }

  const expressions: Partial<Record<SourceFieldType, string>> = {
    number: `{${sourceFieldId}} * 2`,
    singleLineText: `CONCATENATE("Result: ", {${sourceFieldId}})`,
    longText: `LEFT({${sourceFieldId}}, 20)`,
    checkbox: `IF({${sourceFieldId}}, "Yes", "No")`,
    rating: `{${sourceFieldId}} * 10`,
    date: `DATESTR({${sourceFieldId}})`,
    singleSelect: `{${sourceFieldId}}`,
    formula: `{${sourceFieldId}} + 10`,
    lookup: `SUM({${sourceFieldId}})`,
    rollup: `{${sourceFieldId}} * 1.5`,
  };

  return expressions[sourceType] ?? `{${sourceFieldId}}`;
};

// =============================================================================
// Rollup Expression Generator
// =============================================================================

export const getRollupExpression = (sourceType: SourceFieldType): string => {
  const expressions: Partial<Record<SourceFieldType, string>> = {
    number: 'sum({values})',
    rating: 'sum({values})',
    singleLineText: 'ARRAYJOIN({values}, ", ")',
    longText: 'ARRAYJOIN({values}, ", ")',
    checkbox: 'COUNTALL({values})',
    date: 'ARRAYJOIN({values}, ", ")',
    singleSelect: 'ARRAYJOIN({values}, ", ")',
  };
  return expressions[sourceType] ?? 'COUNTALL({values})';
};

// =============================================================================
// Single Select Options Generator
// =============================================================================

export const getSingleSelectOptions = () => ({
  choices: [
    { id: 'opt1', name: 'option1', color: 'blue' },
    { id: 'opt2', name: 'option2', color: 'green' },
    { id: 'opt3', name: 'option3', color: 'red' },
  ],
});

// =============================================================================
// Link Value Generator
// =============================================================================

export const getLinkValue = (recordIds: string[], relationship: LinkRelationship): unknown => {
  if (recordIds.length === 0) return null;

  // For oneOne and manyOne, return single object
  if (relationship === 'oneOne' || relationship === 'manyOne') {
    return { id: recordIds[0] };
  }

  // For oneMany and manyMany, return array
  return recordIds.map((id) => ({ id }));
};

// =============================================================================
// Expected Value Calculator
// =============================================================================

export const calculateExpectedFormulaValue = (
  sourceType: SourceFieldType,
  sourceValue: unknown,
  chainDepth: number
): unknown => {
  if (sourceValue === null || sourceValue === undefined) {
    return null;
  }

  // First level formula calculation
  let result: unknown;
  switch (sourceType) {
    case 'number':
      result = (sourceValue as number) * 2;
      break;
    case 'rating':
      result = (sourceValue as number) * 10;
      break;
    case 'singleLineText':
      result = `Result: ${sourceValue}`;
      break;
    case 'checkbox':
      result = sourceValue ? 'Yes' : 'No';
      break;
    default:
      result = sourceValue;
  }

  // Additional chain levels: each adds 10
  for (let i = 1; i < chainDepth; i++) {
    if (typeof result === 'number') {
      result = result + 10;
    }
  }

  return result;
};

// =============================================================================
// Field ID Generator Factory
// =============================================================================

export const createFieldIdGenerator = () => {
  return () => FieldId.mustGenerate().toString();
};

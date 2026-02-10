/**
 * Validators for test assertions
 */

import { expect } from 'vitest';
import type {
  ExpectedResult,
  ExpectedSteps,
  LinkDirection,
  SourceFieldType,
  ValueTransition,
} from './types';

// =============================================================================
// Simple Scenario Steps Map
// =============================================================================

const SIMPLE_SCENARIO_STEPS: Record<string, number> = {
  // Same-table formulas use CTE batching
  formula_d1: 1,
  formula_d2: 1,
  formula_d3: 1,
  // Single-level lookup/rollup
  lookup_oneWay: 1,
  rollup_oneWay: 1,
};

// =============================================================================
// Expected Result Generator
// =============================================================================

export const getExpectedResult = (
  sourceType: SourceFieldType,
  computedType: string,
  transition: ValueTransition,
  _initialValue: unknown,
  updatedValue: unknown,
  depth: number = 1
): ExpectedResult => {
  // valueToNull scenario
  if (transition === 'valueToNull') {
    // For formula with non-numeric types, the formula doesn't return null
    if (computedType === 'formula' && sourceType === 'singleLineText') {
      if (depth === 1) {
        // CONCATENATE("Result: ", null) returns "Result: "
        return { shouldChange: true, shouldBeNull: false, exactValue: 'Result: ' };
      } else {
        // depth > 1: "Result: " + 10 + 10 + ... (string concatenation)
        const suffix = '10'.repeat(depth - 1);
        return { shouldChange: true, shouldBeNull: false, exactValue: `Result: ${suffix}` };
      }
    }
    if (computedType === 'formula' && sourceType === 'checkbox') {
      if (depth === 1) {
        // IF(null, "Yes", "No") returns "No"
        return { shouldChange: true, shouldBeNull: false, exactValue: 'No' };
      } else {
        // depth > 1: "No" + 10 + 10 + ... (string concatenation)
        const suffix = '10'.repeat(depth - 1);
        return { shouldChange: true, shouldBeNull: false, exactValue: `No${suffix}` };
      }
    }
    // For numeric types and other cases, v1 behavior treats null numeric operands as zero
    if (computedType === 'formula' && (sourceType === 'number' || sourceType === 'rating')) {
      const baseValue = depth === 1 ? 0 : 10 * (depth - 1);
      return { shouldChange: true, shouldBeNull: false, exactValue: baseValue };
    }
    // Default: formula returns null when source is null
    return { shouldChange: true, shouldBeNull: true };
  }

  // nullToValue scenario
  if (transition === 'nullToValue') {
    return { shouldChange: true, shouldBeNull: false };
  }

  // valueToValue scenario - calculate exact value for predictable cases
  // For formula chains with depth > 1, subsequent formulas add 10 each
  const additionalForDepth = (depth - 1) * 10;

  if (computedType === 'formula' && sourceType === 'number') {
    return {
      shouldChange: true,
      shouldBeNull: false,
      exactValue: (updatedValue as number) * 2 + additionalForDepth,
    };
  }

  if (computedType === 'formula' && sourceType === 'rating') {
    return {
      shouldChange: true,
      shouldBeNull: false,
      exactValue: (updatedValue as number) * 10 + additionalForDepth,
    };
  }

  // For non-numeric types with depth > 1, we can't calculate exact value
  // because formula chain uses numeric operations (+10)
  if (computedType === 'formula' && sourceType === 'singleLineText' && depth === 1) {
    return {
      shouldChange: true,
      shouldBeNull: false,
      exactValue: `Result: ${updatedValue}`,
    };
  }

  if (computedType === 'formula' && sourceType === 'checkbox' && depth === 1) {
    return {
      shouldChange: true,
      shouldBeNull: false,
      exactValue: updatedValue ? 'Yes' : 'No',
    };
  }

  // Default: just verify change
  return { shouldChange: true, shouldBeNull: false };
};

// =============================================================================
// Expected Steps Generator
// =============================================================================

export const getExpectedSteps = (
  computedType: string,
  chainDepth: number,
  linkConfig?: { relationship: string; direction: LinkDirection }
): ExpectedSteps => {
  // Simple scenario: exact verification
  const simpleKey = `${computedType}_d${chainDepth}`;
  if (SIMPLE_SCENARIO_STEPS[simpleKey] !== undefined) {
    return {
      exact: SIMPLE_SCENARIO_STEPS[simpleKey],
      mustContainFields: [],
    };
  }

  // Check for oneWay lookup/rollup
  if (linkConfig?.direction === 'oneWay') {
    const oneWayKey = `${computedType}_oneWay`;
    if (SIMPLE_SCENARIO_STEPS[oneWayKey] !== undefined) {
      return {
        exact: SIMPLE_SCENARIO_STEPS[oneWayKey],
        mustContainFields: [],
      };
    }
  }

  // Complex scenario: range verification
  let base = chainDepth;
  if (linkConfig?.direction === 'twoWay') {
    base += 1; // Symmetric link update
  }

  return {
    minSteps: 1,
    maxSteps: base + 2,
    mustContainFields: [],
  };
};

// =============================================================================
// Result Verification
// =============================================================================

export const verifyResult = (
  beforeValue: unknown,
  afterValue: unknown,
  expected: ExpectedResult
): void => {
  if (expected.shouldBeNull) {
    expect(afterValue).toBeNull();
  } else {
    expect(afterValue).not.toBeNull();
  }

  if (expected.shouldChange && beforeValue !== null && beforeValue !== undefined) {
    expect(afterValue).not.toBe(beforeValue);
  }

  if (expected.exactValue !== undefined) {
    expect(afterValue).toBe(expected.exactValue);
  }
};

// =============================================================================
// Steps Verification
// =============================================================================

interface ComputedUpdatePlan {
  steps: Array<{
    tableId: string;
    fieldIds: string[];
    level: number;
  }>;
}

export const verifySteps = (
  plan: ComputedUpdatePlan | null | undefined,
  expected: ExpectedSteps,
  computedFieldId: string
): void => {
  expect(plan).toBeDefined();

  if (!plan) return;

  // Exact or range verification
  if (expected.exact !== undefined) {
    expect(plan.steps.length).toBe(expected.exact);
  } else {
    expect(plan.steps.length).toBeGreaterThanOrEqual(expected.minSteps ?? 1);
    expect(plan.steps.length).toBeLessThanOrEqual(expected.maxSteps ?? 10);
  }

  // Field inclusion verification
  const allFieldIds = plan.steps.flatMap((s) => s.fieldIds);
  expect(allFieldIds).toContain(computedFieldId);

  for (const fieldId of expected.mustContainFields) {
    expect(allFieldIds).toContain(fieldId);
  }
};

// =============================================================================
// Lookup Value Verification
// =============================================================================

export const verifyLookupValue = (
  value: unknown,
  expectedValues: unknown[] | null,
  transition: ValueTransition
): void => {
  if (transition === 'valueToNull' || expectedValues === null) {
    // Lookup returns array, check if empty or contains null
    if (Array.isArray(value)) {
      expect(value.every((v) => v === null)).toBe(true);
    } else {
      expect(value).toBeNull();
    }
    return;
  }

  expect(Array.isArray(value)).toBe(true);
  if (Array.isArray(value) && Array.isArray(expectedValues)) {
    // Sort both arrays for comparison
    const sortedValue = [...value].sort();
    const sortedExpected = [...expectedValues].sort();
    expect(sortedValue).toEqual(sortedExpected);
  }
};

// =============================================================================
// Rollup Value Verification
// =============================================================================

export const verifyRollupValue = (
  value: unknown,
  sourceType: SourceFieldType,
  sourceValues: unknown[],
  transition: ValueTransition
): void => {
  if (transition === 'valueToNull') {
    // Rollup with null values might return 0, null, or empty string
    expect([0, null, '', undefined]).toContain(value);
    return;
  }

  // Calculate expected rollup based on source type and values
  if (sourceType === 'number' || sourceType === 'rating') {
    // SUM
    const expectedSum = sourceValues.reduce((acc, v) => {
      if (typeof v === 'number') return (acc as number) + v;
      return acc;
    }, 0);
    expect(value).toBe(expectedSum);
  } else if (sourceType === 'checkbox') {
    // COUNTALL
    expect(value).toBe(sourceValues.length);
  } else {
    // ARRAYJOIN - just verify it's not null
    expect(value).not.toBeNull();
  }
};

// =============================================================================
// Cell Display Verification (from existing tests)
// =============================================================================

const formatArrayCellValue = (items: unknown[]): string => {
  if (items.length === 0) return '[]';
  const hasLinkObjects = items.some(
    (item) => typeof item === 'object' && item !== null && 'title' in item
  );
  if (hasLinkObjects) {
    const sorted = [...items].sort((a, b) =>
      String((a as { title?: string }).title ?? '').localeCompare(
        String((b as { title?: string }).title ?? '')
      )
    );
    return sorted
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return (item as { title?: string }).title ?? '?';
        }
        return String(item);
      })
      .join(', ');
  }
  return `[${items.map((item) => String(item)).join(', ')}]`;
};

const parseJsonArrayCell = (value: string): unknown[] | null => {
  if (!value.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const formatCellValueForExpect = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return formatArrayCellValue(value);
  if (typeof value === 'string') {
    const parsedArray = parseJsonArrayCell(value);
    if (parsedArray) return formatArrayCellValue(parsedArray);
    return value;
  }
  if (typeof value === 'object') {
    const obj = value as { title?: string; id?: string };
    if (obj.title !== undefined) return obj.title;
    if (obj.id !== undefined) return obj.id;
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
};

export const expectCellDisplay = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  recordIndex: number,
  fieldId: string,
  expectedDisplay: string
): void => {
  const value = records[recordIndex]?.fields[fieldId];
  expect(formatCellValueForExpect(value)).toBe(expectedDisplay);
};

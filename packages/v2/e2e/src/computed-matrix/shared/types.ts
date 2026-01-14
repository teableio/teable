/**
 * Types for computed field matrix tests
 */

import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';

// =============================================================================
// Source Field Types
// =============================================================================

export type SourceFieldType =
  | 'number'
  | 'singleLineText'
  | 'longText'
  | 'checkbox'
  | 'rating'
  | 'date'
  | 'singleSelect'
  | 'formula'
  | 'lookup'
  | 'rollup';

// =============================================================================
// Computed Field Types
// =============================================================================

export type ComputedFieldType =
  | 'formula'
  | 'lookup'
  | 'rollup'
  | 'conditionalLookup'
  | 'conditionalRollup';

// =============================================================================
// Operation Types
// =============================================================================

export type OperationType = 'createRecord' | 'updateRecord' | 'deleteRecord' | 'updateLink';

// =============================================================================
// Value Transition Types
// =============================================================================

export type ValueTransition =
  | 'nullToValue'
  | 'valueToValue'
  | 'valueToNull'
  | 'emptyToValues'
  | 'valuesToEmpty'
  | 'addItem'
  | 'removeItem';

// =============================================================================
// Link Configuration
// =============================================================================

export type LinkRelationship = 'oneOne' | 'oneMany' | 'manyOne' | 'manyMany';
export type LinkDirection = 'oneWay' | 'twoWay';
export type SelfRefType = 'none' | 'selfManyOne' | 'selfManyMany';

export interface LinkConfig {
  relationship: LinkRelationship;
  direction: LinkDirection;
  selfRef?: SelfRefType;
}

// =============================================================================
// Expected Result Types
// =============================================================================

export interface ExpectedResult {
  shouldChange: boolean;
  shouldBeNull: boolean;
  exactValue?: unknown;
}

export interface ExpectedSteps {
  exact?: number;
  minSteps?: number;
  maxSteps?: number;
  mustContainFields: string[];
}

// =============================================================================
// Test Context
// =============================================================================

export interface TestContext {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  dispose?: () => Promise<void>;
  createTable: (payload: unknown) => Promise<{ id: string; name: string; fields: unknown[] }>;
  createField: (payload: unknown) => Promise<unknown>;
  createRecord: (
    tableId: string,
    fields: Record<string, unknown>
  ) => Promise<{ id: string; fields: Record<string, unknown> }>;
  updateRecord: (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => Promise<{ id: string; fields: Record<string, unknown> }>;
  deleteRecord: (tableId: string, recordId: string) => Promise<void>;
  listRecords: (tableId: string) => Promise<Array<{ id: string; fields: Record<string, unknown> }>>;
  getTableById: (tableId: string) => Promise<{
    id: string;
    name: string;
    fields: Array<{ id: string; type: string; options?: unknown }>;
  }>;
  drainOutbox: (maxRounds?: number) => Promise<void>;
  clearLogs: () => void;
  getLastComputedPlan: () => unknown;
}

// =============================================================================
// Test Case Types
// =============================================================================

export interface FormulaTestCase {
  source: SourceFieldType;
  transition: ValueTransition;
  depth: number;
}

export interface LookupTestCase {
  source: SourceFieldType;
  transition: ValueTransition;
  rel: LinkRelationship;
  dir: LinkDirection;
}

export interface RollupTestCase {
  source: SourceFieldType;
  transition: ValueTransition;
  rel: LinkRelationship;
  dir: LinkDirection;
  expression: string;
}

export interface SelfRefTestCase {
  selfRef: SelfRefType;
  computed: 'lookup' | 'rollup';
  transition: ValueTransition;
}

export interface ChainTestCase {
  depth: number;
  transition: ValueTransition;
}

export interface ConditionalTestCase {
  type: 'conditionalLookup' | 'conditionalRollup';
  conditionType: 'statusFilter' | 'valueThreshold' | 'multiCondition';
  transition: ValueTransition;
}

export interface LinkOpTestCase {
  operation: 'linkAdd' | 'linkRemove' | 'linkReplace' | 'linkClear';
  rel: LinkRelationship;
}

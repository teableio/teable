/**
 * Types for computed field matrix tests
 */

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

// TestContext is now imported from globalTestContext
// Re-exported here for backwards compatibility
export type { SharedTestContext as TestContext } from '../../shared/globalTestContext';

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

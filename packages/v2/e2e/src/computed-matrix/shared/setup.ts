/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Test setup and API helpers for computed matrix tests
 *
 * This module re-exports the shared test context from globalTestContext
 * and provides additional computed-matrix-specific utilities.
 */

import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

// Re-export types
export type { SharedTestContext as TestContext } from '../../shared/globalTestContext';

// =============================================================================
// Test Context Factory
// =============================================================================

export const createTestContext = async (): Promise<SharedTestContext> => {
  return getSharedTestContext();
};

/**
 * Vitest setup file for E2E tests.
 *
 * This file is executed once per worker process before any tests run.
 * It handles global cleanup when all tests in the worker are complete.
 */

import { afterAll } from 'vitest';
import { disposeSharedTestContext } from './globalTestContext';

// Register global cleanup
afterAll(async () => {
  await disposeSharedTestContext();
});

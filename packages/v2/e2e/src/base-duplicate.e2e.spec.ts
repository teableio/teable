import { describe, test } from 'vitest';

describe('base duplicate parity (e2e)', () => {
  test.todo(
    '[V1 PARITY][API GAP] should duplicate base with link field, lookup field and records',
    () => {
      // BLOCKED BY V2 HTTP CONTRACT GAP
      //
      // V1 reference:
      // - base-duplicate.e2e-spec.ts
      // - "duplicate base with link field"
      //
      // Expected parity scenario:
      // 1. Create table1/table2 in source base and create two-way link field.
      // 2. Change symmetric relationship (oneMany <-> manyMany) to verify schema stability.
      // 3. Add lookup field on linked table and write linked record values.
      // 4. Duplicate base with records.
      // 5. Assert:
      //    - linked values in duplicated tables still point to duplicated record IDs
      //    - lookup values are preserved and continue to update
      //    - no missing relation errors during subsequent field updates.
      //
      // Current blocker:
      // - v2 contract-http has /bases/create and /bases/list only.
      // - No /bases/duplicate endpoint is available yet.
    }
  );
});

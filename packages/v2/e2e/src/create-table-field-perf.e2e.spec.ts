/**
 * Performance regression guard for createTable + createField.
 *
 * PR #1435 introduced a regression where missing ANALYZE after createTable
 * caused subsequent createField (formula backfill SQL) to jump from ~10ms to
 * ~700ms (50x). This test ensures that creating a table with records followed
 * by link → lookup → formula fields completes within a reasonable threshold.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const THRESHOLD_MS = 10_000;

describe('createTable + createField performance guard', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  let foreignTableId = '';
  let hostTableId = '';

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    if (hostTableId) await ctx.deleteTable(hostTableId);
    if (foreignTableId) await ctx.deleteTable(foreignTableId);
  });

  it('creates link, lookup, and formula fields within threshold after table creation', async () => {
    // --- Step 1: Create foreign table with 2 fields and several records ---
    const foreignNameFieldId = createFieldId();
    const foreignScoreFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Perf_Foreign',
      fields: [
        { type: 'singleLineText', id: foreignNameFieldId, name: 'Name', isPrimary: true },
        { type: 'number', id: foreignScoreFieldId, name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;

    // Insert records into the foreign table
    const recordCount = 20;
    for (let i = 0; i < recordCount; i++) {
      await ctx.createRecord(foreignTableId, {
        [foreignNameFieldId]: `Item ${i}`,
        [foreignScoreFieldId]: i * 10,
      });
    }

    // --- Step 2: Create host table with 1 field and 1 record ---
    const hostNameFieldId = createFieldId();

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Perf_Host',
      fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    hostTableId = hostTable.id;

    await ctx.createRecord(hostTableId, { [hostNameFieldId]: 'Host Record' });

    // --- Step 3: Create link → lookup → formula chain (timed) ---
    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();
    const formulaAFieldId = createFieldId();
    const formulaBFieldId = createFieldId();
    const formulaCFieldId = createFieldId();

    const start = performance.now();

    // Link field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Link to Foreign',
        options: {
          relationship: 'manyOne',
          foreignTableId,
          lookupFieldId: foreignNameFieldId,
        },
      },
    });

    // Lookup field
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Lookup Score',
        options: {
          linkFieldId,
          foreignTableId,
          lookupFieldId: foreignScoreFieldId,
        },
      },
    });

    // Formula A – references the lookup
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'formula',
        id: formulaAFieldId,
        name: 'Formula A',
        options: {
          expression: `IF({${lookupFieldId}}, "has score", "no score")`,
        },
      },
    });

    // Formula B – references Formula A
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'formula',
        id: formulaBFieldId,
        name: 'Formula B',
        options: {
          expression: `{${formulaAFieldId}} & " (copy)"`,
        },
      },
    });

    // Formula C – references Formula B
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'formula',
        id: formulaCFieldId,
        name: 'Formula C',
        options: {
          expression: `{${formulaBFieldId}}`,
        },
      },
    });

    const elapsed = performance.now() - start;

    // --- Step 4: Assert performance ---
    expect(
      elapsed,
      `createField chain took ${elapsed.toFixed(0)}ms, exceeds threshold of ${THRESHOLD_MS}ms`
    ).toBeLessThan(THRESHOLD_MS);
  });
});

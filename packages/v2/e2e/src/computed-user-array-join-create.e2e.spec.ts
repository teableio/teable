/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized structure-equivalent regression for T7024.
 *
 * Retained structure:
 * - host table with seven scalar user fields
 * - same-table formula ARRAY_JOIN(ARRAY_UNIQUE(ARRAY_COMPACT(ARRAY_FLATTEN({7 users}))))
 * - oneOne link + scalar longText lookup from a foreign table
 * - create-record path that synchronously recomputes the formula
 *
 * Names and values are synthetic. No customer identifiers.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 nested user ARRAY_JOIN create (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldSequence = 0;
  let cleanupTableIds: string[] = [];

  const createFieldId = (label: string) => {
    fieldSequence += 1;
    const suffix = `${label}${fieldSequence}`.replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
    return `fld${suffix.padEnd(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  afterEach(async () => {
    const tableIds = [...cleanupTableIds].reverse();
    cleanupTableIds = [];
    for (const tableId of tableIds) {
      await ctx.deleteTable(tableId, { mode: 'permanent' });
    }
  }, 180_000);

  it('creates a record while joining flattened scalar user fields without hanging', async () => {
    const foreignNameFieldId = createFieldId('foreignName');
    const campusFieldId = createFieldId('campus');
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `SyntheticSessions_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: foreignNameFieldId,
          name: 'Session name',
          isPrimary: true,
        },
        {
          type: 'longText',
          id: campusFieldId,
          name: 'Campus',
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(foreignTable.id);

    const foreignRecord = await ctx.createRecord(foreignTable.id, {
      [foreignNameFieldId]: 'Session A',
      [campusFieldId]: 'North campus',
    });

    const hostNameFieldId = createFieldId('hostName');
    const trainerFieldIds = Array.from({ length: 7 }, (_, index) =>
      createFieldId(`trainer${index + 1}`)
    );
    const linkFieldId = createFieldId('sessionLink');
    const campusLookupFieldId = createFieldId('campusLookup');
    const joinedTrainersFieldId = createFieldId('joinedTrainers');
    const flattenArgs = trainerFieldIds.map((fieldId) => `{${fieldId}}`).join(', ');

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `SyntheticNotes_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: hostNameFieldId,
          name: 'Note name',
          isPrimary: true,
        },
        ...trainerFieldIds.map((fieldId, index) => ({
          type: 'user' as const,
          id: fieldId,
          name: `Trainer ${index + 1}`,
          options: { isMultiple: false, shouldNotify: false },
        })),
        {
          type: 'link',
          id: linkFieldId,
          name: 'Session',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: campusLookupFieldId,
          name: 'Campus lookup',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: campusFieldId,
          },
        },
        {
          type: 'formula',
          id: joinedTrainersFieldId,
          name: 'Joined trainers',
          options: {
            expression: `ARRAY_JOIN(ARRAY_UNIQUE(ARRAY_COMPACT(ARRAY_FLATTEN(${flattenArgs}))), "、")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(hostTable.id);

    const userValue = { id: ctx.testUser.id, title: ctx.testUser.name };
    const startedAt = Date.now();
    const created = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'Note 001',
      ...Object.fromEntries(trainerFieldIds.map((fieldId) => [fieldId, userValue])),
      [linkFieldId]: { id: foreignRecord.id },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(15_000);
    expect(created.id).toBeTruthy();
    const [record] = await ctx.listRecordsWithoutDrain(hostTable.id, { limit: 1 });

    expect(String(record?.fields[joinedTrainersFieldId])).toContain(ctx.testUser.id);
    expect(record?.fields[campusLookupFieldId]).toEqual(['North campus']);
  }, 60_000);
});

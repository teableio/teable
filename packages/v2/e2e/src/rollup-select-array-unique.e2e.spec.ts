/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent coverage for T7044 / Y460:
 * oneMany rollup over a single-select source.
 *
 * Retained structure:
 * - parent oneMany -> child
 * - child scalar single-select
 * - array_join / array_unique / array_compact / count / counta rollups
 * - first-occurrence unique order, then duplicate non-empty select values
 *
 * No customer identifiers or record values.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 rollup ARRAY_UNIQUE / COUNT over single-select (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('preserves first-occurrence unique order and counts unique non-empty select values', async () => {
    const childPrimaryFieldId = createFieldId();
    const childStatusFieldId = createFieldId();
    const parentPrimaryFieldId = createFieldId();
    const parentLinkFieldId = createFieldId();
    const arrayJoinFieldId = createFieldId();
    const arrayUniqueFieldId = createFieldId();
    const arrayCompactFieldId = createFieldId();
    const countFieldId = createFieldId();
    const countAFieldId = createFieldId();

    let childTableId: string | undefined;
    let parentTableId: string | undefined;

    try {
      const child = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelectRollup Child',
        fields: [
          { type: 'singleLineText', id: childPrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: childStatusFieldId,
            name: 'Status',
            options: {
              choices: [
                { name: 'Todo', color: 'blue' },
                { name: 'Done', color: 'green' },
              ],
            },
          },
        ],
      });
      childTableId = child.id;

      const parent = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelectRollup Parent',
        fields: [
          { type: 'singleLineText', id: parentPrimaryFieldId, name: 'Name', isPrimary: true },
        ],
      });
      parentTableId = parent.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parent.id,
        field: {
          type: 'link',
          id: parentLinkFieldId,
          name: 'Children',
          options: {
            relationship: 'oneMany',
            foreignTableId: child.id,
            lookupFieldId: childPrimaryFieldId,
          },
        },
      });

      const rollupSpecs = [
        { id: arrayJoinFieldId, expression: 'array_join({values})', name: 'Join' },
        { id: arrayUniqueFieldId, expression: 'array_unique({values})', name: 'Unique' },
        { id: arrayCompactFieldId, expression: 'array_compact({values})', name: 'Compact' },
        { id: countFieldId, expression: 'count({values})', name: 'Count' },
        { id: countAFieldId, expression: 'counta({values})', name: 'CountA' },
      ] as const;

      for (const spec of rollupSpecs) {
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: parent.id,
          field: {
            type: 'rollup',
            id: spec.id,
            name: spec.name,
            options: { expression: spec.expression },
            config: {
              linkFieldId: parentLinkFieldId,
              foreignTableId: child.id,
              lookupFieldId: childStatusFieldId,
            },
          },
        });
      }

      const first = await ctx.createRecord(child.id, {
        [childPrimaryFieldId]: 'First',
        [childStatusFieldId]: 'Todo',
      });
      const second = await ctx.createRecord(child.id, {
        [childPrimaryFieldId]: 'Second',
        [childStatusFieldId]: 'Done',
      });

      const parentRecord = await ctx.createRecord(parent.id, {
        [parentPrimaryFieldId]: 'Host',
        [parentLinkFieldId]: [{ id: first.id }, { id: second.id }],
      });
      await ctx.drainOutbox();

      const readParent = async () => {
        const records = await ctx.listRecords(parent.id);
        return records.find((record) => record.id === parentRecord.id);
      };

      let record = await readParent();
      expect(record?.fields[arrayJoinFieldId]).toEqual('Todo, Done');
      expect(record?.fields[arrayCompactFieldId]).toEqual(['Todo', 'Done']);
      expect(record?.fields[arrayUniqueFieldId]).toEqual(['Todo', 'Done']);

      await ctx.updateRecord(child.id, second.id, { [childStatusFieldId]: 'Todo' });
      await ctx.drainOutbox();

      record = await readParent();
      expect(record?.fields[arrayUniqueFieldId]).toEqual(['Todo']);
      expect(record?.fields[arrayCompactFieldId]).toEqual(['Todo', 'Todo']);
      expect(record?.fields[countAFieldId]).toEqual(2);
      expect(record?.fields[countFieldId]).toEqual(1);
    } finally {
      if (parentTableId) await ctx.deleteTable(parentTableId).catch(() => undefined);
      if (childTableId) await ctx.deleteTable(childTableId).catch(() => undefined);
    }
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
import type { RecordFilter } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests verifying that filter operators correctly handle NULL values.
 *
 * These tests verify the fix for NULL handling in negative filter operators.
 * v1 includes NULL rows in negative conditions (isNot, doesNotContain, isNoneOf).
 * v2 must produce the same behavior so paste/list operations target the correct rows.
 */
describe('record filter NULL handling (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // ----------------------------------------------------------------
  // isNot — NULL rows should be included
  // ----------------------------------------------------------------
  describe('isNot filter includes NULL rows', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let statusFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'IsNot NULL Test',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Status', type: 'singleSelect', options: ['Active', 'Inactive'] },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Create records — some with NULL Status
      for (const [name, status] of [
        ['Rec1', 'Active'],
        ['Rec2', null], // NULL — should pass "isNot Active"
        ['Rec3', 'Inactive'],
        ['Rec4', null], // NULL — should pass "isNot Active"
        ['Rec5', 'Active'],
      ] as const) {
        await ctx.createRecord(tableId, {
          [nameFieldId]: name,
          ...(status ? { [statusFieldId]: status } : {}),
        });
      }
    }, 30000);

    it('paste with isNot filter should target NULL rows', async () => {
      // Filter: Status isNot "Active"
      // Expected rows: Rec2(NULL), Rec3(Inactive), Rec4(NULL) = 3 rows
      const filter: RecordFilter = {
        fieldId: statusFieldId,
        operator: 'isNot',
        value: 'Active',
      };

      // Paste to row 0 of filtered result → should target Rec2 (first NULL)
      const result = await ctx.paste({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['IsNotPasted']],
        filter,
      });

      expect(result.updatedCount).toBe(1);

      const records = await ctx.listRecords(tableId);
      const updated = records.find((r) => r.fields[nameFieldId] === 'IsNotPasted');

      // The updated record should have NULL status (was Rec2)
      expect(updated).toBeDefined();
      expect(updated?.fields[statusFieldId]).toBeNull();
    });

    it('paste with isNot filter should correctly count 3 filtered rows', async () => {
      const filter: RecordFilter = {
        fieldId: statusFieldId,
        operator: 'isNot',
        value: 'Active',
      };

      // Paste 3 rows → should update Rec2, Rec3, Rec4
      const result = await ctx.paste({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['Row0'], ['Row1'], ['Row2']],
        filter,
      });

      // Should update exactly 3 records (2 NULL + 1 Inactive)
      expect(result.updatedCount).toBe(3);
    });
  });

  // ----------------------------------------------------------------
  // doesNotContain — NULL rows should be included
  // ----------------------------------------------------------------
  describe('doesNotContain filter includes NULL rows', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let descFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DoesNotContain NULL Test',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Desc', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      descFieldId = table.fields.find((f) => f.name === 'Desc')?.id ?? '';

      for (const [name, desc] of [
        ['Rec1', 'important task'],
        ['Rec2', null], // NULL — should pass "doesNotContain important"
        ['Rec3', 'regular work'],
        ['Rec4', null], // NULL — should pass "doesNotContain important"
        ['Rec5', 'important meeting'],
      ] as const) {
        await ctx.createRecord(tableId, {
          [nameFieldId]: name,
          ...(desc ? { [descFieldId]: desc } : {}),
        });
      }
    }, 30000);

    it('paste with doesNotContain filter should include NULL rows', async () => {
      // Filter: Desc doesNotContain "important"
      // Expected rows: Rec2(NULL), Rec3(regular work), Rec4(NULL) = 3 rows
      const filter: RecordFilter = {
        fieldId: descFieldId,
        operator: 'doesNotContain',
        value: 'important',
      };

      const result = await ctx.paste({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['DNContain1'], ['DNContain2'], ['DNContain3']],
        filter,
      });

      // Should update 3 records: Rec2(NULL), Rec3(regular), Rec4(NULL)
      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((r) => r.fields[descFieldId] === 'important task');
      const rec5 = records.find((r) => r.fields[descFieldId] === 'important meeting');

      // Records with "important" in desc should NOT be updated
      expect(rec1?.fields[nameFieldId]).toBe('Rec1');
      expect(rec5?.fields[nameFieldId]).toBe('Rec5');
    });
  });

  // ----------------------------------------------------------------
  // checkbox is(false) — NULL (unchecked) rows should be included
  // ----------------------------------------------------------------
  describe('checkbox is(false) filter includes NULL rows', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let doneFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Checkbox False NULL Test',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Done', type: 'checkbox' },
        ],
        views: [{ type: 'grid' }],
      });

      tableId = table.id;
      viewId = table.views[0].id;
      nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      doneFieldId = table.fields.find((f) => f.name === 'Done')?.id ?? '';

      // Create records — unchecked checkboxes are stored as NULL
      for (const [name, done] of [
        ['Checked1', true],
        ['Unchecked1', null], // NULL = unchecked
        ['Checked2', true],
        ['Unchecked2', null], // NULL = unchecked
        ['Unchecked3', null], // NULL = unchecked
      ] as const) {
        await ctx.createRecord(tableId, {
          [nameFieldId]: name,
          ...(done ? { [doneFieldId]: done } : {}),
        });
      }
    }, 30000);

    it('paste with checkbox is(false) filter should include NULL (unchecked) rows', async () => {
      // Filter: Done is false
      // v1: (Done = false OR Done IS NULL) — includes all unchecked rows
      // Expected rows: Unchecked1, Unchecked2, Unchecked3 = 3 rows
      const filter: RecordFilter = {
        fieldId: doneFieldId,
        operator: 'is',
        value: false,
      };

      const result = await ctx.paste({
        tableId,
        viewId,
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['CheckboxFalse1'], ['CheckboxFalse2'], ['CheckboxFalse3']],
        filter,
      });

      // Should update 3 records (all unchecked/NULL)
      expect(result.updatedCount).toBe(3);

      const records = await ctx.listRecords(tableId);
      const checked1 = records.find(
        (r) => r.fields[doneFieldId] === true && r.fields[nameFieldId] === 'Checked1'
      );
      const checked2 = records.find(
        (r) => r.fields[doneFieldId] === true && r.fields[nameFieldId] === 'Checked2'
      );

      // Checked records should NOT be updated
      expect(checked1?.fields[nameFieldId]).toBe('Checked1');
      expect(checked2?.fields[nameFieldId]).toBe('Checked2');
    });
  });
});

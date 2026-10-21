/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7819 / T7821 — formula button references and empty-set rollups.
 *
 * A button cell stores click configuration, not a value a formula may read.
 * An empty link (and a link cleared afterwards) has no values to average or xor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const empty = (value: unknown): unknown => value ?? null;

describe('T7819 T7821 formula button reference and empty rollup', () => {
  let ctx: SharedTestContext;
  const tableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterAll(async () => {
    for (const tableId of tableIds.reverse()) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  const track = <T extends { id: string }>(table: T): T => {
    tableIds.push(table.id);
    return table;
  };

  it('T7819 reads a formula reference to a button field as empty', async () => {
    const table = track(
      await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7819 Button Formula',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      })
    );
    const nameId = table.fields.find((field) => field.name === 'Name')!.id;
    const withButton = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'button',
        name: 'Run',
        options: { label: 'Run', color: 'red', maxCount: 5, resetCount: true },
      },
    });
    const buttonId = withButton.fields.find((field) => field.name === 'Run')!.id;
    const record = await ctx.createRecord(table.id, {
      [nameId]: 'clicked',
      [buttonId]: { count: 1 },
    });

    const withFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'ButtonRef',
        options: { expression: `{${buttonId}}` },
      },
    });
    const formulaId = withFormula.fields.find((field) => field.name === 'ButtonRef')!.id;

    const read = async () => {
      const rows = await ctx.listRecords(table.id, { limit: 10 });
      return rows.find((row) => row.id === record.id);
    };

    const stored = await read();
    expect(stored?.fields[buttonId]).toEqual({ count: 1 });
    expect(empty(stored?.fields[formulaId])).toBeNull();

    await ctx.updateRecord(table.id, record.id, { [buttonId]: { count: 3 } });
    const updated = await read();
    expect(updated?.fields[buttonId]).toEqual({ count: 3 });
    expect(empty(updated?.fields[formulaId])).toBeNull();
  });

  it('T7821 returns empty average and xor for an empty link and after unlink', async () => {
    const foreign = track(
      await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7821 Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Amount' },
          { type: 'checkbox', name: 'Flag' },
        ],
        views: [{ type: 'grid' }],
      })
    );
    const foreignNameId = foreign.fields.find((field) => field.name === 'Name')!.id;
    const amountId = foreign.fields.find((field) => field.name === 'Amount')!.id;
    const flagId = foreign.fields.find((field) => field.name === 'Flag')!.id;
    const checked = await ctx.createRecord(foreign.id, {
      [foreignNameId]: 'Checked',
      [amountId]: 10,
      [flagId]: true,
    });
    const unchecked = await ctx.createRecord(foreign.id, {
      [foreignNameId]: 'Unchecked',
      [amountId]: 20,
    });

    const host = track(
      await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7821 Host',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      })
    );
    const hostNameId = host.fields.find((field) => field.name === 'Name')!.id;
    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.id,
      field: {
        type: 'link',
        name: 'Items',
        options: {
          relationship: 'manyMany',
          foreignTableId: foreign.id,
          lookupFieldId: foreignNameId,
          isOneWay: true,
        },
      },
    });
    const linkId = withLink.fields.find((field) => field.name === 'Items')!.id;

    const rollups = [
      { name: 'Average', expression: 'average({values})', lookupFieldId: amountId },
      { name: 'Sum', expression: 'sum({values})', lookupFieldId: amountId },
      { name: 'And', expression: 'and({values})', lookupFieldId: flagId },
      { name: 'Or', expression: 'or({values})', lookupFieldId: flagId },
      { name: 'Xor', expression: 'xor({values})', lookupFieldId: flagId },
    ] as const;
    const rollupIds: Record<(typeof rollups)[number]['name'], string> = {
      Average: '',
      Sum: '',
      And: '',
      Or: '',
      Xor: '',
    };
    for (const rollup of rollups) {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'rollup',
          name: rollup.name,
          options: { expression: rollup.expression },
          config: {
            linkFieldId: linkId,
            foreignTableId: foreign.id,
            lookupFieldId: rollup.lookupFieldId,
          },
        },
      });
      rollupIds[rollup.name] = created.fields.find((field) => field.name === rollup.name)!.id;
    }

    const emptyHost = await ctx.createRecord(host.id, { [hostNameId]: 'Empty' });
    const linkedHost = await ctx.createRecord(host.id, {
      [hostNameId]: 'Linked',
      [linkId]: [{ id: checked.id }, { id: unchecked.id }],
    });

    const read = async (recordId: string) => {
      const rows = await ctx.listRecords(host.id, { limit: 10 });
      const row = rows.find((candidate) => candidate.id === recordId);
      expect(row).toBeDefined();
      return row!.fields;
    };

    const emptyFields = await read(emptyHost.id);
    expect(emptyFields[rollupIds.Sum]).toEqual(0);
    expect(empty(emptyFields[rollupIds.And])).toBeNull();
    expect(empty(emptyFields[rollupIds.Or])).toBeNull();
    expect.soft(empty(emptyFields[rollupIds.Average])).toBeNull();
    expect.soft(empty(emptyFields[rollupIds.Xor])).toBeNull();

    const linkedFields = await read(linkedHost.id);
    expect(linkedFields[rollupIds.Average]).toEqual(15);
    expect(linkedFields[rollupIds.Sum]).toEqual(30);
    expect(linkedFields[rollupIds.And]).toBe(true);
    expect(linkedFields[rollupIds.Or]).toBe(true);
    expect(linkedFields[rollupIds.Xor]).toBe(true);

    await ctx.updateRecord(host.id, linkedHost.id, { [linkId]: null });
    const unlinkedFields = await read(linkedHost.id);
    expect(unlinkedFields[rollupIds.Sum]).toEqual(0);
    expect(empty(unlinkedFields[rollupIds.Average])).toBeNull();
    expect(empty(unlinkedFields[rollupIds.Xor])).toBeNull();
    expect(empty(unlinkedFields[rollupIds.And])).toBeNull();
    expect(empty(unlinkedFields[rollupIds.Or])).toBeNull();
  });
});

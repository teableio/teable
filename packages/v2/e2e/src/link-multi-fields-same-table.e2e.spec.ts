/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for multiple link fields between the same pair of tables.
 *
 * Ported from v1 link-api.e2e-spec.ts:
 * - "Create two bi-link for two tables" (two same manyOne / two same oneMany links)
 * - "multi link with depends same field" (link title + lookup/rollup refresh when the
 *   shared foreign primary field changes and several link fields depend on it)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 link fields to the same foreign table (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  const createTablePair = async (namePrefix: string) => {
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: `${namePrefix} Foreign`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const host = await ctx.createTable({
      baseId: ctx.baseId,
      name: `${namePrefix} Host`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignPrimaryFieldId = foreign.fields.find((f) => f.isPrimary)?.id ?? '';
    const hostPrimaryFieldId = host.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!foreignPrimaryFieldId || !hostPrimaryFieldId) {
      throw new Error('Missing primary fields for table pair');
    }
    return { foreign, host, foreignPrimaryFieldId, hostPrimaryFieldId };
  };

  const createLinkField = async (
    tableId: string,
    name: string,
    relationship: 'manyOne' | 'oneMany' | 'manyMany' | 'oneOne',
    foreignTableId: string,
    lookupFieldId: string
  ) => {
    const table = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'link',
        name,
        options: {
          relationship,
          foreignTableId,
          lookupFieldId,
          isOneWay: false,
        },
      },
    });
    const field = table.fields.find((f) => f.name === name);
    if (!field) throw new Error(`Missing link field ${name}`);
    return field;
  };

  it('updates one record through two manyOne links to the same foreign table', async () => {
    const { foreign, host, foreignPrimaryFieldId, hostPrimaryFieldId } =
      await createTablePair('TwoManyOne');

    const linkA = await createLinkField(
      host.id,
      'Link A',
      'manyOne',
      foreign.id,
      foreignPrimaryFieldId
    );
    const linkB = await createLinkField(
      host.id,
      'Link B',
      'manyOne',
      foreign.id,
      foreignPrimaryFieldId
    );

    const target = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'table2_1' });
    const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'table1_1' });
    await ctx.testContainer.processOutbox();

    // Set both manyOne cells to the same foreign record in a single update
    await ctx.updateRecord(host.id, hostRecord.id, {
      [linkA.id]: { id: target.id },
      [linkB.id]: { id: target.id },
    });
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    const records = await ctx.listRecords(host.id);
    const stored = records.find((r) => r.id === hostRecord.id);
    expect(stored?.fields[linkA.id]).toEqual({ id: target.id, title: 'table2_1' });
    expect(stored?.fields[linkB.id]).toEqual({ id: target.id, title: 'table2_1' });
  });

  it('updates one record through two oneMany links to the same foreign table', async () => {
    const { foreign, host, foreignPrimaryFieldId, hostPrimaryFieldId } =
      await createTablePair('TwoOneMany');

    const linkA = await createLinkField(
      host.id,
      'Link A',
      'oneMany',
      foreign.id,
      foreignPrimaryFieldId
    );
    const linkB = await createLinkField(
      host.id,
      'Link B',
      'oneMany',
      foreign.id,
      foreignPrimaryFieldId
    );

    const target = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'table2_1' });
    const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'table1_1' });
    await ctx.testContainer.processOutbox();

    // Each oneMany field owns its own FK on the foreign table, so the same child
    // can be linked through both fields without violating exclusivity.
    await ctx.updateRecord(host.id, hostRecord.id, {
      [linkA.id]: [{ id: target.id }],
      [linkB.id]: [{ id: target.id }],
    });
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    const records = await ctx.listRecords(host.id);
    const stored = records.find((r) => r.id === hostRecord.id);
    expect(stored?.fields[linkA.id]).toEqual([{ id: target.id, title: 'table2_1' }]);
    expect(stored?.fields[linkB.id]).toEqual([{ id: target.id, title: 'table2_1' }]);
  });

  it('refreshes manyOne link title when foreign primary changes with sibling oneMany link present', async () => {
    const { foreign, host, foreignPrimaryFieldId, hostPrimaryFieldId } =
      await createTablePair('MixedManyOne');

    const manyOneLink = await createLinkField(
      host.id,
      'ManyOne Link',
      'manyOne',
      foreign.id,
      foreignPrimaryFieldId
    );
    await createLinkField(host.id, 'OneMany Link', 'oneMany', foreign.id, foreignPrimaryFieldId);

    const target = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'x' });
    const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'host' });
    await ctx.testContainer.processOutbox();

    await ctx.updateRecord(host.id, hostRecord.id, {
      [manyOneLink.id]: { id: target.id },
    });
    await ctx.testContainer.processOutbox();

    // Change the shared foreign primary value: only the linked manyOne cell must refresh
    await ctx.updateRecord(foreign.id, target.id, { [foreignPrimaryFieldId]: 'y' });
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    const records = await ctx.listRecords(host.id);
    const stored = records.find((r) => r.id === hostRecord.id);
    expect(stored?.fields[manyOneLink.id]).toEqual({ id: target.id, title: 'y' });
  });

  it('refreshes oneMany link title and dependent lookups when foreign primary changes', async () => {
    const { foreign, host, foreignPrimaryFieldId, hostPrimaryFieldId } =
      await createTablePair('MixedOneMany');

    const oneManyLink = await createLinkField(
      host.id,
      'OneMany Link',
      'oneMany',
      foreign.id,
      foreignPrimaryFieldId
    );
    const manyOneLink = await createLinkField(
      host.id,
      'ManyOne Link',
      'manyOne',
      foreign.id,
      foreignPrimaryFieldId
    );

    const findFieldByName = (table: Awaited<ReturnType<typeof ctx.createField>>, name: string) => {
      const created = table.fields.find((f) => f.name === name);
      if (!created) throw new Error(`Missing computed field ${name}`);
      return created;
    };

    const lookupOneMany = findFieldByName(
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: 'Lookup OneMany',
          options: {
            linkFieldId: oneManyLink.id,
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      }),
      'Lookup OneMany'
    );
    const rollupOneMany = findFieldByName(
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'rollup',
          name: 'Rollup OneMany',
          options: { expression: 'countall({values})' },
          config: {
            linkFieldId: oneManyLink.id,
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      }),
      'Rollup OneMany'
    );
    const lookupManyOne = findFieldByName(
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: 'Lookup ManyOne',
          options: {
            linkFieldId: manyOneLink.id,
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      }),
      'Lookup ManyOne'
    );
    const rollupManyOne = findFieldByName(
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'rollup',
          name: 'Rollup ManyOne',
          options: { expression: 'countall({values})' },
          config: {
            linkFieldId: manyOneLink.id,
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      }),
      'Rollup ManyOne'
    );

    const target = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'x' });
    const hostRecord = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'host' });
    await ctx.testContainer.processOutbox();

    await ctx.updateRecord(host.id, hostRecord.id, {
      [oneManyLink.id]: [{ id: target.id }],
    });
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    let records = await ctx.listRecords(host.id);
    let stored = records.find((r) => r.id === hostRecord.id);
    expect(stored?.fields[oneManyLink.id]).toEqual([{ id: target.id, title: 'x' }]);

    // Change the shared foreign primary value
    await ctx.updateRecord(foreign.id, target.id, { [foreignPrimaryFieldId]: 'y' });
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    records = await ctx.listRecords(host.id);
    stored = records.find((r) => r.id === hostRecord.id);
    expect(stored?.fields[oneManyLink.id]).toEqual([{ id: target.id, title: 'y' }]);
    expect(stored?.fields[lookupOneMany.id]).toEqual(['y']);
    expect(stored?.fields[rollupOneMany.id]).toEqual(1);
    // The unrelated manyOne link stays empty: lookup reads back empty, rollup counts 0
    expect(stored?.fields[lookupManyOne.id] ?? undefined).toBeUndefined();
    expect(stored?.fields[rollupManyOne.id]).toEqual(0);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 formula COUNTALL user/link/lookup regression (e2e)', () => {
  let ctx: SharedTestContext;

  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const getFieldIdByName = (fields: Array<{ id: string; name: string }>, name: string) => {
    const fieldId = fields.find((field) => field.name === name)?.id;
    if (!fieldId) {
      throw new Error(`Missing field id for: ${name}`);
    }
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  it('counts values for multi-user field and linked lookup user field', async () => {
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('COUNTALL User Source'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'user',
          name: 'Owners',
          options: {
            isMultiple: true,
            shouldNotify: false,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const sourcePrimaryFieldId = getFieldIdByName(sourceTable.fields, 'Name');
    const ownersFieldId = getFieldIdByName(sourceTable.fields, 'Owners');

    const sourceTableWithFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTable.id,
      field: {
        type: 'formula',
        name: 'Owners Count',
        options: {
          expression: `COUNTALL({${ownersFieldId}})`,
        },
      },
    });
    const sourceOwnersCountFieldId = getFieldIdByName(
      sourceTableWithFormula.fields,
      'Owners Count'
    );

    const sourceRecordA = await ctx.createRecord(sourceTable.id, {
      [sourcePrimaryFieldId]: 'source-a',
      [ownersFieldId]: [
        { id: ctx.testUser.id, title: ctx.testUser.name, email: ctx.testUser.email },
      ],
    });
    const sourceRecordB = await ctx.createRecord(sourceTable.id, {
      [sourcePrimaryFieldId]: 'source-b',
    });

    await ctx.drainOutbox(3);

    const sourceRecords = await ctx.listRecords(sourceTable.id);
    const sourceA = sourceRecords.find((record) => record.id === sourceRecordA.id);
    const sourceB = sourceRecords.find((record) => record.id === sourceRecordB.id);

    expect(sourceA).toBeDefined();
    expect(sourceB).toBeDefined();
    if (!sourceA || !sourceB) return;

    expect(Number(sourceA.fields[sourceOwnersCountFieldId])).toBe(1);
    expect(Number(sourceB.fields[sourceOwnersCountFieldId] ?? 0)).toBe(0);

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('COUNTALL User Host'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const hostPrimaryFieldId = getFieldIdByName(hostTable.fields, 'Title');

    const hostTableWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'link',
        name: 'People',
        options: {
          relationship: 'manyMany',
          foreignTableId: sourceTable.id,
          lookupFieldId: sourcePrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkFieldId = getFieldIdByName(hostTableWithLink.fields, 'People');

    const hostTableWithLookup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        name: 'Lookup Owners',
        options: {
          linkFieldId,
          foreignTableId: sourceTable.id,
          lookupFieldId: ownersFieldId,
        },
      },
    });
    const lookupOwnersFieldId = getFieldIdByName(hostTableWithLookup.fields, 'Lookup Owners');

    const hostTableWithLinkCount = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'formula',
        name: 'People Count',
        options: {
          expression: `COUNTALL({${linkFieldId}})`,
        },
      },
    });
    const peopleCountFieldId = getFieldIdByName(hostTableWithLinkCount.fields, 'People Count');

    const hostTableWithLookupCount = await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'formula',
        name: 'Lookup Owners Count',
        options: {
          expression: `COUNTALL({${lookupOwnersFieldId}})`,
        },
      },
    });
    const lookupOwnersCountFieldId = getFieldIdByName(
      hostTableWithLookupCount.fields,
      'Lookup Owners Count'
    );

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostPrimaryFieldId]: 'host-1',
      [linkFieldId]: [{ id: sourceRecordA.id }, { id: sourceRecordB.id }],
    });

    await ctx.drainOutbox(3);

    const hostRecords = await ctx.listRecords(hostTable.id);
    const host = hostRecords.find((record) => record.id === hostRecord.id);
    expect(host).toBeDefined();
    if (!host) return;

    expect(Number(host.fields[peopleCountFieldId])).toBe(2);
    expect(Number(host.fields[lookupOwnersCountFieldId])).toBe(1);

    await ctx.updateRecord(hostTable.id, hostRecord.id, { [linkFieldId]: null });
    await ctx.drainOutbox(3);

    const clearedHostRecords = await ctx.listRecords(hostTable.id);
    const clearedHost = clearedHostRecords.find((record) => record.id === hostRecord.id);
    expect(clearedHost).toBeDefined();
    if (!clearedHost) return;

    expect(Number(clearedHost.fields[peopleCountFieldId] ?? 0)).toBe(0);
    expect(Number(clearedHost.fields[lookupOwnersCountFieldId] ?? 0)).toBe(0);
  });
});

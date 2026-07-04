/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: conditionalRollup v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('evaluates equality filter comparing link titles to host text', async () => {
    let tagsTableId: string | undefined;
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const tagsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-tags'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tagsTableId = tagsTable.id;
      const tagPrimaryId = tagsTable.fields.find((f) => f.isPrimary)?.id;
      if (!tagPrimaryId) throw new Error('Missing tags primary field');

      const tagAId = (await ctx.createRecord(tagsTable.id, { [tagPrimaryId]: 'TagA' })).id;
      const tagBId = (await ctx.createRecord(tagsTable.id, { [tagPrimaryId]: 'TagB' })).id;

      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-foreign'),
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Tags',
            options: {
              relationship: 'manyMany',
              foreignTableId: tagsTable.id,
              lookupFieldId: tagPrimaryId,
              isOneWay: true,
            },
          },
          { type: 'number', name: 'Amount' },
        ],
      });
      foreignTableId = foreignTable.id;
      const foreignTagsId = foreignTable.fields.find((f) => f.name === 'Tags')?.id;
      const foreignAmountId = foreignTable.fields.find((f) => f.name === 'Amount')?.id;
      if (!foreignTagsId || !foreignAmountId) throw new Error('Missing foreign fields');

      const foreignRecord1 = await ctx.createRecord(foreignTable.id, { Title: 'r1', Amount: 10 });
      const foreignRecord2 = await ctx.createRecord(foreignTable.id, { Title: 'r2', Amount: 20 });
      const foreignRecord3 = await ctx.createRecord(foreignTable.id, { Title: 'r3', Amount: 5 });

      await ctx.updateRecord(foreignTable.id, foreignRecord1.id, {
        [foreignTagsId]: [{ id: tagAId }],
      });
      await ctx.updateRecord(foreignTable.id, foreignRecord2.id, {
        [foreignTagsId]: [{ id: tagBId }],
      });
      await ctx.updateRecord(foreignTable.id, foreignRecord3.id, {
        [foreignTagsId]: [{ id: tagAId }, { id: tagBId }],
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-host'),
        fields: [{ type: 'singleLineText', name: 'TagName', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostTagNameId = hostTable.fields.find((f) => f.name === 'TagName')?.id;
      if (!hostTagNameId) throw new Error('Missing host text field');

      await ctx.createRecord(hostTable.id, { [hostTagNameId]: 'TagA' });
      await ctx.createRecord(hostTable.id, { [hostTagNameId]: 'TagB' });
      await ctx.createRecord(hostTable.id, { [hostTagNameId]: 'TagC' });

      const tableWithRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'conditionalRollup',
          name: 'Sum By Tag Title',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignAmountId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignTagsId,
                    operator: 'is',
                    value: hostTagNameId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });
      const rollupFieldId = tableWithRollup.fields.find((f) => f.name === 'Sum By Tag Title')?.id;
      if (!rollupFieldId) throw new Error('Missing conditional rollup field');

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id, { limit: 10, offset: 0 });
      const hostPrimaryId = hostTable.fields.find((f) => f.isPrimary)?.id;
      if (!hostPrimaryId) throw new Error('Missing host primary field');

      const byTagName = new Map(
        hostRecords.map((record) => [
          String(record.fields[hostPrimaryId] ?? ''),
          record.fields[rollupFieldId],
        ])
      );
      expect(byTagName.get('TagA')).toBe(15);
      expect(byTagName.get('TagB')).toBe(25);
      expect(byTagName.get('TagC')).toBe(0);
    } finally {
      if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
      if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      if (tagsTableId) await ctx.deleteTable(tagsTableId).catch(() => undefined);
    }
  });

  test('evaluates equality filter comparing lookup link titles to host text', async () => {
    let unitsTableId: string | undefined;
    let accountsTableId: string | undefined;
    let refundsTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const unitsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-units'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      unitsTableId = unitsTable.id;
      const unitNameId = unitsTable.fields.find((f) => f.isPrimary)?.id;
      if (!unitNameId) throw new Error('Missing unit primary field');

      const unitAId = (await ctx.createRecord(unitsTable.id, { [unitNameId]: 'UnitA' })).id;
      const unitBId = (await ctx.createRecord(unitsTable.id, { [unitNameId]: 'UnitB' })).id;

      const accountsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-accounts'),
        fields: [{ type: 'singleLineText', name: 'Account', isPrimary: true }],
      });
      accountsTableId = accountsTable.id;
      const accountNameId = accountsTable.fields.find((f) => f.isPrimary)?.id;
      if (!accountNameId) throw new Error('Missing account primary field');

      const accountsWithUnitLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: accountsTable.id,
        field: {
          type: 'link',
          name: 'Unit',
          options: {
            relationship: 'manyOne',
            foreignTableId: unitsTable.id,
            lookupFieldId: unitNameId,
            isOneWay: true,
          },
        },
      });
      const accountUnitLinkId = accountsWithUnitLink.fields.find((f) => f.name === 'Unit')?.id;
      if (!accountUnitLinkId) throw new Error('Missing account unit link field');

      const accountAId = (
        await ctx.createRecord(accountsTable.id, {
          [accountNameId]: 'AccountA',
          [accountUnitLinkId]: { id: unitAId },
        })
      ).id;
      const accountBId = (
        await ctx.createRecord(accountsTable.id, {
          [accountNameId]: 'AccountB',
          [accountUnitLinkId]: { id: unitBId },
        })
      ).id;

      const refundsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-refunds'),
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
      });
      refundsTableId = refundsTable.id;
      const refundAmountId = refundsTable.fields.find((f) => f.name === 'Amount')?.id;
      if (!refundAmountId) throw new Error('Missing refund amount field');

      const refundsWithAccountLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: refundsTable.id,
        field: {
          type: 'link',
          name: 'Account',
          options: {
            relationship: 'manyOne',
            foreignTableId: accountsTable.id,
            lookupFieldId: accountNameId,
            isOneWay: true,
          },
        },
      });
      const refundAccountLinkId = refundsWithAccountLink.fields.find(
        (f) => f.name === 'Account'
      )?.id;
      if (!refundAccountLinkId) throw new Error('Missing refund account link field');

      const refundsWithUnitLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: refundsTable.id,
        field: {
          type: 'lookup',
          name: 'Unit Lookup',
          options: {
            linkFieldId: refundAccountLinkId,
            foreignTableId: accountsTable.id,
            lookupFieldId: accountUnitLinkId,
          },
        },
      });
      const refundUnitLookupId = refundsWithUnitLookup.fields.find(
        (f) => f.name === 'Unit Lookup'
      )?.id;
      if (!refundUnitLookupId) throw new Error('Missing refund unit lookup field');

      await ctx.createRecord(refundsTable.id, {
        Title: 'r1',
        Amount: 10,
        [refundAccountLinkId]: { id: accountAId },
      });
      await ctx.createRecord(refundsTable.id, {
        Title: 'r2',
        Amount: 20,
        [refundAccountLinkId]: { id: accountBId },
      });
      await ctx.createRecord(refundsTable.id, {
        Title: 'r3',
        Amount: 5,
        [refundAccountLinkId]: { id: accountAId },
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-unit-host'),
        fields: [{ type: 'singleLineText', name: 'UnitName', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostUnitNameId = hostTable.fields.find((f) => f.name === 'UnitName')?.id;
      if (!hostUnitNameId) throw new Error('Missing host unit text field');

      await ctx.createRecord(hostTable.id, { [hostUnitNameId]: 'UnitA' });
      await ctx.createRecord(hostTable.id, { [hostUnitNameId]: 'UnitB' });
      await ctx.createRecord(hostTable.id, { [hostUnitNameId]: 'UnitC' });

      const tableWithRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'conditionalRollup',
          name: 'Sum By Lookup Unit',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: refundsTable.id,
            lookupFieldId: refundAmountId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: refundUnitLookupId,
                    operator: 'is',
                    value: hostUnitNameId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });
      const rollupFieldId = tableWithRollup.fields.find((f) => f.name === 'Sum By Lookup Unit')?.id;
      if (!rollupFieldId) throw new Error('Missing conditional rollup field');

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id, { limit: 10, offset: 0 });
      const byUnitName = new Map(
        hostRecords.map((record) => [
          String(record.fields[hostUnitNameId] ?? ''),
          record.fields[rollupFieldId],
        ])
      );
      expect(byUnitName.get('UnitA')).toBe(15);
      expect(byUnitName.get('UnitB')).toBe(20);
      expect(byUnitName.get('UnitC')).toBe(0);
    } finally {
      if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
      if (refundsTableId) await ctx.deleteTable(refundsTableId).catch(() => undefined);
      if (accountsTableId) await ctx.deleteTable(accountsTableId).catch(() => undefined);
      if (unitsTableId) await ctx.deleteTable(unitsTableId).catch(() => undefined);
    }
  });
});

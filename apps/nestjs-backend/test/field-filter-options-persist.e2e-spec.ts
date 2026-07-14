/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression suite for V2 convertField/createField persisting "More options"
 * style configuration (filter / sort / limit / filterByViewId / visibleFieldIds).
 *
 * T6179: linked rollup filter was silently dropped by V2 convert mapping.
 * This file covers sibling field types that carry similar config.
 */
import type { INestApplication } from '@nestjs/common';
import type {
  IConditionalLookupOptions,
  IConditionalRollupFieldOptions,
  IFilter,
  ILinkFieldOptions,
  ILookupOptionsRo,
} from '@teable/core';
import { FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

const statusFilter = (statusFieldId: string, value: string): IFilter =>
  ({
    conjunction: 'and',
    filterSet: [{ fieldId: statusFieldId, operator: 'is', value }],
  }) as IFilter;

describe('Field filter-style options persist on V2 convert/create (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let host: ITableFullVo;
  let foreign: ITableFullVo;
  let statusFieldId: string;
  let amountFieldId: string;
  let foreignPrimaryId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    foreign = await createTable(baseId, {
      name: 'FilterPersist_Foreign',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Status', type: FieldType.SingleLineText },
        {
          name: 'Amount',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
        },
      ],
      records: [
        { fields: { Name: 'A', Status: 'todo', Amount: 10 } },
        { fields: { Name: 'B', Status: 'done', Amount: 20 } },
        { fields: { Name: 'C', Status: 'todo', Amount: 30 } },
      ],
    });
    foreignPrimaryId = foreign.fields.find((f) => f.name === 'Name')!.id;
    statusFieldId = foreign.fields.find((f) => f.name === 'Status')!.id;
    amountFieldId = foreign.fields.find((f) => f.name === 'Amount')!.id;

    host = await createTable(baseId, {
      name: 'FilterPersist_Host',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'Host-1' } }, { fields: { Title: 'Host-2' } }],
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, host.id);
    await permanentDeleteTable(baseId, foreign.id);
    await app.close();
  });

  async function setLink(linkFieldId: string, foreignRecordIds: string[]) {
    await updateRecord(host.id, host.records[0].id, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [linkFieldId]: foreignRecordIds.map((id) => ({ id })),
        },
      },
    });
  }

  describe('regular lookup', () => {
    it('should persist filter on create and convertField (T6179 siblings)', async () => {
      const linkField = await createField(host.id, {
        name: 'LookupLink',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: foreign.id,
        },
      });

      const filter = statusFilter(statusFieldId, 'todo');

      // create with filter
      const created = await createField(host.id, {
        name: 'LookupWithFilter',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          linkFieldId: linkField.id,
          lookupFieldId: foreignPrimaryId,
          filter,
        } as ILookupOptionsRo,
      });

      expect((created.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(filter);
      const createdReloaded = await getField(host.id, created.id);
      expect((createdReloaded.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(
        filter
      );

      // create without filter, then convert to add filter
      const bare = await createField(host.id, {
        name: 'LookupBareThenFilter',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          linkFieldId: linkField.id,
          lookupFieldId: foreignPrimaryId,
        } as ILookupOptionsRo,
      });

      const converted = await convertField(host.id, bare.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          linkFieldId: linkField.id,
          lookupFieldId: foreignPrimaryId,
          filter,
        } as ILookupOptionsRo,
      });

      expect((converted.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(filter);
      const reloaded = await getField(host.id, bare.id);
      expect((reloaded.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(filter);

      await setLink(linkField.id, [foreign.records[0].id, foreign.records[1].id]);
      const record = await getRecord(host.id, host.records[0].id);
      // Only Status=todo (A) should be looked up from linked A+B
      expect(record.fields[bare.id]).toEqual(['A']);
    });
  });

  describe('link field', () => {
    it('should persist filter, filterByViewId and visibleFieldIds on convertField', async () => {
      const linkField = await createField(host.id, {
        name: 'LinkBare',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
        },
      });

      const filter = statusFilter(statusFieldId, 'done');
      const converted = await convertField(host.id, linkField.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
          filterByViewId: foreign.defaultViewId,
          visibleFieldIds: [foreignPrimaryId, statusFieldId],
          filter,
        },
      });

      const opts = converted.options as ILinkFieldOptions;
      expect(opts.filter).toEqual(filter);
      expect(opts.filterByViewId).toBe(foreign.defaultViewId);
      expect(opts.visibleFieldIds).toEqual([foreignPrimaryId, statusFieldId]);

      const reloaded = await getField(host.id, linkField.id);
      const reloadedOpts = reloaded.options as ILinkFieldOptions;
      expect(reloadedOpts.filter).toEqual(filter);
      expect(reloadedOpts.filterByViewId).toBe(foreign.defaultViewId);
      expect(reloadedOpts.visibleFieldIds).toEqual([foreignPrimaryId, statusFieldId]);
    });

    it('should persist filter on createField', async () => {
      const filter = statusFilter(statusFieldId, 'todo');
      const created = await createField(host.id, {
        name: 'LinkWithFilterCreate',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
          filter,
        },
      });

      expect((created.options as ILinkFieldOptions).filter).toEqual(filter);
      const reloaded = await getField(host.id, created.id);
      expect((reloaded.options as ILinkFieldOptions).filter).toEqual(filter);
    });
  });

  describe('conditional lookup', () => {
    it('should persist filter/sort/limit on create and convertField', async () => {
      const filter = statusFilter(statusFieldId, 'todo');
      const sort = { fieldId: amountFieldId, order: 'desc' as const };
      const limit = 2;

      const created = await createField(host.id, {
        name: 'CondLookupCreate',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
          filter,
          sort,
          limit,
        } as IConditionalLookupOptions,
      });

      const createdOpts = created.lookupOptions as IConditionalLookupOptions;
      expect(createdOpts.filter).toEqual(filter);
      expect(createdOpts.sort).toEqual(sort);
      expect(createdOpts.limit).toBe(limit);

      const bare = await createField(host.id, {
        name: 'CondLookupBare',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
          filter: statusFilter(statusFieldId, 'done'),
        } as IConditionalLookupOptions,
      });

      const converted = await convertField(host.id, bare.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignPrimaryId,
          filter,
          sort,
          limit,
        } as IConditionalLookupOptions,
      });

      const convertedOpts = converted.lookupOptions as IConditionalLookupOptions;
      expect(convertedOpts.filter).toEqual(filter);
      expect(convertedOpts.sort).toEqual(sort);
      expect(convertedOpts.limit).toBe(limit);

      const reloaded = await getField(host.id, bare.id);
      const reloadedOpts = reloaded.lookupOptions as IConditionalLookupOptions;
      expect(reloadedOpts.filter).toEqual(filter);
      expect(reloadedOpts.sort).toEqual(sort);
      expect(reloadedOpts.limit).toBe(limit);
    });
  });

  describe('conditional rollup', () => {
    it('should persist filter on create and convertField', async () => {
      const filter = statusFilter(statusFieldId, 'todo');

      const created = await createField(host.id, {
        name: 'CondRollupCreate',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountFieldId,
          expression: 'sum({values})',
          filter,
        } as IConditionalRollupFieldOptions,
      });

      expect((created.options as IConditionalRollupFieldOptions).filter).toEqual(filter);
      const createdReloaded = await getField(host.id, created.id);
      expect((createdReloaded.options as IConditionalRollupFieldOptions).filter).toEqual(filter);

      // create with a different filter, then convert to the target filter
      const bare = await createField(host.id, {
        name: 'CondRollupBare',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountFieldId,
          expression: 'sum({values})',
          filter: statusFilter(statusFieldId, 'done'),
        } as IConditionalRollupFieldOptions,
      });

      const converted = await convertField(host.id, bare.id, {
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountFieldId,
          expression: 'sum({values})',
          filter,
        } as IConditionalRollupFieldOptions,
      });

      expect((converted.options as IConditionalRollupFieldOptions).filter).toEqual(filter);
      const reloaded = await getField(host.id, bare.id);
      expect((reloaded.options as IConditionalRollupFieldOptions).filter).toEqual(filter);

      // todo amounts: 10 + 30 = 40 (no host field ref — constant filter on all foreign rows)
      const record = await getRecord(host.id, host.records[0].id);
      expect(record.fields[bare.id]).toEqual(40);
    });
  });

  describe('regular rollup (T6179)', () => {
    it('should persist filter on createField as well as convertField', async () => {
      const linkField = await createField(host.id, {
        name: 'RollupLink',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: foreign.id,
        },
      });

      const filter = statusFilter(statusFieldId, 'todo');

      const created = await createField(host.id, {
        name: 'RollupWithFilterCreate',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
          formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        },
        lookupOptions: {
          foreignTableId: foreign.id,
          linkFieldId: linkField.id,
          lookupFieldId: amountFieldId,
          filter,
        } as ILookupOptionsRo,
      });

      expect((created.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(filter);
      const reloaded = await getField(host.id, created.id);
      expect((reloaded.lookupOptions as ILookupOptionsRo | undefined)?.filter).toEqual(filter);

      await setLink(linkField.id, [
        foreign.records[0].id,
        foreign.records[1].id,
        foreign.records[2].id,
      ]);
      const record = await getRecord(host.id, host.records[0].id);
      // Linked A+B+C but filter Status=todo → 10+30 = 40
      expect(record.fields[created.id]).toEqual(40);
    });
  });
});

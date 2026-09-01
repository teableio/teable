/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V1-parity coverage for plain lookup field behaviors (T6520).
 * Ports the portable cases from apps/nestjs-backend/test/lookup.e2e-spec.ts:
 * - "general lookup" looked-up field type matrix (text / number / singleSelect /
 *   multipleSelect / date) in both multi-value (host with many links) and
 *   single-value (manyOne link) directions
 * - "lookup filter" cases: create with filter, filter reacting to source value
 *   changes, filter reacting to link add/remove, filter on a select field
 * - lookup with sort and limit options (v2 lookup options support)
 * - lookup value seeding when the field is created after links exist
 * - many-many self-link lookup updated via the symmetric link field
 * - system field lookup propagation (autoNumber / createdTime /
 *   lastModifiedTime / createdBy / lastModifiedBy) incl. nested lookups
 * - multi-layer conditional lookup chains over lookup / rollup sources
 *
 * Link add/remove/replace propagation without filters is covered by
 * computed.e2e.spec.ts (lookup field updates / link relationship types).
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 lookup field behaviors (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(10, '0');
    fieldIdCounter += 1;
    return `fld${runId}${suffix}`;
  };

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('lookup of each looked-up field type', () => {
    // v1: lookup.e2e-spec.ts "should update lookupField by edit the a looked up <type> field"
    let foreignTableId: string;
    let multiHostTableId: string;
    let singleHostTableId: string;
    let foreignRecordId: string;
    let multiHostRecordId: string;

    const foreignPrimaryFieldId = createFieldId();
    const foreignTextFieldId = createFieldId();
    const foreignNumberFieldId = createFieldId();
    const foreignSingleSelectFieldId = createFieldId();
    const foreignMultipleSelectFieldId = createFieldId();
    const foreignDateFieldId = createFieldId();
    const multiHostPrimaryFieldId = createFieldId();
    const multiHostLinkFieldId = createFieldId();
    const singleHostPrimaryFieldId = createFieldId();
    const singleHostLinkFieldId = createFieldId();

    const nowIso = new Date().toISOString();

    const typeCases: Array<{
      label: string;
      foreignFieldId: string;
      updateValue: unknown;
      multiExpected: unknown;
      singleExpected: unknown;
      multiLookupFieldId: string;
      singleLookupFieldId: string;
    }> = [
      {
        label: 'singleLineText',
        foreignFieldId: foreignTextFieldId,
        updateValue: 'lookup text',
        multiExpected: ['lookup text'],
        singleExpected: 'lookup text',
        multiLookupFieldId: createFieldId(),
        singleLookupFieldId: createFieldId(),
      },
      {
        label: 'number',
        foreignFieldId: foreignNumberFieldId,
        updateValue: 123,
        multiExpected: [123],
        singleExpected: 123,
        multiLookupFieldId: createFieldId(),
        singleLookupFieldId: createFieldId(),
      },
      {
        label: 'singleSelect',
        foreignFieldId: foreignSingleSelectFieldId,
        updateValue: 'todo',
        multiExpected: ['todo'],
        singleExpected: 'todo',
        multiLookupFieldId: createFieldId(),
        singleLookupFieldId: createFieldId(),
      },
      {
        label: 'multipleSelect',
        foreignFieldId: foreignMultipleSelectFieldId,
        updateValue: ['rap'],
        multiExpected: ['rap'],
        singleExpected: ['rap'],
        multiLookupFieldId: createFieldId(),
        singleLookupFieldId: createFieldId(),
      },
      {
        label: 'date',
        foreignFieldId: foreignDateFieldId,
        updateValue: nowIso,
        multiExpected: [nowIso],
        singleExpected: nowIso,
        multiLookupFieldId: createFieldId(),
        singleLookupFieldId: createFieldId(),
      },
    ];

    beforeAll(async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupTypes Foreign',
        fields: [
          { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: foreignTextFieldId, name: 'Text' },
          { type: 'number', id: foreignNumberFieldId, name: 'Num' },
          {
            type: 'singleSelect',
            id: foreignSingleSelectFieldId,
            name: 'Single',
            options: {
              choices: [
                { id: 'choTodo', name: 'todo', color: 'blue' },
                { id: 'choDoing', name: 'doing', color: 'green' },
                { id: 'choDone', name: 'done', color: 'red' },
              ],
            },
          },
          {
            type: 'multipleSelect',
            id: foreignMultipleSelectFieldId,
            name: 'Multi',
            options: {
              choices: [
                { id: 'choRap', name: 'rap', color: 'blue' },
                { id: 'choRock', name: 'rock', color: 'green' },
                { id: 'choJazz', name: 'jazz', color: 'red' },
              ],
            },
          },
          { type: 'date', id: foreignDateFieldId, name: 'When' },
        ],
      });
      foreignTableId = foreign.id;

      const foreignRecord = await ctx.createRecord(foreign.id, {
        [foreignPrimaryFieldId]: 'F1',
      });
      foreignRecordId = foreignRecord.id;

      const multiHost = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupTypes MultiHost',
        fields: [
          { type: 'singleLineText', id: multiHostPrimaryFieldId, name: 'Name', isPrimary: true },
        ],
      });
      multiHostTableId = multiHost.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: multiHost.id,
        field: {
          type: 'link',
          id: multiHostLinkFieldId,
          name: 'Links',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });

      const singleHost = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'LookupTypes SingleHost',
        fields: [
          { type: 'singleLineText', id: singleHostPrimaryFieldId, name: 'Name', isPrimary: true },
        ],
      });
      singleHostTableId = singleHost.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: singleHost.id,
        field: {
          type: 'link',
          id: singleHostLinkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });

      for (const typeCase of typeCases) {
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: multiHost.id,
          field: {
            type: 'lookup',
            id: typeCase.multiLookupFieldId,
            name: `lookup ${typeCase.label} [multi]`,
            options: {
              foreignTableId: foreign.id,
              linkFieldId: multiHostLinkFieldId,
              lookupFieldId: typeCase.foreignFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: singleHost.id,
          field: {
            type: 'lookup',
            id: typeCase.singleLookupFieldId,
            name: `lookup ${typeCase.label} [single]`,
            options: {
              foreignTableId: foreign.id,
              linkFieldId: singleHostLinkFieldId,
              lookupFieldId: typeCase.foreignFieldId,
            },
          },
        });
      }

      const multiHostRecord = await ctx.createRecord(multiHost.id, {
        [multiHostPrimaryFieldId]: 'MH1',
        [multiHostLinkFieldId]: [{ id: foreignRecord.id }],
      });
      multiHostRecordId = multiHostRecord.id;

      await ctx.createRecord(singleHost.id, {
        [singleHostPrimaryFieldId]: 'SH1',
        [singleHostLinkFieldId]: { id: foreignRecord.id },
      });

      await drainOutbox();
    });

    afterAll(async () => {
      if (multiHostTableId) await ctx.deleteTable(multiHostTableId).catch(() => undefined);
      if (singleHostTableId) await ctx.deleteTable(singleHostTableId).catch(() => undefined);
      if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
    });

    it.each(typeCases)(
      'updates lookup field when editing a looked up $label field',
      async ({ foreignFieldId, updateValue, multiExpected, multiLookupFieldId }) => {
        await ctx.updateRecord(foreignTableId, foreignRecordId, {
          [foreignFieldId]: updateValue,
        });
        await drainOutbox();

        const multiRecords = await ctx.listRecords(multiHostTableId);
        const multiRecord = multiRecords.find((r) => r.id === multiHostRecordId);
        expect(multiRecord?.fields[multiLookupFieldId]).toEqual(multiExpected);
      }
    );

    it.each(typeCases)(
      'returns a uniform array shape for manyOne lookups of $label fields',
      async ({ foreignFieldId, updateValue, multiExpected, singleLookupFieldId }) => {
        await ctx.updateRecord(foreignTableId, foreignRecordId, {
          [foreignFieldId]: updateValue,
        });
        await drainOutbox();

        const singleRecords = await ctx.listRecords(singleHostTableId);
        const singleRecord = singleRecords.find(
          (r) => r.fields[singleHostPrimaryFieldId] === 'SH1'
        );
        const value = singleRecord?.fields[singleLookupFieldId];
        // v2 contract: lookup values are arrays regardless of link multiplicity
        expect(value).toEqual(multiExpected);
      }
    );

    // Intentional divergence from v1 (T6520, decided 2026-08-01): v1 returns
    // single-value (manyOne) lookups as scalars, mirroring the link cell's
    // multiplicity. The v2 engine keeps a uniform array shape for every lookup
    // regardless of relationship — the value type does not change when a link
    // is converted between single and multi. v1-facing scalar presentation
    // belongs to the v1 compat boundary (as done for link cell shapes in
    // T6510), not the engine. The kept implementation below documents what a
    // v1-shape assertion would look like at the boundary layer.
    /*
    it.each(typeCases)(
      'returns scalar lookup value for looked up $label field via manyOne link',
      async ({ foreignFieldId, updateValue, singleExpected, singleLookupFieldId }) => {
        await ctx.updateRecord(foreignTableId, foreignRecordId, {
          [foreignFieldId]: updateValue,
        });
        await drainOutbox();

        const singleRecords = await ctx.listRecords(singleHostTableId);
        const singleRecord = singleRecords[0];
        // v1: (await expectLookup(table2, FieldType.SingleLineText, 'lookup text')).toEqual('lookup text');
        expect(singleRecord?.fields[singleLookupFieldId]).toEqual(singleExpected);
      }
    );
    */
  });

  describe('lookup filter', () => {
    // v1: lookup.e2e-spec.ts "should create a lookup field with filter" + "should update a lookup field with filter"
    it('creates a lookup field with filter and recomputes when source values change', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilter Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        foreignTableId = foreign.id;

        const b1 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B1' });
        const b2 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B2' });
        const b3 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B3' });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilter Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'H1',
          [hostLinkFieldId]: [{ id: b1.id }, { id: b2.id }, { id: b3.id }],
        });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Filtered Names',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignPrimaryFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignPrimaryFieldId, operator: 'isNot', value: 'B1' }],
              },
            },
          },
        });
        await drainOutbox();

        let records = await ctx.listRecords(host.id);
        let record = records.find((r) => r.id === hostRecord.id);
        expect([...((record?.fields[lookupFieldId] as string[]) ?? [])].sort()).toEqual([
          'B2',
          'B3',
        ]);

        // Rename all source values; the isNot 'B1' filter no longer excludes anything.
        await ctx.updateRecord(foreign.id, b1.id, { [foreignPrimaryFieldId]: 'BB1' });
        await ctx.updateRecord(foreign.id, b2.id, { [foreignPrimaryFieldId]: 'BB2' });
        await ctx.updateRecord(foreign.id, b3.id, { [foreignPrimaryFieldId]: 'BB3' });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect([...((record?.fields[lookupFieldId] as string[]) ?? [])].sort()).toEqual([
          'BB1',
          'BB2',
          'BB3',
        ]);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: lookup.e2e-spec.ts "should update a lookup field with filter when add or remove records link"
    it('updates a lookup field with filter when links are added or removed', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilterLinks Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        foreignTableId = foreign.id;

        const b1 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B1' });
        const b2 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B2' });
        const b3 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'B3' });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilterLinks Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Filtered Names',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignPrimaryFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignPrimaryFieldId, operator: 'isNot', value: 'B1' }],
              },
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'H1',
          [hostLinkFieldId]: [{ id: b2.id }, { id: b3.id }],
        });
        await drainOutbox();

        let records = await ctx.listRecords(host.id);
        let record = records.find((r) => r.id === hostRecord.id);
        expect([...((record?.fields[lookupFieldId] as string[]) ?? [])].sort()).toEqual([
          'B2',
          'B3',
        ]);

        // Adding the filtered-out record must not change the lookup value.
        await ctx.updateRecord(host.id, hostRecord.id, {
          [hostLinkFieldId]: [{ id: b1.id }, { id: b2.id }, { id: b3.id }],
        });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect([...((record?.fields[lookupFieldId] as string[]) ?? [])].sort()).toEqual([
          'B2',
          'B3',
        ]);

        // Only the filtered-out record linked -> lookup is empty.
        await ctx.updateRecord(host.id, hostRecord.id, {
          [hostLinkFieldId]: [{ id: b1.id }],
        });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[lookupFieldId] ?? null).toBeNull();

        // No links at all -> lookup stays empty.
        await ctx.updateRecord(host.id, hostRecord.id, { [hostLinkFieldId]: null });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[lookupFieldId] ?? null).toBeNull();
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: lookup.e2e-spec.ts "should update a lookup field with fiter when update statusField in filterSet"
    it('recomputes lookup with filter when the filtered select field changes', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilterStatus Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: foreignStatusFieldId,
              name: 'Status',
              options: {
                choices: [
                  { id: 'choX', name: 'x', color: 'cyan' },
                  { id: 'choY', name: 'y', color: 'blue' },
                ],
              },
            },
          ],
        });
        foreignTableId = foreign.id;

        const a1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'A1',
          [foreignStatusFieldId]: 'x',
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupFilterStatus Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Active Names',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignPrimaryFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignStatusFieldId, operator: 'is', value: 'x' }],
              },
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'H1',
          [hostLinkFieldId]: [{ id: a1.id }],
        });
        await drainOutbox();

        let records = await ctx.listRecords(host.id);
        let record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[lookupFieldId]).toEqual(['A1']);

        await ctx.updateRecord(foreign.id, a1.id, { [foreignStatusFieldId]: 'y' });
        await drainOutbox();

        records = await ctx.listRecords(host.id);
        record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[lookupFieldId] ?? null).toBeNull();
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });
  });

  describe('lookup sort and limit', () => {
    // Regression (T6520): lookupOptionsSchema accepts sort/limit on plain
    // lookup fields; the generic lateral now applies them (ORDER BY + LIMIT in
    // the aggregation subquery). No v1 counterpart — plain lookups there have
    // no sort/limit at all.
    it('applies sort and limit options to lookup values', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();
      const tiedLookupFieldId = createFieldId();
      const limitOnlyLookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSort Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            { type: 'number', id: foreignNumberFieldId, name: 'Num' },
          ],
        });
        foreignTableId = foreign.id;

        const r1 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R1',
          [foreignNumberFieldId]: 3,
        });
        const r2 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R2',
          [foreignNumberFieldId]: 1,
        });
        const r3 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R3',
          [foreignNumberFieldId]: 2,
        });
        const r4 = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'R4',
          [foreignNumberFieldId]: 3,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSort Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Top Nums',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
              sort: { fieldId: foreignNumberFieldId, order: 'desc' },
              limit: 2,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: tiedLookupFieldId,
            name: 'Top Names',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignPrimaryFieldId,
              sort: { fieldId: foreignNumberFieldId, order: 'desc' },
              limit: 2,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: limitOnlyLookupFieldId,
            name: 'First Nums',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
              limit: 2,
            },
          },
        });

        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'H1',
          [hostLinkFieldId]: [{ id: r1.id }, { id: r2.id }, { id: r3.id }, { id: r4.id }],
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const record = records.find((r) => r.id === hostRecord.id);
        expect(record?.fields[lookupFieldId]).toEqual([3, 3]);
        expect(record?.fields[tiedLookupFieldId]).toEqual(['R1', 'R4']);
        expect(record?.fields[limitOnlyLookupFieldId]).toEqual([3, 1]);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });
  });

  describe('lookup field creation and self links', () => {
    // v1: lookup.e2e-spec.ts "should calculate when add a lookup field"
    it('seeds lookup values when the lookup field is created after links exist', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSeed Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        foreignTableId = foreign.id;

        const f1 = await ctx.createRecord(foreign.id, { [foreignPrimaryFieldId]: 'A2' });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSeed Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        // establish links before the lookup field exists
        const linked = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Linked',
          [hostLinkFieldId]: [{ id: f1.id }],
        });
        const unlinked = await ctx.createRecord(host.id, { [hostPrimaryFieldId]: 'Unlinked' });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Seeded Names',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignPrimaryFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        expect(records.find((r) => r.id === linked.id)?.fields[lookupFieldId]).toEqual(['A2']);
        expect(records.find((r) => r.id === unlinked.id)?.fields[lookupFieldId] ?? null).toBeNull();
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    it('seeds a oneOne date lookup into a timestamptz column after links exist', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignDateFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();
      const closeAt = '2026-01-15T00:00:00.000Z';

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DateLookupSeed Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'date',
              id: foreignDateFieldId,
              name: 'Close Date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              },
            },
          ],
        });
        foreignTableId = foreign.id;

        const opportunity = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Opp 1',
          [foreignDateFieldId]: closeAt,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DateLookupSeed Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Linked Opportunity',
            options: {
              relationship: 'oneOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          },
        });

        const linked = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Submission 1',
          [hostLinkFieldId]: { id: opportunity.id },
        });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Close Date Lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignDateFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === linked.id)?.fields[lookupFieldId];
        expect(lookupValue === closeAt || lookupValue?.[0] === closeAt).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    it('seeds a oneOne lookup-of-link into a jsonb column after links exist', async () => {
      const relatedPrimaryFieldId = createFieldId();
      const foreignPrimaryFieldId = createFieldId();
      const foreignLinkFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let relatedTableId: string | undefined;
      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const related = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LinkLookupSeed Related',
          fields: [
            { type: 'singleLineText', id: relatedPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        relatedTableId = related.id;
        const relatedRecord = await ctx.createRecord(related.id, {
          [relatedPrimaryFieldId]: 'Related A',
        });

        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LinkLookupSeed Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        foreignTableId = foreign.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: foreign.id,
          field: {
            type: 'link',
            id: foreignLinkFieldId,
            name: 'Related',
            options: {
              relationship: 'manyMany',
              foreignTableId: related.id,
              lookupFieldId: relatedPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        const opportunity = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Opp 1',
          [foreignLinkFieldId]: [{ id: relatedRecord.id }],
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LinkLookupSeed Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Linked Opportunity',
            options: {
              relationship: 'oneOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        const linked = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Submission 1',
          [hostLinkFieldId]: { id: opportunity.id },
        });
        await drainOutbox();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Related Lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignLinkFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === linked.id)?.fields[lookupFieldId];
        const values = Array.isArray(lookupValue) ? lookupValue : [lookupValue];
        const titles = values.flatMap((value) => {
          if (value && typeof value === 'object' && 'title' in value) {
            const title = value.title;
            return typeof title === 'string' ? [title] : [];
          }
          return typeof value === 'string' ? [value] : [];
        });
        expect(titles).toContain('Related A');
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
        if (relatedTableId) await ctx.deleteTable(relatedTableId).catch(() => undefined);
      }
    });

    it('converts a date field to a oneOne date lookup without timestamptz/text mismatch', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignDateFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostDateFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const closeAt = '2026-01-15T00:00:00.000Z';

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DateLookupConvert Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'date',
              id: foreignDateFieldId,
              name: 'Close Date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
              },
            },
          ],
        });
        foreignTableId = foreign.id;

        const opportunity = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Opp 1',
          [foreignDateFieldId]: closeAt,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DateLookupConvert Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'date',
              id: hostDateFieldId,
              name: 'Close Date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
              },
            },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Linked Opportunity',
            options: {
              relationship: 'oneOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          },
        });

        const linked = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Submission 1',
          [hostDateFieldId]: closeAt,
          [hostLinkFieldId]: { id: opportunity.id },
        });
        await drainOutbox();

        await ctx.updateField({
          tableId: host.id,
          fieldId: hostDateFieldId,
          field: {
            type: 'lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignDateFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === linked.id)?.fields[hostDateFieldId];
        expect(lookupValue === closeAt || lookupValue?.[0] === closeAt).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    it('converts a number field to a manyOne formula lookup without text/double mismatch', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostAmountFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'NumberLookupConvert Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'formula',
              id: foreignAmountFieldId,
              name: 'Amount',
              options: {
                expression: '12.5',
                formatting: { type: 'currency', precision: 2, symbol: '' },
              },
            },
          ],
        });
        foreignTableId = foreign.id;

        const contract = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Contract 1',
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'NumberLookupConvert Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: hostAmountFieldId,
              name: 'Payment Amount',
              options: { formatting: { type: 'currency', precision: 2, symbol: '' } },
            },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Contract',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          },
        });

        const payment = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Payment 1',
          [hostAmountFieldId]: 1,
          [hostLinkFieldId]: { id: contract.id },
        });
        await drainOutbox();

        await ctx.updateField({
          tableId: host.id,
          fieldId: hostAmountFieldId,
          field: {
            type: 'lookup',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignAmountFieldId,
            },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === payment.id)?.fields[hostAmountFieldId];
        expect(lookupValue === 12.5 || lookupValue?.[0] === 12.5).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // T6824 / BACKEND-CN-15E: display-only convert of an existing manyOne number
    // lookup rebuilds a pending lookup and must recast REAL backfill instead of
    // assigning text into double precision.
    it('rebuilds an existing manyOne number lookup without text/double mismatch', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'NumberLookupRebuild Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: foreignNumberFieldId,
              name: 'Source Number',
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
        });
        foreignTableId = foreign.id;

        const product = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Product 1',
          [foreignNumberFieldId]: 42,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'NumberLookupRebuild Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Product',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'Looked Up Number',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
            },
            innerOptions: { formatting: { type: 'decimal', precision: 2 } },
          },
        });

        const stock = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Stock 1',
          [hostLinkFieldId]: { id: product.id },
        });
        await drainOutbox();

        await ctx.updateField({
          tableId: host.id,
          fieldId: hostLookupFieldId,
          field: {
            type: 'lookup',
            updateMode: 'full',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
            },
            innerOptions: { formatting: { type: 'decimal', precision: 1 } },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === stock.id)?.fields[hostLookupFieldId];
        expect(lookupValue === 42 || lookupValue?.[0] === 42).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // T6805 / BACKEND-AI-1F6: production number lookup already had stale TEXT
    // metadata while the physical column stayed double precision. Display-only
    // convert rebuilds a pending lookup and must derive REAL instead of
    // assigning text into that column.
    it('rebuilds a manyOne number lookup with stale TEXT metadata without text/double mismatch', async () => {
      const foreignPrimaryFieldId = createFieldId();
      const foreignNumberFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      let foreignTableId: string | undefined;
      let hostTableId: string | undefined;

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'StaleTextLookup Foreign',
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'number',
              id: foreignNumberFieldId,
              name: 'Source Number',
              options: { formatting: { type: 'currency', precision: 2, symbol: '' } },
            },
          ],
        });
        foreignTableId = foreign.id;

        const contract = await ctx.createRecord(foreign.id, {
          [foreignPrimaryFieldId]: 'Contract 1',
          [foreignNumberFieldId]: 12.5,
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'StaleTextLookup Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Contract',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'Looked Up Number',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
            },
            innerOptions: { formatting: { type: 'currency', precision: 2, symbol: '' } },
          },
        });

        const payment = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'Payment 1',
          [hostLinkFieldId]: { id: contract.id },
        });
        await drainOutbox();

        await sql`
          UPDATE "field"
          SET "db_field_type" = 'TEXT',
              "cell_value_type" = 'string'
          WHERE "id" = ${hostLookupFieldId}
        `.execute(ctx.testContainer.db);

        const staleStorage = await ctx.testContainer.db
          .selectFrom('field')
          .select(['db_field_type', 'cell_value_type'])
          .where('id', '=', hostLookupFieldId)
          .executeTakeFirstOrThrow();
        expect(staleStorage.db_field_type).toBe('TEXT');
        expect(staleStorage.cell_value_type).toBe('string');

        await ctx.updateField({
          tableId: host.id,
          fieldId: hostLookupFieldId,
          field: {
            type: 'lookup',
            updateMode: 'full',
            options: {
              foreignTableId: foreign.id,
              linkFieldId: hostLinkFieldId,
              lookupFieldId: foreignNumberFieldId,
            },
            innerOptions: { formatting: { type: 'currency', precision: 1, symbol: '' } },
          },
        });
        await drainOutbox();

        const records = await ctx.listRecords(host.id);
        const lookupValue = records.find((r) => r.id === payment.id)?.fields[hostLookupFieldId];
        expect(lookupValue === 12.5 || lookupValue?.[0] === 12.5).toBe(true);
      } finally {
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
      }
    });

    // v1: lookup.e2e-spec.ts "should update a many-many self-link lookup field"
    it('updates a many-many self-link lookup field via the symmetric link', async () => {
      const primaryFieldId = createFieldId();
      const linkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      let tableId: string | undefined;

      try {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'LookupSelfLink Table',
          fields: [{ type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true }],
        });
        tableId = table.id;

        // twoWay self manyMany link so we can write through the symmetric side
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'link',
            id: linkFieldId,
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId: table.id,
              lookupFieldId: primaryFieldId,
            },
          },
        });

        const tableMeta = await ctx.getTableById(table.id);
        const symmetricField = tableMeta.fields.find(
          (field) =>
            field.type === 'link' &&
            (field.options as { symmetricFieldId?: string } | undefined)?.symmetricFieldId ===
              linkFieldId
        );
        expect(symmetricField).toBeDefined();
        const symmetricFieldId = symmetricField!.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Linked Names',
            options: {
              foreignTableId: table.id,
              linkFieldId,
              lookupFieldId: primaryFieldId,
            },
          },
        });

        const r0 = await ctx.createRecord(table.id, { [primaryFieldId]: 'B1' });
        const r1 = await ctx.createRecord(table.id, { [primaryFieldId]: 'B2' });
        await drainOutbox();

        // writing through the symmetric side accumulates links on r0
        await ctx.updateRecord(table.id, r0.id, { [symmetricFieldId]: [{ id: r0.id }] });
        await ctx.updateRecord(table.id, r1.id, { [symmetricFieldId]: [{ id: r0.id }] });
        await drainOutbox();

        const records = await ctx.listRecords(table.id);
        const record = records.find((r) => r.id === r0.id);
        expect([...((record?.fields[lookupFieldId] as string[]) ?? [])].sort()).toEqual([
          'B1',
          'B2',
        ]);
      } finally {
        if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
      }
    });
  });

  describe('system field lookup propagation', () => {
    // v1: lookup.e2e-spec.ts "should resolve lookup values for system fields"
    //   + "should resolve nested lookup values for system fields"
    //   + created-by lookup presence (essence of "should return created-by lookup
    //     value in updateRecords response"; the v1 response-shape / raw dbFieldName
    //     projection assertions are v1-API specific)
    it('resolves lookup and nested lookup values for system fields', async () => {
      const normalize = (value: unknown): unknown[] => {
        if (value === undefined || value === null) return [];
        const flattened: unknown[] = [];
        const collect = (item: unknown) => {
          if (Array.isArray(item)) {
            item.forEach(collect);
          } else {
            flattened.push(item);
          }
        };
        collect(value);
        return flattened;
      };

      const sourcePrimaryFieldId = createFieldId();
      const sourceAutoNumberFieldId = createFieldId();
      const sourceCreatedTimeFieldId = createFieldId();
      const sourceLastModifiedTimeFieldId = createFieldId();
      const sourceCreatedByFieldId = createFieldId();
      const sourceLastModifiedByFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const consumerPrimaryFieldId = createFieldId();
      const consumerLinkFieldId = createFieldId();

      const systemFieldSpecs = [
        { key: 'autoNumber', type: 'autoNumber', sourceFieldId: sourceAutoNumberFieldId },
        { key: 'createdTime', type: 'createdTime', sourceFieldId: sourceCreatedTimeFieldId },
        {
          key: 'lastModifiedTime',
          type: 'lastModifiedTime',
          sourceFieldId: sourceLastModifiedTimeFieldId,
        },
        { key: 'createdBy', type: 'createdBy', sourceFieldId: sourceCreatedByFieldId },
        {
          key: 'lastModifiedBy',
          type: 'lastModifiedBy',
          sourceFieldId: sourceLastModifiedByFieldId,
        },
      ].map((spec) => ({
        ...spec,
        hostLookupFieldId: createFieldId(),
        consumerLookupFieldId: createFieldId(),
      }));

      let sourceTableId: string | undefined;
      let hostTableId: string | undefined;
      let consumerTableId: string | undefined;

      try {
        const source = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SystemLookup Source',
          fields: [
            { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Title', isPrimary: true },
            { type: 'autoNumber', id: sourceAutoNumberFieldId, name: 'Auto Number Field' },
            { type: 'createdTime', id: sourceCreatedTimeFieldId, name: 'Created Time Field' },
            {
              type: 'lastModifiedTime',
              id: sourceLastModifiedTimeFieldId,
              name: 'Last Modified Time Field',
            },
            { type: 'createdBy', id: sourceCreatedByFieldId, name: 'Created By Field' },
            {
              type: 'lastModifiedBy',
              id: sourceLastModifiedByFieldId,
              name: 'Last Modified By Field',
            },
          ],
        });
        sourceTableId = source.id;

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SystemLookup Host',
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Host Title', isPrimary: true },
          ],
        });
        hostTableId = host.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Link To Source',
            options: {
              relationship: 'manyMany',
              foreignTableId: source.id,
              lookupFieldId: sourcePrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        for (const spec of systemFieldSpecs) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: host.id,
            field: {
              type: 'lookup',
              id: spec.hostLookupFieldId,
              name: `Lookup ${spec.key}`,
              options: {
                foreignTableId: source.id,
                linkFieldId: hostLinkFieldId,
                lookupFieldId: spec.sourceFieldId,
              },
            },
          });
        }

        const consumer = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'SystemLookup Consumer',
          fields: [
            {
              type: 'singleLineText',
              id: consumerPrimaryFieldId,
              name: 'Consumer Title',
              isPrimary: true,
            },
          ],
        });
        consumerTableId = consumer.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: consumer.id,
          field: {
            type: 'link',
            id: consumerLinkFieldId,
            name: 'Link To Host',
            options: {
              relationship: 'manyMany',
              foreignTableId: host.id,
              lookupFieldId: hostPrimaryFieldId,
              isOneWay: true,
            },
          },
        });

        for (const spec of systemFieldSpecs) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: consumer.id,
            field: {
              type: 'lookup',
              id: spec.consumerLookupFieldId,
              name: `Nested Lookup ${spec.key}`,
              options: {
                foreignTableId: host.id,
                linkFieldId: consumerLinkFieldId,
                lookupFieldId: spec.hostLookupFieldId,
              },
            },
          });
        }

        const sourceRecord = await ctx.createRecord(source.id, {
          [sourcePrimaryFieldId]: 'S1',
        });
        const hostRecord = await ctx.createRecord(host.id, {
          [hostPrimaryFieldId]: 'H1',
          [hostLinkFieldId]: [{ id: sourceRecord.id }],
        });
        const consumerRecord = await ctx.createRecord(consumer.id, {
          [consumerPrimaryFieldId]: 'C1',
          [consumerLinkFieldId]: [{ id: hostRecord.id }],
        });
        await drainOutbox();

        const sourceRecords = await ctx.listRecords(source.id);
        const hostRecords = await ctx.listRecords(host.id);
        const consumerRecords = await ctx.listRecords(consumer.id);
        const storedSource = sourceRecords.find((r) => r.id === sourceRecord.id);
        const storedHost = hostRecords.find((r) => r.id === hostRecord.id);
        const storedConsumer = consumerRecords.find((r) => r.id === consumerRecord.id);
        expect(storedSource).toBeDefined();
        expect(storedHost).toBeDefined();
        expect(storedConsumer).toBeDefined();

        for (const spec of systemFieldSpecs) {
          const sourceValue = normalize(storedSource?.fields[spec.sourceFieldId]);
          const hostValue = normalize(storedHost?.fields[spec.hostLookupFieldId]);
          const consumerValue = normalize(storedConsumer?.fields[spec.consumerLookupFieldId]);

          expect(sourceValue.length, `${spec.key} source value should exist`).toBeGreaterThan(0);
          expect(hostValue, `${spec.key} host lookup should mirror the source`).toEqual(
            sourceValue
          );
          expect(consumerValue, `${spec.key} nested lookup should mirror the host`).toEqual(
            hostValue
          );
        }
      } finally {
        if (consumerTableId) await ctx.deleteTable(consumerTableId).catch(() => undefined);
        if (hostTableId) await ctx.deleteTable(hostTableId).catch(() => undefined);
        if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
      }
    });
  });

  describe('conditional lookup chains', () => {
    // v1: lookup.e2e-spec.ts "conditional lookup chains":
    //   "should resolve multi-layer conditional lookup returning text values"
    //   "should resolve multi-layer conditional lookup returning number values"
    //   "should compute conditional rollup values from nested lookups"
    it('resolves multi-layer conditional lookups over lookup and rollup sources', async () => {
      const flatten = (value: unknown): unknown[] => {
        const flattened: unknown[] = [];
        const collect = (item: unknown) => {
          if (Array.isArray(item)) {
            item.forEach(collect);
          } else if (item !== null && item !== undefined) {
            flattened.push(item);
          }
        };
        collect(value);
        return flattened;
      };

      const leafNameFieldId = createFieldId();
      const leafScoreFieldId = createFieldId();
      const middleCategoryFieldId = createFieldId();
      const middleLinkFieldId = createFieldId();
      const middleNameLookupFieldId = createFieldId();
      const middleScoreLookupFieldId = createFieldId();
      const middleScoreRollupFieldId = createFieldId();
      const rootCategoryFilterFieldId = createFieldId();
      const rootCondNameLookupFieldId = createFieldId();
      const rootCondScoreLookupFieldId = createFieldId();
      const rootCondRollupFieldId = createFieldId();

      let leafTableId: string | undefined;
      let middleTableId: string | undefined;
      let rootTableId: string | undefined;

      try {
        const leaf = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'CondChain Leaf',
          fields: [
            { type: 'singleLineText', id: leafNameFieldId, name: 'LeafName', isPrimary: true },
            { type: 'number', id: leafScoreFieldId, name: 'LeafScore' },
          ],
        });
        leafTableId = leaf.id;

        const alpha = await ctx.createRecord(leaf.id, {
          [leafNameFieldId]: 'Alpha',
          [leafScoreFieldId]: 10,
        });
        const beta = await ctx.createRecord(leaf.id, {
          [leafNameFieldId]: 'Beta',
          [leafScoreFieldId]: 20,
        });
        const gamma = await ctx.createRecord(leaf.id, {
          [leafNameFieldId]: 'Gamma',
          [leafScoreFieldId]: 30,
        });

        const middle = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'CondChain Middle',
          fields: [
            {
              type: 'singleLineText',
              id: middleCategoryFieldId,
              name: 'Category',
              isPrimary: true,
            },
          ],
        });
        middleTableId = middle.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'link',
            id: middleLinkFieldId,
            name: 'LeafLink',
            options: {
              relationship: 'manyMany',
              foreignTableId: leaf.id,
              lookupFieldId: leafNameFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'lookup',
            id: middleNameLookupFieldId,
            name: 'LeafNames',
            options: {
              foreignTableId: leaf.id,
              linkFieldId: middleLinkFieldId,
              lookupFieldId: leafNameFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'lookup',
            id: middleScoreLookupFieldId,
            name: 'LeafScores',
            options: {
              foreignTableId: leaf.id,
              linkFieldId: middleLinkFieldId,
              lookupFieldId: leafScoreFieldId,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: middle.id,
          field: {
            type: 'rollup',
            id: middleScoreRollupFieldId,
            name: 'LeafScoreTotal',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: middleLinkFieldId,
              foreignTableId: leaf.id,
              lookupFieldId: leafScoreFieldId,
            },
          },
        });

        await ctx.createRecord(middle.id, {
          [middleCategoryFieldId]: 'Hardware',
          [middleLinkFieldId]: [{ id: alpha.id }],
        });
        await ctx.createRecord(middle.id, {
          [middleCategoryFieldId]: 'Hardware',
          [middleLinkFieldId]: [{ id: beta.id }],
        });
        await ctx.createRecord(middle.id, {
          [middleCategoryFieldId]: 'Software',
          [middleLinkFieldId]: [{ id: gamma.id }],
        });

        const categoryMatchFilter = {
          conjunction: 'and' as const,
          filterSet: [
            {
              fieldId: middleCategoryFieldId,
              operator: 'is',
              value: rootCategoryFilterFieldId,
              isSymbol: true,
            },
          ],
        };

        const root = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'CondChain Root',
          fields: [
            {
              type: 'singleLineText',
              id: rootCategoryFilterFieldId,
              name: 'CategoryFilter',
              isPrimary: true,
            },
          ],
        });
        rootTableId = root.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'conditionalLookup',
            id: rootCondNameLookupFieldId,
            name: 'FilteredLeafNames',
            options: {
              foreignTableId: middle.id,
              lookupFieldId: middleNameLookupFieldId,
              condition: { filter: categoryMatchFilter },
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'conditionalLookup',
            id: rootCondScoreLookupFieldId,
            name: 'FilteredLeafScores',
            options: {
              foreignTableId: middle.id,
              lookupFieldId: middleScoreLookupFieldId,
              condition: { filter: categoryMatchFilter },
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: root.id,
          field: {
            type: 'conditionalRollup',
            id: rootCondRollupFieldId,
            name: 'FilteredLeafScoreSum',
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: middle.id,
              lookupFieldId: middleScoreRollupFieldId,
              condition: { filter: categoryMatchFilter },
            },
          },
        });

        const hardwareRoot = await ctx.createRecord(root.id, {
          [rootCategoryFilterFieldId]: 'Hardware',
        });
        const softwareRoot = await ctx.createRecord(root.id, {
          [rootCategoryFilterFieldId]: 'Software',
        });
        await drainOutbox();

        const rootRecords = await ctx.listRecords(root.id);
        const hardwareRecord = rootRecords.find((r) => r.id === hardwareRoot.id);
        const softwareRecord = rootRecords.find((r) => r.id === softwareRoot.id);

        expect(flatten(hardwareRecord?.fields[rootCondNameLookupFieldId]).sort()).toEqual([
          'Alpha',
          'Beta',
        ]);
        expect(flatten(softwareRecord?.fields[rootCondNameLookupFieldId])).toEqual(['Gamma']);

        expect(flatten(hardwareRecord?.fields[rootCondScoreLookupFieldId]).sort()).toEqual([
          10, 20,
        ]);
        expect(flatten(softwareRecord?.fields[rootCondScoreLookupFieldId])).toEqual([30]);

        expect(hardwareRecord?.fields[rootCondRollupFieldId]).toEqual(30);
        expect(softwareRecord?.fields[rootCondRollupFieldId]).toEqual(30);
      } finally {
        if (rootTableId) await ctx.deleteTable(rootTableId).catch(() => undefined);
        if (middleTableId) await ctx.deleteTable(middleTableId).catch(() => undefined);
        if (leafTableId) await ctx.deleteTable(leafTableId).catch(() => undefined);
      }
    });
  });
});

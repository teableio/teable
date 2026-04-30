/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
  updateRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E test: reproduce the migration script link bug step by step.
 *
 * Migration script pattern:
 *   Phase 1 – create records WITHOUT link values (skip link fields)
 *   Phase 2 – use ID mapping to PATCH/update link fields
 *
 * Each step logs its raw input and output so we can see exactly where IDs diverge.
 */
describe('v2 link migration compatibility – step-by-step debug', () => {
  let ctx: SharedTestContext;

  // -------- helpers (thin wrappers that return raw JSON for inspection) --------

  async function apiPost(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await response.json();
    return { status: response.status, body: raw };
  }

  async function apiGet(path: string) {
    const response = await fetch(`${ctx.baseUrl}${path}`);
    const raw = await response.json();
    return { status: response.status, body: raw };
  }

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Scenario 1 – Two-phase migration: create → update links (fieldKeyType=id)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 1: two-phase create→update link by fieldId', () => {
    // Table & field IDs filled by beforeAll
    let speakersTableId: string;
    let esTableId: string;
    let speakerNameFieldId: string;
    let esTitleFieldId: string;
    let esLinkFieldId: string;

    // Record IDs – the "ID mapping" that the script would produce
    let spkAliceId: string;
    let spkBobId: string;
    let es001Id: string;
    let es002Id: string;

    // ---- Step 1: Create tables ----
    beforeAll(async () => {
      console.log('\n======= Scenario 1 – Step 1: Create tables =======');

      const spkRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S1_Speakers_${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Full Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const spkTable = createTableOkResponseSchema.parse(spkRes.body).data.table;
      speakersTableId = spkTable.id;
      speakerNameFieldId = spkTable.fields.find((f) => f.name === 'Full Name')!.id;
      console.log('  Speakers table created:', speakersTableId);
      console.log('  Speakers fields:', JSON.stringify(spkTable.fields, null, 2));

      const esRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S1_EventSpeakers_${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'ESID', isPrimary: true },
          {
            type: 'link',
            name: 'Speaker',
            options: {
              relationship: 'manyMany',
              foreignTableId: speakersTableId,
              lookupFieldId: speakerNameFieldId,
              isOneWay: false, // two-way link
            },
          },
        ],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const esTable = createTableOkResponseSchema.parse(esRes.body).data.table;
      esTableId = esTable.id;
      esTitleFieldId = esTable.fields.find((f) => f.name === 'ESID')!.id;
      esLinkFieldId = esTable.fields.find((f) => f.name === 'Speaker')!.id;
      console.log('  EventSpeakers table created:', esTableId);
      console.log('  EventSpeakers fields:', JSON.stringify(esTable.fields, null, 2));
      console.log('  Link field ID:', esLinkFieldId);
    });

    // ---- Step 2: Phase 1 – Create records WITHOUT link values ----
    it('Step 2 – Phase 1: create Speaker records (foreign table)', async () => {
      console.log('\n======= Step 2: Create Speaker records =======');

      const r1 = await apiPost('/tables/createRecord', {
        tableId: speakersTableId,
        fields: { [speakerNameFieldId]: 'Alice Johnson' },
        fieldKeyType: FieldKeyType.Id,
      });
      spkAliceId = createRecordOkResponseSchema.parse(r1.body).data.record.id;
      console.log('  Alice record ID:', spkAliceId);
      console.log(
        '  Alice response fields:',
        JSON.stringify(createRecordOkResponseSchema.parse(r1.body).data.record.fields)
      );

      const r2 = await apiPost('/tables/createRecord', {
        tableId: speakersTableId,
        fields: { [speakerNameFieldId]: 'Bob Smith' },
        fieldKeyType: FieldKeyType.Id,
      });
      spkBobId = createRecordOkResponseSchema.parse(r2.body).data.record.id;
      console.log('  Bob record ID:', spkBobId);

      expect(spkAliceId).toMatch(/^rec/);
      expect(spkBobId).toMatch(/^rec/);
    });

    it('Step 3 – Phase 1: create EventSpeaker records WITHOUT link values', async () => {
      console.log('\n======= Step 3: Create EventSpeaker records (no links) =======');

      const r1 = await apiPost('/tables/createRecord', {
        tableId: esTableId,
        fields: { [esTitleFieldId]: 'ES001' },
        fieldKeyType: FieldKeyType.Id,
      });
      const rec1 = createRecordOkResponseSchema.parse(r1.body).data.record;
      es001Id = rec1.id;
      console.log('  ES001 record ID:', es001Id);
      console.log('  ES001 fields:', JSON.stringify(rec1.fields));

      const r2 = await apiPost('/tables/createRecord', {
        tableId: esTableId,
        fields: { [esTitleFieldId]: 'ES002' },
        fieldKeyType: FieldKeyType.Id,
      });
      const rec2 = createRecordOkResponseSchema.parse(r2.body).data.record;
      es002Id = rec2.id;
      console.log('  ES002 record ID:', es002Id);
      console.log('  ES002 fields:', JSON.stringify(rec2.fields));

      // Link field should be empty/null at this point
      expect(rec1.fields[esLinkFieldId]).toBeOneOf([null, undefined, []]);
    });

    it('Step 4 – Phase 2: update ES001 to link to Alice (by field ID)', async () => {
      console.log('\n======= Step 4: Update ES001 → link Alice =======');
      console.log('  Input: recordId =', es001Id);
      console.log('  Input: link field ID =', esLinkFieldId);
      console.log('  Input: link value =', JSON.stringify([{ id: spkAliceId }]));

      const res = await apiPost('/tables/updateRecord', {
        tableId: esTableId,
        recordId: es001Id,
        fields: { [esLinkFieldId]: [{ id: spkAliceId }] },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      console.log('  Response status:', res.status);
      console.log('  Response body:', JSON.stringify(res.body, null, 2));

      expect(res.status).toBe(200);
      const parsed = updateRecordOkResponseSchema.parse(res.body);
      const updatedFields = parsed.data.record.fields;
      console.log('  Updated record fields:', JSON.stringify(updatedFields));

      // Check the link value in the response
      const linkVal = updatedFields[esLinkFieldId] as Array<{ id: string; title?: string }> | null;
      console.log('  Link value after update:', JSON.stringify(linkVal));

      expect(linkVal).not.toBeNull();
      expect(Array.isArray(linkVal)).toBe(true);
      expect(linkVal!.length).toBe(1);
      expect(linkVal![0].id).toBe(spkAliceId);
      console.log('  Link ID matches: ✅', linkVal![0].id, '===', spkAliceId);
      // Note: title in updateRecord response may be undefined since it's returned
      // from in-memory record before the DB title-fill statement runs.
      // The title will be correct when reading via listRecords.
      console.log('  Link title in response:', linkVal![0].title ?? '(not yet filled - OK)');
    });

    it('Step 5 – Phase 2: update ES002 to link to Bob (by field ID)', async () => {
      console.log('\n======= Step 5: Update ES002 → link Bob =======');
      console.log('  Input: link value =', JSON.stringify([{ id: spkBobId }]));

      const res = await apiPost('/tables/updateRecord', {
        tableId: esTableId,
        recordId: es002Id,
        fields: { [esLinkFieldId]: [{ id: spkBobId }] },
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
      });

      console.log('  Response status:', res.status);
      const parsed = updateRecordOkResponseSchema.parse(res.body);
      const linkVal = parsed.data.record.fields[esLinkFieldId] as Array<{
        id: string;
        title?: string;
      }> | null;
      console.log('  Link value after update:', JSON.stringify(linkVal));
      console.log('  Link title in response:', linkVal?.[0]?.title ?? '(not yet filled - OK)');

      expect(linkVal).not.toBeNull();
      expect(linkVal!.length).toBe(1);
      expect(linkVal![0].id).toBe(spkBobId);
    });

    it('Step 6 – Verify: listRecords on EventSpeakers – do link titles resolve?', async () => {
      console.log('\n======= Step 6: listRecords – check titles =======');

      const res = await apiGet(
        `/tables/listRecords?tableId=${esTableId}&fieldKeyType=${FieldKeyType.Id}`
      );
      expect(res.status).toBe(200);
      const records = listTableRecordsOkResponseSchema.parse(res.body).data.records;

      for (const rec of records) {
        const title = rec.fields[esTitleFieldId];
        const linkVal = rec.fields[esLinkFieldId] as Array<{
          id: string;
          title?: string;
        }> | null;
        console.log(`  Record ${rec.id} (${title}):`);
        console.log(`    link field value: ${JSON.stringify(linkVal)}`);
        if (linkVal) {
          for (const link of linkVal) {
            console.log(`    → linked ID: ${link.id}, title: ${link.title ?? '❌ undefined'}`);
          }
        }
      }

      // Check ES001 → Alice
      const es001 = records.find((r) => r.fields[esTitleFieldId] === 'ES001');
      const es001Links = es001?.fields[esLinkFieldId] as Array<{
        id: string;
        title?: string;
      }>;
      expect(es001Links).toHaveLength(1);
      expect(es001Links[0].id).toBe(spkAliceId);
      // This is the key assertion – does title resolve?
      expect(es001Links[0].title).toBe('Alice Johnson');
    });

    it('Step 7 – symmetric link on Speakers table populated after updateRecord', async () => {
      console.log('\n======= Step 7: listRecords – check symmetric links =======');

      const tableRes = await apiGet(`/tables/get?baseId=${ctx.baseId}&tableId=${speakersTableId}`);
      expect(tableRes.status).toBe(200);
      const speakerTable = getTableByIdOkResponseSchema.parse(tableRes.body).data.table;
      const symmetricField = speakerTable.fields.find((field) => {
        if (field.type !== 'link') return false;
        const options = field.options as { symmetricFieldId?: string };
        return options.symmetricFieldId === esLinkFieldId;
      });
      expect(symmetricField).toBeDefined();
      if (!symmetricField) return;

      await ctx.testContainer.processOutbox();

      const res = await apiGet(
        `/tables/listRecords?tableId=${speakersTableId}&fieldKeyType=${FieldKeyType.Id}`
      );
      expect(res.status).toBe(200);
      const records = listTableRecordsOkResponseSchema.parse(res.body).data.records;

      const alice = records.find((r) => r.id === spkAliceId);
      const bob = records.find((r) => r.id === spkBobId);
      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      if (!alice || !bob) return;

      const aliceLinks = alice.fields[symmetricField.id] as Array<{ id: string; title?: string }>;
      const bobLinks = bob.fields[symmetricField.id] as Array<{ id: string; title?: string }>;
      console.log('  Alice symmetric links:', JSON.stringify(aliceLinks));
      console.log('  Bob symmetric links:', JSON.stringify(bobLinks));

      expect(aliceLinks).toHaveLength(1);
      expect(aliceLinks[0]).toMatchObject({ id: es001Id, title: 'ES001' });
      expect(bobLinks).toHaveLength(1);
      expect(bobLinks[0]).toMatchObject({ id: es002Id, title: 'ES002' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Scenario 2 – Create records with inline link values (fieldKeyType=name)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 2: createRecords inline link (fieldKeyType=name, typecast=true)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let foreignRecId1: string;
    let foreignRecId2: string;

    beforeAll(async () => {
      console.log('\n======= Scenario 2 – Setup =======');

      const fRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S2_Foreign_${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const fTable = createTableOkResponseSchema.parse(fRes.body).data.table;
      foreignTableId = fTable.id;
      foreignTitleFieldId = fTable.fields.find((f) => f.name === 'Title')!.id;

      const fr1 = await apiPost('/tables/createRecord', {
        tableId: foreignTableId,
        fields: { [foreignTitleFieldId]: 'Target A' },
        fieldKeyType: FieldKeyType.Id,
      });
      foreignRecId1 = createRecordOkResponseSchema.parse(fr1.body).data.record.id;

      const fr2 = await apiPost('/tables/createRecord', {
        tableId: foreignTableId,
        fields: { [foreignTitleFieldId]: 'Target B' },
        fieldKeyType: FieldKeyType.Id,
      });
      foreignRecId2 = createRecordOkResponseSchema.parse(fr2.body).data.record.id;
      console.log('  Foreign records:', foreignRecId1, foreignRecId2);

      const mRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S2_Main_${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const mTable = createTableOkResponseSchema.parse(mRes.body).data.table;
      mainTableId = mTable.id;
      console.log('  Main table:', mainTableId);
      console.log('  Main fields:', JSON.stringify(mTable.fields, null, 2));
    });

    it('createRecords with {id,title} objects via fieldKeyType=name, typecast=true', async () => {
      console.log('\n======= Scenario 2 – createRecords with {id,title} =======');

      const inputRecords = [
        {
          fields: {
            Name: 'Inline Link 1',
            Links: [{ id: foreignRecId1, title: 'Target A' }],
          },
        },
        {
          fields: {
            Name: 'Inline Link 2',
            Links: [{ id: foreignRecId1 }, { id: foreignRecId2 }],
          },
        },
        {
          fields: {
            Name: 'No Links',
          },
        },
      ];
      console.log('  Input:', JSON.stringify(inputRecords, null, 2));

      const res = await apiPost('/tables/createRecords', {
        tableId: mainTableId,
        records: inputRecords,
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
      });

      console.log('  Response status:', res.status);
      const created = createRecordsOkResponseSchema.parse(res.body).data.records;
      for (const rec of created) {
        console.log(`  Created ${rec.id}:`, JSON.stringify(rec.fields));
      }
      expect(created).toHaveLength(3);

      // Now list and check titles
      console.log('\n  --- listRecords after create ---');
      const listRes = await apiGet(
        `/tables/listRecords?tableId=${mainTableId}&fieldKeyType=${FieldKeyType.Name}`
      );
      const records = listTableRecordsOkResponseSchema.parse(listRes.body).data.records;
      for (const rec of records) {
        console.log(`  ${rec.id}: ${JSON.stringify(rec.fields)}`);
      }

      const r1 = records.find((r) => r.fields['Name'] === 'Inline Link 1');
      const links1 = r1?.fields['Links'] as Array<{ id: string; title?: string }>;
      console.log('  Inline Link 1 → Links:', JSON.stringify(links1));
      expect(links1).toHaveLength(1);
      expect(links1[0].id).toBe(foreignRecId1);
      expect(links1[0].title).toBe('Target A');
    });

    it('createRecords with plain record ID strings ["recXxx"]', async () => {
      console.log('\n======= Scenario 2 – createRecords with string IDs =======');

      const inputRecords = [
        {
          fields: {
            Name: 'String IDs',
            Links: [foreignRecId1, foreignRecId2], // plain strings, not objects
          },
        },
      ];
      console.log('  Input:', JSON.stringify(inputRecords));
      console.log('  (note: Links value is string array, not {id} objects)');

      const res = await apiPost('/tables/createRecords', {
        tableId: mainTableId,
        records: inputRecords,
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
      });

      console.log('  Response status:', res.status);
      if (res.status === 201) {
        const created = createRecordsOkResponseSchema.parse(res.body).data.records;
        for (const rec of created) {
          console.log(`  Created ${rec.id}:`, JSON.stringify(rec.fields));
        }
      } else {
        console.log('  ERROR body:', JSON.stringify(res.body));
      }

      // List and check
      const listRes = await apiGet(
        `/tables/listRecords?tableId=${mainTableId}&fieldKeyType=${FieldKeyType.Name}`
      );
      const records = listTableRecordsOkResponseSchema.parse(listRes.body).data.records;
      const found = records.find((r) => r.fields['Name'] === 'String IDs');
      const links = found?.fields['Links'] as Array<{ id: string; title?: string }>;
      console.log('  After list – String IDs links:', JSON.stringify(links));

      expect(links).toHaveLength(2);
      expect(links.map((l) => l.id).sort()).toEqual([foreignRecId1, foreignRecId2].sort());
      // Key: does title resolve?
      console.log(
        '  Titles:',
        links.map((l) => l.title)
      );
      expect(links[0].title).toBeDefined();
      expect(links[0].title).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Scenario 3 – Batch updateRecords with fieldKeyType=name + typecast=true
  //  This is the closest to the actual migration script Phase 2.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 3: batch updateRecords (fieldKeyType=name, typecast=true)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let foreignRecId1: string;
    let foreignRecId2: string;
    let mainRec1Id: string;
    let mainRec2Id: string;

    beforeAll(async () => {
      console.log('\n======= Scenario 3 – Setup =======');

      const fRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S3_Foreign_${Date.now()}`,
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const fTable = createTableOkResponseSchema.parse(fRes.body).data.table;
      foreignTableId = fTable.id;
      foreignTitleFieldId = fTable.fields.find((f) => f.name === 'Title')!.id;

      const fr1 = await apiPost('/tables/createRecord', {
        tableId: foreignTableId,
        fields: { [foreignTitleFieldId]: 'Batch Target 1' },
        fieldKeyType: FieldKeyType.Id,
      });
      foreignRecId1 = createRecordOkResponseSchema.parse(fr1.body).data.record.id;

      const fr2 = await apiPost('/tables/createRecord', {
        tableId: foreignTableId,
        fields: { [foreignTitleFieldId]: 'Batch Target 2' },
        fieldKeyType: FieldKeyType.Id,
      });
      foreignRecId2 = createRecordOkResponseSchema.parse(fr2.body).data.record.id;
      console.log('  Foreign records:', foreignRecId1, foreignRecId2);

      const mRes = await apiPost('/tables/create', {
        baseId: ctx.baseId,
        name: `S3_Main_${Date.now()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Links',
            options: {
              relationship: 'manyMany',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      } satisfies ICreateTableCommandInput);
      const mTable = createTableOkResponseSchema.parse(mRes.body).data.table;
      mainTableId = mTable.id;

      // Phase 1: create records without links
      const cr = await apiPost('/tables/createRecords', {
        tableId: mainTableId,
        records: [{ fields: { Name: 'Main 1' } }, { fields: { Name: 'Main 2' } }],
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
      });
      const createdRecords = createRecordsOkResponseSchema.parse(cr.body).data.records;
      mainRec1Id = createdRecords[0].id;
      mainRec2Id = createdRecords[1].id;
      console.log('  Main records (no links):', mainRec1Id, mainRec2Id);
    });

    it('Phase 2: batch updateRecords with link by field name + typecast', async () => {
      console.log('\n======= Scenario 3 – batch updateRecords =======');

      const inputBody = {
        tableId: mainTableId,
        records: [
          {
            id: mainRec1Id,
            fields: {
              Links: [{ id: foreignRecId1 }],
            },
          },
          {
            id: mainRec2Id,
            fields: {
              Links: [{ id: foreignRecId1 }, { id: foreignRecId2 }],
            },
          },
        ],
        fieldKeyType: FieldKeyType.Name,
        typecast: true,
      };
      console.log('  Input body:', JSON.stringify(inputBody, null, 2));

      const res = await apiPost('/tables/updateRecords', inputBody);
      console.log('  Response status:', res.status);
      console.log('  Response body:', JSON.stringify(res.body, null, 2));

      if (res.status === 200) {
        console.log('  ✅ batch updateRecords succeeded');
        // Response is { ok: true, data: { updatedCount: N } }
        expect(res.body.ok).toBe(true);
        expect(res.body.data.updatedCount).toBe(2);
      } else {
        console.log('  ❌ updateRecords FAILED with status', res.status);
        // Still report what the error is
        expect(res.status).toBe(200);
      }
    });

    it('Verify: listRecords after batch update – titles resolve?', async () => {
      console.log('\n======= Scenario 3 – Verify after batch update =======');

      const listRes = await apiGet(
        `/tables/listRecords?tableId=${mainTableId}&fieldKeyType=${FieldKeyType.Name}`
      );
      const records = listTableRecordsOkResponseSchema.parse(listRes.body).data.records;

      for (const rec of records) {
        console.log(`  ${rec.id}: ${JSON.stringify(rec.fields)}`);
      }

      const r1 = records.find((r) => r.fields['Name'] === 'Main 1');
      const r2 = records.find((r) => r.fields['Name'] === 'Main 2');

      const links1 = r1?.fields['Links'] as Array<{ id: string; title?: string }> | null;
      const links2 = r2?.fields['Links'] as Array<{ id: string; title?: string }> | null;

      console.log('  Main 1 links:', JSON.stringify(links1));
      console.log('  Main 2 links:', JSON.stringify(links2));

      // If batch update succeeded, verify titles
      if (links1 && links1.length > 0) {
        expect(links1[0].id).toBe(foreignRecId1);
        console.log('  Main 1 title:', links1[0].title ?? '❌ undefined');
        expect(links1[0].title).toBe('Batch Target 1');
      }

      if (links2 && links2.length > 0) {
        expect(links2).toHaveLength(2);
        for (const link of links2) {
          console.log(`  Main 2 → ${link.id}, title: ${link.title ?? '❌ undefined'}`);
        }
      }
    });
  });
});

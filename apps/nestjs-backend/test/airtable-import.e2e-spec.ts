/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { getFields, getTableList, IMPORT_AIRTABLE_STREAM } from '@teable/openapi';
import { initApp, getRecords, permanentDeleteBase } from './utils/init-app';

/**
 * Real-path import e2e: drives the importer end-to-end against a fixed Airtable
 * base using a PAT (no OAuth — the RO's `accessToken` replaces the integration).
 *
 * Gated on env, so CI without credentials skips it:
 *   AIRTABLE_TEST_PAT=pat…       a token that can read the test base
 *   AIRTABLE_TEST_BASE=app…      base built by test-scripts/airtable-build-test-base.mjs
 *
 * Asserts the API-creatable surface of that base. Computed fields, single-link
 * cardinality, and views are added manually in the UI; extend the assertions
 * once they're present.
 */
const pat = process.env.AIRTABLE_TEST_PAT;
const testBase = process.env.AIRTABLE_TEST_BASE;

interface ISseResult {
  done: { type: 'done'; data: any } | null;
  error: { type: 'error'; message: string } | null;
}

function consumeSseLine(line: string, out: ISseResult): void {
  if (!line.startsWith('data: ')) return;
  const json = line.slice(6).trim();
  if (!json) return;
  const event = JSON.parse(json);
  if (event.type === 'done') out.done = event;
  else if (event.type === 'error') out.error = event;
}

async function importViaSse(appUrl: string, cookie: string, body: unknown): Promise<ISseResult> {
  const response = await fetch(`${appUrl}/api${IMPORT_AIRTABLE_STREAM}`, {
    method: 'POST',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: cookie },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const out: ISseResult = { done: null, error: null };
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) consumeSseLine(line, out);
  }
  return out;
}

// Skip unless a real Airtable PAT is set (all PATs start with "pat"), so an
// empty or placeholder secret skips the suite instead of failing CI.
describe.skipIf(!pat?.startsWith('pat') || !testBase)(
  'Airtable import (e2e, needs AIRTABLE_PAT + AIRTABLE_TEST_BASE)',
  () => {
    let app: INestApplication;
    const spaceId = globalThis.testConfig.spaceId;
    let result: any;
    let tables: { id: string; name: string }[];
    let allFieldsId: string;
    let linkedId: string;
    let allFields: any[];

    const byName = (fields: any[], name: string) => fields.find((f) => f.name === name);

    beforeAll(async () => {
      const ctx = await initApp();
      app = ctx.app;

      const { done, error } = await importViaSse(ctx.appUrl, ctx.cookie, {
        accessToken: pat,
        airtableBaseId: testBase,
        spaceId,
        baseName: 'E2E Airtable Import',
        importRecords: true,
        importAttachments: true,
      });
      expect(error).toBeNull();
      expect(done).toBeTruthy();
      result = done!.data;

      tables = (await getTableList(result.base.id)).data;
      allFieldsId = tables.find((t) => t.name === 'All Fields')!.id;
      linkedId = tables.find((t) => t.name === 'Linked')!.id;
      allFields = (await getFields(allFieldsId)).data;
    }, 180_000);

    afterAll(async () => {
      if (result?.base?.id) await permanentDeleteBase(result.base.id).catch(() => undefined);
      await app.close();
    });

    it('creates the base in the target space with its three tables', () => {
      expect(result.base.spaceId).toBe(spaceId);
      expect(tables.map((t) => t.name).sort()).toEqual(['All Fields', 'Linked', 'Self']);
    });

    it('maps scalar field types (text/number/date/rating/checkbox/user/attachment)', () => {
      expect(byName(allFields, 'Long text')?.type).toBe(FieldType.LongText);
      expect(byName(allFields, 'Email')?.type).toBe(FieldType.SingleLineText);
      expect(byName(allFields, 'Int')?.type).toBe(FieldType.Number);
      expect(byName(allFields, 'Currency USD')?.type).toBe(FieldType.Number);
      expect(byName(allFields, 'Rate star 5')?.type).toBe(FieldType.Rating);
      expect(byName(allFields, 'Check green')?.type).toBe(FieldType.Checkbox);
      expect(byName(allFields, 'Date iso')?.type).toBe(FieldType.Date);
      expect(byName(allFields, 'DT utc 24')?.type).toBe(FieldType.Date);
      expect(byName(allFields, 'Single collaborator')?.type).toBe(FieldType.User);
      expect(byName(allFields, 'Attachments')?.type).toBe(FieldType.Attachment);
    });

    it('maps single/multi select with their choices', () => {
      const ss = byName(allFields, 'Single select');
      expect(ss?.type).toBe(FieldType.SingleSelect);
      expect(ss?.options?.choices?.length).toBe(5);
      expect(byName(allFields, 'Multi select')?.type).toBe(FieldType.MultipleSelect);
    });

    it('degrades duration to a number and reports it as an issue', () => {
      expect(byName(allFields, 'Dur h:mm')?.type).toBe(FieldType.Number);
      expect(result.issues.some((i: any) => i.fieldName === 'Dur h:mm')).toBe(true);
    });

    it('creates link fields pointing at the right tables', () => {
      const toB = byName(allFields, 'Link to B');
      expect(toB?.type).toBe(FieldType.Link);
      expect(toB?.options?.foreignTableId).toBe(linkedId);
      expect([Relationship.ManyMany, Relationship.ManyOne]).toContain(toB?.options?.relationship);

      const self = byName(allFields, 'Self link');
      expect(self?.type).toBe(FieldType.Link);
      expect(self?.options?.foreignTableId).toBe(allFieldsId);
    });

    it('relaxes an over-capacity single link to many-to-many instead of truncating', () => {
      // The API can only create multi links, so the kitchen-sink base has no
      // single links — add a single-link field whose data holds several links
      // in the Airtable UI to exercise this. Airtable's single-link is a soft
      // per-cell limit, so its data can hold multiple; the importer must keep
      // them all by relaxing the field to many-to-many, never truncating.
      const relaxed = result.issues.filter((i: any) => i.toType === 'many-to-many link');
      for (const issue of relaxed) {
        // a relaxed field must NOT also be reported as truncated (kept-first)
        expect(
          result.issues.some(
            (i: any) =>
              i.code === 'valuesDropped' &&
              i.fieldName === issue.fieldName &&
              /single-link/.test(i.reason ?? '')
          )
        ).toBe(false);
        // and if it lives in All Fields, it must be a many-to-many link now
        const field = byName(allFields, issue.fieldName);
        if (field) expect(field.options?.relationship).toBe(Relationship.ManyMany);
      }
    });

    it('keeps fields in the Airtable field order (primary first, links after scalars)', () => {
      const names = allFields.map((f) => f.name);
      const idx = (name: string) => names.indexOf(name);
      const selectIdx = idx('Single select');
      expect(names[0]).toBe('Name'); // primary first
      // scalar columns keep their source order
      expect(idx('Long text')).toBeLessThan(idx('Barcode'));
      expect(idx('Barcode')).toBeLessThan(idx('Int'));
      expect(idx('Int')).toBeLessThan(selectIdx);
      // links/derived fields land at their Airtable position, not dumped at the end
      expect(selectIdx).toBeLessThan(idx('Link to B'));
    });

    it('imports the records of both tables in their Airtable order', async () => {
      const nameId = byName(allFields, 'Name')?.id;
      const af = (await getRecords(allFieldsId, { fieldKeyType: FieldKeyType.Id })).records;
      expect(af.length).toBeGreaterThanOrEqual(19);
      const linked = (await getRecords(linkedId, { fieldKeyType: FieldKeyType.Id })).records;
      expect(linked.length).toBe(8);
      // records keep the Airtable order — Teable's create would otherwise reverse them
      const names = af.map((r: any) => r.fields[nameId!]);
      expect(names.indexOf('Row 1')).toBeLessThan(names.indexOf('Row 2'));
      expect(names.indexOf('Row 2')).toBeLessThan(names.indexOf('Row 3'));
    });
  }
);

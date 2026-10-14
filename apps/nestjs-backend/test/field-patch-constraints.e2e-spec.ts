import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { axios, updateField as patchField } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

// These fixtures preserve the reported field types, linked lookup, PATCH payloads,
// and audit dependency shape without copying customer identifiers or record data.
describe('Field PATCH constraints and audit tracking (v2)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const tableIds: string[] = [];

  beforeAll(async () => {
    ({ app } = await initApp());
  });

  afterEach(async () => {
    for (const tableId of tableIds.reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    tableIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const table = async (fields: IFieldRo[]) => {
    const created = await createTable(baseId, { name: 'Patch regression', fields, records: [] });
    tableIds.push(created.id);
    return created;
  };

  it.each<[FieldType, string | number, string | number]>([
    [FieldType.SingleLineText, 'first', 'second'],
    [FieldType.LongText, 'first paragraph', 'second paragraph'],
    [FieldType.Number, 1, 2],
    [FieldType.Date, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
  ])('Y2826 PATCH unique enforces %s on inserts and updates', async (type, first, second) => {
    const target = await table([
      { name: 'Title', type: FieldType.SingleLineText },
      { name: 'Value', type },
    ]);
    const field = target.fields[1];
    const { records } = await createRecords(target.id, {
      records: [{ fields: { [field.id]: first } }, { fields: { [field.id]: second } }],
    });

    const response = await patchField(target.id, field.id, { unique: true });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');
    expect((await getField(target.id, field.id)).unique).toBe(true);
    await expect(
      createRecords(target.id, { records: [{ fields: { [field.id]: first } }] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateRecordByApi(target.id, records[1].id, field.id, first)
    ).rejects.toMatchObject({ status: 400 });
    expect((await getRecord(target.id, records[1].id)).fields[field.id]).toEqual(second);

    await patchField(target.id, field.id, { unique: false });
    await updateRecordByApi(target.id, records[1].id, field.id, first);
    expect((await getRecord(target.id, records[1].id)).fields[field.id]).toEqual(first);
  });

  it('Y2825 rejects unique on all five unsupported field shapes', async () => {
    const source = await table([{ name: 'Source', type: FieldType.SingleLineText }]);
    const target = await table([
      { name: 'Title', type: FieldType.SingleLineText },
      { name: 'Choice', type: FieldType.SingleSelect, options: { choices: [] } },
      { name: 'Checked', type: FieldType.Checkbox },
      { name: 'Created', type: FieldType.CreatedTime },
      { name: 'Sequence', type: FieldType.AutoNumber },
    ]);
    const link = await createField(target.id, {
      name: 'Related',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: source.id },
    });
    const lookup = await createField(target.id, {
      name: 'Related title',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: source.id,
        linkFieldId: link.id,
        lookupFieldId: source.fields[0].id,
      },
    });
    for (const field of [...target.fields.slice(1), lookup]) {
      const response = await axios.patch(
        `/table/${target.id}/field/${field.id}`,
        { unique: true },
        { validateStatus: () => true }
      );
      expect(response.status).toBe(400);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(response.data).toMatchObject({
        data: {
          localization: {
            i18nKey: 'httpErrors.field.uniqueUnsupportedType',
            context: { name: field.name, fieldId: field.id },
          },
        },
      });
      expect((await getField(target.id, field.id)).unique).not.toBe(true);
    }
  });

  it('Y2827 rejects notNull on all five unsupported field types', async () => {
    const target = await table([
      { name: 'Title', type: FieldType.SingleLineText },
      { name: 'Checked', type: FieldType.Checkbox },
      { name: 'Action', type: FieldType.Button },
      { name: 'Calculated', type: FieldType.Formula, options: { expression: '1+1' } },
      { name: 'Created', type: FieldType.CreatedTime },
      { name: 'Sequence', type: FieldType.AutoNumber },
    ]);
    for (const field of target.fields.slice(1)) {
      const response = await axios.patch(
        `/table/${target.id}/field/${field.id}`,
        { notNull: true },
        { validateStatus: () => true }
      );
      expect(response.status).toBe(400);
      expect(response.headers['x-teable-v2']).toBe('true');
      expect((await getField(target.id, field.id)).notNull).not.toBe(true);
    }
  });

  it('Y2865 PATCH empty trackedFieldIds immediately tracks previously untracked changes', async () => {
    const target = await table([
      { name: 'A', type: FieldType.SingleLineText },
      { name: 'B', type: FieldType.SingleLineText },
    ]);
    const [a, b] = target.fields;
    const audit = await createField(target.id, {
      name: 'Modified',
      type: FieldType.LastModifiedTime,
      description: 'Preserve audit context',
      options: { trackedFieldIds: [a.id] },
    });
    const { records } = await createRecords(target.id, {
      records: [{ fields: { [a.id]: 'initial', [b.id]: 'before' } }],
    });
    const response = await patchField(target.id, audit.id, { options: { trackedFieldIds: [] } });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');
    expect((await getField(target.id, audit.id)).options).toMatchObject({ trackedFieldIds: [] });
    expect((await getField(target.id, audit.id)).description).toBe('Preserve audit context');
    const before = await getRecord(target.id, records[0].id);
    const previousTime = before.fields[audit.id];
    await delay(61000);
    const changedAt = Date.now();
    await updateRecordByApi(target.id, records[0].id, b.id, 'after');
    const after = await getRecord(target.id, records[0].id);
    expect(after.fields[b.id]).toBe('after');
    const modified = Date.parse(String(after.fields[audit.id]));
    expect(modified).toBeGreaterThanOrEqual(changedAt - 1000);
    if (previousTime != null) {
      expect(modified).toBeGreaterThan(Date.parse(String(previousTime)));
    }
  }, 90000);

  it('preserves lastModifiedBy descriptions when clearing tracked fields', async () => {
    const target = await table([{ name: 'A', type: FieldType.SingleLineText }]);
    const audit = await createField(target.id, {
      name: 'Modified by',
      type: FieldType.LastModifiedBy,
      description: 'Preserve actor context',
      options: { trackedFieldIds: [target.fields[0].id] },
    });
    await patchField(target.id, audit.id, { options: { trackedFieldIds: [] } });
    expect(await getField(target.id, audit.id)).toMatchObject({
      description: 'Preserve actor context',
      options: { trackedFieldIds: [] },
    });
  });

  it('removes unique after enabling it together with a column rename', async () => {
    const target = await table([{ name: 'Title', type: FieldType.SingleLineText }]);
    const field = target.fields[0];
    const { records } = await createRecords(target.id, {
      records: [{ fields: { [field.id]: 'first' } }, { fields: { [field.id]: 'second' } }],
    });
    await patchField(target.id, field.id, { unique: true, dbFieldName: 'renamed_value' });
    expect(await getField(target.id, field.id)).toMatchObject({
      unique: true,
      dbFieldName: 'renamed_value',
    });
    await expect(
      updateRecordByApi(target.id, records[1].id, field.id, 'first')
    ).rejects.toMatchObject({ status: 400 });
    await patchField(target.id, field.id, { unique: false });
    expect((await getField(target.id, field.id)).unique).toBe(false);
    await updateRecordByApi(target.id, records[1].id, field.id, 'first');
    expect((await getRecord(target.id, records[1].id)).fields[field.id]).toBe('first');
  });

  it('renames a unique column when both generated index names truncate identically', async () => {
    const prefix = 'a'.repeat(62);
    const target = await table([
      { name: 'Title', type: FieldType.SingleLineText, dbFieldName: `${prefix}x` },
    ]);
    const field = target.fields[0];
    const { records } = await createRecords(target.id, {
      records: [{ fields: { [field.id]: 'first' } }, { fields: { [field.id]: 'second' } }],
    });
    await patchField(target.id, field.id, { unique: true });
    await patchField(target.id, field.id, { dbFieldName: `${prefix}y` });
    await expect(
      updateRecordByApi(target.id, records[1].id, field.id, 'first')
    ).rejects.toMatchObject({ status: 400 });
    await patchField(target.id, field.id, { unique: false });
    await updateRecordByApi(target.id, records[1].id, field.id, 'first');
    expect((await getRecord(target.id, records[1].id)).fields[field.id]).toBe('first');
  });

  it('never renames a sibling unique constraint when a nonunique column shares its truncated prefix', async () => {
    const prefix = 'a'.repeat(43);
    const target = await table([
      { name: 'Unique', type: FieldType.SingleLineText, dbFieldName: `${prefix}x` },
      { name: 'Other', type: FieldType.SingleLineText, dbFieldName: `${prefix}y` },
    ]);
    const [unique, other] = target.fields;
    const { records } = await createRecords(target.id, {
      records: [
        { fields: { [unique.id]: 'first', [other.id]: 'same' } },
        { fields: { [unique.id]: 'second', [other.id]: 'same' } },
      ],
    });
    await patchField(target.id, unique.id, { unique: true });
    await patchField(target.id, other.id, { dbFieldName: 'renamed_nonunique' });
    await expect(
      updateRecordByApi(target.id, records[1].id, unique.id, 'first')
    ).rejects.toMatchObject({ status: 400 });
    await patchField(target.id, unique.id, { unique: false });
    expect((await getField(target.id, unique.id)).unique).toBe(false);
    await updateRecordByApi(target.id, records[1].id, unique.id, 'first');
    expect((await getRecord(target.id, records[1].id)).fields[unique.id]).toBe('first');
  });

  it('enforces and removes a supported notNull constraint through PATCH', async () => {
    const target = await table([{ name: 'Title', type: FieldType.SingleLineText }]);
    const field = target.fields[0];
    const { records } = await createRecords(target.id, {
      records: [{ fields: { [field.id]: 'required' } }],
    });
    await patchField(target.id, field.id, { notNull: true });
    expect((await getField(target.id, field.id)).notNull).toBe(true);
    await expect(updateRecordByApi(target.id, records[0].id, field.id, null)).rejects.toMatchObject(
      { status: 400 }
    );
    expect((await getRecord(target.id, records[0].id)).fields[field.id]).toBe('required');
    await patchField(target.id, field.id, { notNull: false });
    await updateRecordByApi(target.id, records[0].id, field.id, null);
    expect((await getRecord(target.id, records[0].id)).fields[field.id] ?? null).toBeNull();
  });

  it('rejects unsupported PATCH properties rather than silently stripping them', async () => {
    const target = await table([{ name: 'Title', type: FieldType.SingleLineText }]);
    await expect(
      patchField(target.id, target.fields[0].id, { options: { trackedFieldIds: [] } })
    ).rejects.toMatchObject({ status: 400 });
    const unknownProperty = await axios.patch(
      `/table/${target.id}/field/${target.fields[0].id}`,
      { type: FieldType.Number },
      { validateStatus: () => true }
    );
    expect(unknownProperty.status).toBe(400);
    expect((await getField(target.id, target.fields[0].id)).type).toBe(FieldType.SingleLineText);
  });
});

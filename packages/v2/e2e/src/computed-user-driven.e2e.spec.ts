/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for user-field-driven computed updates.
 *
 * Ported from v1 specs (v2-branch expectations):
 * - apps/nestjs-backend/test/computed-user-field.e2e-spec.ts (CRUD section)
 * - apps/nestjs-backend/test/computed-version-regression.e2e-spec.ts
 *   (value-level contract only; the v1 spec asserts v1 event payloads which do
 *   not exist in v2 — here we assert the equivalent HTTP-visible record state)
 *
 * Covers:
 * - createdBy / lastModifiedBy field creation backfilling existing records
 * - formulas depending on lastModifiedBy / lastModifiedTime
 * - lastModifiedBy trackedFieldIds record-level semantics
 * - lastModifiedTime / lastModifiedBy trackedFieldIds listRecords sort
 * - multi-user formula persistence via computed updates
 */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type RecordShape = { id: string; fields: Record<string, unknown> };

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const asUserCell = (value: unknown): { id?: string; title?: string } | null => {
  const parsed = parseMaybeJson(value);
  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as { id?: string; title?: string };
  }
  return null;
};

const asUserCellArray = (value: unknown): Array<{ id?: string; title?: string }> => {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => asUserCell(item) ?? {});
  }
  const single = asUserCell(parsed);
  return single ? [single] : [];
};

describe('v2 user-field-driven computed updates (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = `usrdrv${fieldIdCounter.toString(36)}`.padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const drainOutbox = async (maxRounds = 10) => {
    for (let i = 0; i < maxRounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecords = async (
    tableId: string,
    options?: { sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }> }
  ): Promise<RecordShape[]> => {
    await drainOutbox();
    return ctx.listRecords(tableId, options);
  };

  const getRecord = async (tableId: string, recordId: string): Promise<RecordShape> => {
    const records = await listRecords(tableId);
    const record = records.find((item) => item.id === recordId);
    if (!record) throw new Error(`Record not found: ${recordId}`);
    return record;
  };

  const seedUser = async (id: string, name: string, email: string) => {
    await sql`
      insert into users (id, name, email)
      values (${id}, ${name}, ${email})
      on conflict (id) do nothing
    `.execute(ctx.testContainer.db);

    await sql`
      insert into collaborator (id, resource_type, resource_id, principal_id, principal_type)
      values ('col' || ${id}, 'base', ${ctx.baseId}, ${id}, 'user')
      on conflict (id) do nothing
    `.execute(ctx.testContainer.db);
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // createdBy / lastModifiedBy field creation
  // ---------------------------------------------------------------------------

  // v1: computed-user-field.e2e-spec.ts > CRUD > should create a created by field
  it('creates a createdBy field that backfills the creator for existing records', async () => {
    const nameFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('CreatedBy Backfill'),
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });
    await ctx.createRecord(table.id, { [nameFieldId]: 'r2' });

    const createdByFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'createdBy', id: createdByFieldId, name: 'Created By' },
    });

    const records = await listRecords(table.id);
    expect(records.length).toBe(2);
    for (const record of records) {
      const cell = asUserCell(record.fields[createdByFieldId]);
      expect(cell).toMatchObject({ title: ctx.testUser.name });
    }
  });

  // v1: computed-user-field.e2e-spec.ts > CRUD > should create a last modified by field
  // (v2 branch: untouched records are backfilled too)
  it('backfills lastModifiedBy for all records on creation and updates on record update', async () => {
    const nameFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LastModifiedBy Backfill'),
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const record1 = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });
    const record2 = await ctx.createRecord(table.id, { [nameFieldId]: 'r2' });

    await ctx.updateRecord(table.id, record1.id, { [nameFieldId]: 'test' });

    const lmbFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'lastModifiedBy', id: lmbFieldId, name: 'Last Modified By' },
    });

    const records = await listRecords(table.id);
    const first = records.find((item) => item.id === record1.id);
    const second = records.find((item) => item.id === record2.id);
    expect(asUserCell(first?.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });
    // v2 contract: records that were never explicitly updated are backfilled as well
    expect(asUserCell(second?.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });

    await ctx.updateRecord(table.id, record2.id, { [nameFieldId]: 'test2' });
    const updated = await getRecord(table.id, record2.id);
    expect(asUserCell(updated.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });
  });

  // ---------------------------------------------------------------------------
  // Formulas depending on system user/time fields
  // ---------------------------------------------------------------------------

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should update formula result depends on a last modified by field
  it('updates formula result depending on a lastModifiedBy field', async () => {
    const nameFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMB Formula'),
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const record1 = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });
    const record2 = await ctx.createRecord(table.id, { [nameFieldId]: 'r2' });

    await ctx.updateRecord(table.id, record1.id, { [nameFieldId]: 'test' });

    const lmbFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'lastModifiedBy', id: lmbFieldId, name: 'Last Modified By' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'LMB Formula',
        options: { expression: `{${lmbFieldId}}` },
      },
    });

    const records = await listRecords(table.id);
    const first = records.find((item) => item.id === record1.id);
    const second = records.find((item) => item.id === record2.id);
    expect(asUserCell(first?.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });
    expect(first?.fields[formulaFieldId]).toBe(ctx.testUser.name);
    // v2 branch: backfilled records also compute the formula
    expect(asUserCell(second?.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });
    expect(second?.fields[formulaFieldId]).toBe(ctx.testUser.name);

    await ctx.updateRecord(table.id, record2.id, { [nameFieldId]: 'test2' });
    const updated = await getRecord(table.id, record2.id);
    expect(asUserCell(updated.fields[lmbFieldId])).toMatchObject({ title: ctx.testUser.name });
    expect(updated.fields[formulaFieldId]).toBe(ctx.testUser.name);
  });

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should update formula result depends on a last modified time field
  it('updates formula result depending on a lastModifiedTime field', async () => {
    const nameFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMT Formula'),
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const record1 = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });
    const record2 = await ctx.createRecord(table.id, { [nameFieldId]: 'r2' });

    await ctx.updateRecord(table.id, record1.id, { [nameFieldId]: 'test' });

    const lmtFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'lastModifiedTime', id: lmtFieldId, name: 'Last Modified Time' },
    });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'LMT Formula',
        options: { expression: `{${lmtFieldId}}` },
      },
    });

    const toInstant = (value: unknown): number => {
      expect(value).toBeTruthy();
      const parsed = new Date(String(value)).getTime();
      expect(Number.isNaN(parsed)).toBe(false);
      return parsed;
    };

    const records = await listRecords(table.id);
    const first = records.find((item) => item.id === record1.id);
    const second = records.find((item) => item.id === record2.id);
    // Formula mirrors the lastModifiedTime field for every record (v2 backfills all rows)
    expect(toInstant(first?.fields[formulaFieldId])).toBe(toInstant(first?.fields[lmtFieldId]));
    expect(toInstant(second?.fields[formulaFieldId])).toBe(toInstant(second?.fields[lmtFieldId]));

    const before = toInstant(second?.fields[lmtFieldId]);
    await ctx.updateRecord(table.id, record2.id, { [nameFieldId]: 'test2' });
    const updated = await getRecord(table.id, record2.id);
    const after = toInstant(updated.fields[lmtFieldId]);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(toInstant(updated.fields[formulaFieldId])).toBe(after);
  });

  // Port of computed-version-regression.e2e-spec.ts value contract:
  // one record update recomputes LMB + LMT + same-table formula together.
  it('recomputes lastModifiedBy, lastModifiedTime and dependent formula on a single update', async () => {
    const titleFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('Version Alignment'),
      fields: [{ type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'before' });

    const lmtFieldId = createFieldId();
    const lmbFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'lastModifiedTime', id: lmtFieldId, name: 'LMT' },
    });
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: { type: 'lastModifiedBy', id: lmbFieldId, name: 'LMB' },
    });
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'UpperTitle',
        options: { expression: `UPPER({${titleFieldId}})` },
      },
    });

    await ctx.updateRecord(table.id, record.id, { [titleFieldId]: 'after' });

    const updated = await getRecord(table.id, record.id);
    expect(typeof updated.fields[lmtFieldId]).toBe('string');
    expect(new Date(String(updated.fields[lmtFieldId])).getTime()).not.toBeNaN();
    expect(asUserCell(updated.fields[lmbFieldId])).toMatchObject({ id: ctx.testUser.id });
    expect(updated.fields[formulaFieldId]).toBe('AFTER');
  });

  // ---------------------------------------------------------------------------
  // lastModifiedBy trackedFieldIds semantics
  // ---------------------------------------------------------------------------

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should allow configuring Last Modified By field to track specific fields only
  it('tracks only configured fields for lastModifiedBy with trackedFieldIds', async () => {
    const nameFieldId = createFieldId();
    const textFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMB Tracked Fields'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: textFieldId, name: 'Tracked Text' },
        { type: 'number', id: numberFieldId, name: 'Untracked Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const record = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });

    const lmbFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lastModifiedBy',
        id: lmbFieldId,
        name: 'Tracked LMB',
        options: { trackedFieldIds: [textFieldId] },
      },
    });

    await ctx.updateRecord(table.id, record.id, { [numberFieldId]: 1 });
    let current = await getRecord(table.id, record.id);
    expect(current.fields[lmbFieldId] ?? null).toBeNull();

    await ctx.updateRecord(table.id, record.id, { [textFieldId]: 'tracked change' });
    current = await getRecord(table.id, record.id);
    expect(asUserCell(current.fields[lmbFieldId])).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
    });
  });

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should fall back to track all when tracked fields are removed
  it('falls back to tracking all fields when tracked fields are removed', async () => {
    const nameFieldId = createFieldId();
    const textFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMB Tracked Removal'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: textFieldId, name: 'Tracked Text' },
        { type: 'number', id: numberFieldId, name: 'Other Number' },
      ],
      views: [{ type: 'grid' }],
    });
    const record = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });

    const lmbFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lastModifiedBy',
        id: lmbFieldId,
        name: 'Tracked LMB',
        options: { trackedFieldIds: [textFieldId] },
      },
    });

    await ctx.updateRecord(table.id, record.id, { [numberFieldId]: 1 });
    let current = await getRecord(table.id, record.id);
    expect(current.fields[lmbFieldId] ?? null).toBeNull();

    await ctx.deleteField({ tableId: table.id, fieldId: textFieldId });

    await ctx.updateRecord(table.id, record.id, { [numberFieldId]: 2 });
    current = await getRecord(table.id, record.id);
    expect(asUserCell(current.fields[lmbFieldId])).toMatchObject({
      id: ctx.testUser.id,
      title: ctx.testUser.name,
    });
  });

  // ---------------------------------------------------------------------------
  // lastModifiedTime trackedFieldIds list sort
  // ---------------------------------------------------------------------------

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should sort last modified time by tracked field values not system last modified
  it('sorts lastModifiedTime by tracked field values not system last modified', async () => {
    const waitForTimestamp = () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 1100);
      return promise;
    };
    const nameFieldId = createFieldId();
    const trackedFieldId = createFieldId();
    const otherFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMT Tracked Sort'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: trackedFieldId, name: 'Tracked Status' },
        { type: 'singleLineText', id: otherFieldId, name: 'Other' },
      ],
      views: [{ type: 'grid' }],
    });

    const lmtFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lastModifiedTime',
        id: lmtFieldId,
        name: 'Last modified',
        options: {
          trackedFieldIds: [trackedFieldId],
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        },
      },
    });

    const oldest = await ctx.createRecord(table.id, { [nameFieldId]: 'oldest-tracked' });
    const middle = await ctx.createRecord(table.id, { [nameFieldId]: 'middle-tracked' });
    const newest = await ctx.createRecord(table.id, { [nameFieldId]: 'newest-tracked' });
    const targetIds = [oldest.id, middle.id, newest.id];

    await ctx.updateRecord(table.id, oldest.id, { [trackedFieldId]: 's1' });
    await waitForTimestamp();
    await ctx.updateRecord(table.id, middle.id, { [trackedFieldId]: 's2' });
    await waitForTimestamp();
    await ctx.updateRecord(table.id, newest.id, { [trackedFieldId]: 's3' });
    await waitForTimestamp();
    await ctx.updateRecord(table.id, oldest.id, { [otherFieldId]: 'noise' });

    const unsorted = (await listRecords(table.id)).filter((record) =>
      targetIds.includes(record.id)
    );
    const displayedById = new Map(
      unsorted.map((record) => [record.id, String(record.fields[lmtFieldId] ?? '')])
    );
    expect(displayedById.get(oldest.id)).toBeTruthy();
    expect(displayedById.get(middle.id)).toBeTruthy();
    expect(displayedById.get(newest.id)).toBeTruthy();
    expect(displayedById.get(oldest.id)).not.toBe(displayedById.get(middle.id));
    expect(displayedById.get(middle.id)).not.toBe(displayedById.get(newest.id));

    const sorted = (
      await listRecords(table.id, { sort: [{ fieldId: lmtFieldId, order: 'desc' }] })
    ).filter((record) => targetIds.includes(record.id));
    const expectedIds = [...targetIds].sort((left, right) => {
      const leftTime = displayedById.get(left) ?? '';
      const rightTime = displayedById.get(right) ?? '';
      return leftTime < rightTime ? 1 : leftTime > rightTime ? -1 : 0;
    });

    expect(sorted.map((record) => record.id)).toEqual(expectedIds);
    expect(sorted[0]?.id).toBe(newest.id);
    expect(sorted[2]?.id).toBe(oldest.id);
  });

  it('sorts lastModifiedBy by tracked field values not system last modified', async () => {
    const nameFieldId = createFieldId();
    const trackedFieldId = createFieldId();
    const otherFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('LMB Tracked Sort'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: trackedFieldId, name: 'Tracked Status' },
        { type: 'singleLineText', id: otherFieldId, name: 'Other' },
      ],
      views: [{ type: 'grid' }],
    });
    const oldest = await ctx.createRecord(table.id, { [nameFieldId]: 'oldest' });
    const middle = await ctx.createRecord(table.id, { [nameFieldId]: 'middle' });
    const newest = await ctx.createRecord(table.id, { [nameFieldId]: 'newest' });
    const targetIds = [oldest.id, middle.id, newest.id];

    const lmbFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'lastModifiedBy',
        id: lmbFieldId,
        name: 'Last modified by',
        options: { trackedFieldIds: [trackedFieldId] },
      },
    });

    await ctx.updateRecord(table.id, oldest.id, { [otherFieldId]: 'noise' });
    await ctx.updateRecord(table.id, newest.id, { [trackedFieldId]: 'tracked' });

    const unsorted = (await listRecords(table.id)).filter((record) =>
      targetIds.includes(record.id)
    );
    const oldestCell = asUserCell(
      unsorted.find((record) => record.id === oldest.id)?.fields[lmbFieldId]
    );
    const middleCell = asUserCell(
      unsorted.find((record) => record.id === middle.id)?.fields[lmbFieldId]
    );
    const newestCell = asUserCell(
      unsorted.find((record) => record.id === newest.id)?.fields[lmbFieldId]
    );
    expect(oldestCell).toBeNull();
    expect(middleCell).toBeNull();
    expect(newestCell).toMatchObject({ id: ctx.testUser.id, title: ctx.testUser.name });

    const sorted = (
      await listRecords(table.id, { sort: [{ fieldId: lmbFieldId, order: 'desc' }] })
    ).filter((record) => targetIds.includes(record.id));

    expect(sorted.map((record) => record.id)).toEqual([newest.id, oldest.id, middle.id]);
  });

  // ---------------------------------------------------------------------------
  // User fields in formulas and lookups
  // ---------------------------------------------------------------------------

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should persist multi-user formula values via computed updates
  it('persists multi-user formula values via computed updates', async () => {
    const nameFieldId = createFieldId();
    const userFieldId = createFieldId();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('Multi-user Formula'),
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'user',
          id: userFieldId,
          name: 'Members',
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const record = await ctx.createRecord(table.id, { [nameFieldId]: 'r1' });

    const formulaFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        id: formulaFieldId,
        name: 'Members Formula',
        options: { expression: `{${userFieldId}}` },
      },
    });

    await ctx.updateRecord(table.id, record.id, {
      [userFieldId]: [{ id: ctx.testUser.id, title: ctx.testUser.name }],
    });

    const updated = await getRecord(table.id, record.id);
    const members = asUserCellArray(updated.fields[userFieldId]);
    expect(members).toEqual([expect.objectContaining({ title: ctx.testUser.name })]);
    expect(JSON.stringify(updated.fields[formulaFieldId])).toContain(ctx.testUser.name);
  });

  // v1: computed-user-field.e2e-spec.ts > CRUD >
  //     should refresh linked lookup user field after source multi-user field changes
  it('refreshes linked lookup user field after source multi-user field changes', async () => {
    const secondaryUser = {
      id: 'usrComputedUserDrvB',
      name: 'Computed Lookup Bob',
      email: 'bob+computed-user-driven@e2e.com',
    };
    await seedUser(secondaryUser.id, secondaryUser.name, secondaryUser.email);

    const sourceNameFieldId = createFieldId();
    const sourceUserFieldId = createFieldId();
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('Lookup User Source'),
      fields: [
        { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'user',
          id: sourceUserFieldId,
          name: 'Members',
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const sourceRecord = await ctx.createRecord(sourceTable.id, {
      [sourceNameFieldId]: 'source-1',
      [sourceUserFieldId]: [{ id: ctx.testUser.id, title: ctx.testUser.name }],
    });

    const hostNameFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('Lookup User Host'),
      fields: [
        { type: 'singleLineText', id: hostNameFieldId, name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: hostLinkFieldId,
          name: 'Source',
          options: {
            relationship: 'manyOne',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const lookupFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTable.id,
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Lookup Members',
        options: {
          linkFieldId: hostLinkFieldId,
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceUserFieldId,
        },
      },
    });

    const hostRecord = await ctx.createRecord(hostTable.id, {
      [hostNameFieldId]: 'host-1',
      [hostLinkFieldId]: { id: sourceRecord.id },
    });
    await drainOutbox();

    let hostRow = await getRecord(hostTable.id, hostRecord.id);
    expect(asUserCellArray(hostRow.fields[lookupFieldId])).toEqual([
      expect.objectContaining({ id: ctx.testUser.id, title: ctx.testUser.name }),
    ]);

    await ctx.updateRecord(sourceTable.id, sourceRecord.id, {
      [sourceUserFieldId]: [
        { id: ctx.testUser.id, title: ctx.testUser.name },
        { id: secondaryUser.id, title: secondaryUser.name },
      ],
    });
    await drainOutbox();

    hostRow = await getRecord(hostTable.id, hostRecord.id);
    expect(asUserCellArray(hostRow.fields[lookupFieldId])).toEqual([
      expect.objectContaining({ id: ctx.testUser.id, title: ctx.testUser.name }),
      expect.objectContaining({ id: secondaryUser.id, title: secondaryUser.name }),
    ]);
  });
});

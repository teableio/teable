/* eslint-disable @typescript-eslint/naming-convention */
import { updateRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const INTERNAL_UPDATE_BATCH_SIZE = 1_000;
const UPDATE_RECORD_COUNT = INTERNAL_UPDATE_BATCH_SIZE + 1;
const CREATE_CHUNK_SIZE = 250;

type RecordRef = { id: string };
type ListedRecord = { id: string; fields: Record<string, unknown> };
type ApiResult = { status: number; body: unknown };

type BoundaryFixture = {
  parentTableId: string;
  childTableId: string;
  childTitleFieldId: string;
  parentTitleFieldId: string;
  markerFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  parentDbTableName: string;
  childDbTableName: string;
  childrenColumn: string;
  ownerColumn: string;
};

type SelectorFixture = {
  parentTableId: string;
  childTableId: string;
  parentTitleFieldId: string;
  amountFieldId: string;
  roundedFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  childDbTableName: string;
  childParentColumn: string;
  ownerColumn: string;
};

const linkIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return [];
    return typeof item.id === 'string' ? [item.id] : [];
  });
};

const singleLinkId = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || !('id' in value)) return undefined;
  return typeof value.id === 'string' ? value.id : undefined;
};

const findRecord = (records: ListedRecord[], record: RecordRef): ListedRecord => {
  const found = records.find(({ id }) => id === record.id);
  if (!found) throw new Error(`Missing record ${record.id}`);
  return found;
};

const tableDbName = async (ctx: SharedTestContext, tableId: string): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', tableId)
    .executeTakeFirstOrThrow();
  return row.db_table_name;
};

const fieldDbName = async (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<string> => {
  const row = await ctx.testContainer.db
    .selectFrom('field')
    .select('db_field_name')
    .where('table_id', '=', tableId)
    .where('id', '=', fieldId)
    .where('deleted_time', 'is', null)
    .executeTakeFirstOrThrow();
  if (!row.db_field_name) throw new Error(`Missing database column for ${fieldId}`);
  return row.db_field_name;
};

const expectStoredFormula = async (ctx: SharedTestContext, fieldId: string): Promise<void> => {
  const fieldRow = await ctx.testContainer.db
    .selectFrom('field')
    .select('meta')
    .where('id', '=', fieldId)
    .executeTakeFirstOrThrow();
  const meta = fieldRow.meta ? (JSON.parse(fieldRow.meta) as Record<string, unknown>) : {};
  expect(meta.persistedAsGeneratedColumn ?? false).toBe(false);
};

const createRecordsInChunks = async (
  ctx: SharedTestContext,
  tableId: string,
  titleFieldId: string,
  count: number,
  prefix: string
): Promise<RecordRef[]> => {
  const created: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += CREATE_CHUNK_SIZE) {
    const batchSize = Math.min(CREATE_CHUNK_SIZE, count - offset);
    created.push(
      ...(await ctx.createRecords(
        tableId,
        Array.from({ length: batchSize }, (_, index) => ({
          fields: { [titleFieldId]: `${prefix} ${offset + index}` },
        }))
      ))
    );
  }
  return created;
};

const listAllRecords = async (
  ctx: SharedTestContext,
  tableId: string,
  count: number
): Promise<ListedRecord[]> => {
  const records: ListedRecord[] = [];
  for (let offset = 0; offset < count; offset += INTERNAL_UPDATE_BATCH_SIZE) {
    records.push(
      ...(await ctx.listRecordsWithoutDrain(tableId, {
        limit: INTERNAL_UPDATE_BATCH_SIZE,
        offset,
      }))
    );
  }
  return records;
};

const readPhysicalOwner = async (
  ctx: SharedTestContext,
  childDbTableName: string,
  ownerColumn: string,
  child: RecordRef
): Promise<string | null> => {
  const result = await sql<{ owner_id: string | null }>`
    SELECT ${sql.ref(ownerColumn)} AS owner_id
    FROM ${sql.table(childDbTableName)}
    WHERE ${sql.ref('__id')} = ${child.id}
  `.execute(ctx.testContainer.db);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.owner_id;
};

const postUpdateRecords = async (
  ctx: SharedTestContext,
  tableId: string,
  records: Array<{ id: string; fields: Record<string, unknown> }>
): Promise<ApiResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, records }),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

const createBoundaryFixture = async (ctx: SharedTestContext): Promise<BoundaryFixture> => {
  const childTitleFieldId = `fld${getRandomString(16)}`;
  const childTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op release children ${getRandomString(8)}`,
    fields: [{ id: childTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
  const childDbTableName = await tableDbName(ctx, childTable.id);

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const parentTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `No-op release parents ${getRandomString(8)}`,
    fields: [
      { id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'number' },
    ],
    views: [{ type: 'grid' }],
  });
  const parentDbTableName = await tableDbName(ctx, parentTable.id);

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parentTable.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: childTable.id,
        lookupFieldId: childTitleFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: childDbTableName,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });

  return {
    parentTableId: parentTable.id,
    childTableId: childTable.id,
    childTitleFieldId,
    parentTitleFieldId,
    markerFieldId,
    childrenFieldId,
    parentFieldId,
    parentDbTableName,
    childDbTableName,
    childrenColumn: await fieldDbName(ctx, parentTable.id, childrenFieldId),
    ownerColumn,
  };
};

const createSelectorFixture = async (ctx: SharedTestContext): Promise<SelectorFixture> => {
  const amountFieldId = `fld${getRandomString(16)}`;
  const roundedFieldId = `fld${getRandomString(16)}`;
  const childTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Selector formula children ${getRandomString(8)}`,
    fields: [
      { id: amountFieldId, name: 'Amount', type: 'number' },
      {
        id: roundedFieldId,
        name: 'Rounded',
        type: 'formula',
        isPrimary: true,
        options: { expression: `ROUND({${amountFieldId}}, 0)` },
      },
    ],
    views: [{ type: 'grid' }],
  });
  const childDbTableName = await tableDbName(ctx, childTable.id);
  await expectStoredFormula(ctx, roundedFieldId);

  const parentTitleFieldId = `fld${getRandomString(16)}`;
  const parentTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Selector formula parents ${getRandomString(8)}`,
    fields: [{ id: parentTitleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: parentTable.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: childTable.id,
        lookupFieldId: roundedFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: childDbTableName,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });

  return {
    parentTableId: parentTable.id,
    childTableId: childTable.id,
    parentTitleFieldId,
    amountFieldId,
    roundedFieldId,
    childrenFieldId,
    parentFieldId,
    childDbTableName,
    childParentColumn: await fieldDbName(ctx, childTable.id, parentFieldId),
    ownerColumn,
  };
};

const updateByRecordIds = async (
  ctx: SharedTestContext,
  tableId: string,
  recordIds: string[],
  fields: Record<string, unknown>
): Promise<{ updatedCount: number }> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordIds, fields, typecast: true }),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
  const parsed = updateRecordsOkResponseSchema.safeParse(rawBody);
  expect(parsed.success, JSON.stringify(rawBody)).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Selector update failed: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data;
};

describe('link FK/cache mismatch reconciliation (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it("rejects a lone claim of another parent's child and preserves its FK and both caches", async () => {
    const fixture = await createBoundaryFixture(ctx);
    const [claimant, owner] = await ctx.createRecords(fixture.parentTableId, [
      { fields: { [fixture.parentTitleFieldId]: 'Claimant A' } },
      { fields: { [fixture.parentTitleFieldId]: 'Owner B' } },
    ]);
    if (!claimant || !owner) throw new Error('Missing claimant/owner records');
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.childTitleFieldId]: 'B-owned child',
    });
    await ctx.updateRecord(fixture.parentTableId, owner.id, {
      [fixture.childrenFieldId]: [{ id: child.id }],
    });
    await ctx.drainOutbox();

    const parentsBefore = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    const childBefore = findRecord(await ctx.listRecordsWithoutDrain(fixture.childTableId), child);
    const physicalOwnerBefore = await readPhysicalOwner(
      ctx,
      fixture.childDbTableName,
      fixture.ownerColumn,
      child
    );
    expect(linkIds(findRecord(parentsBefore, claimant).fields[fixture.childrenFieldId])).toEqual(
      []
    );
    expect(linkIds(findRecord(parentsBefore, owner).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(singleLinkId(childBefore.fields[fixture.parentFieldId])).toBe(owner.id);
    expect(physicalOwnerBefore).toBe(owner.id);

    const result = await postUpdateRecords(ctx, fixture.parentTableId, [
      {
        id: claimant.id,
        fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
      },
    ]);
    expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(400);
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(500);

    const parentsAfter = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    const childAfter = findRecord(await ctx.listRecordsWithoutDrain(fixture.childTableId), child);
    expect(linkIds(findRecord(parentsAfter, claimant).fields[fixture.childrenFieldId])).toEqual([]);
    expect(linkIds(findRecord(parentsAfter, owner).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(singleLinkId(childAfter.fields[fixture.parentFieldId])).toBe(owner.id);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      physicalOwnerBefore
    );
  }, 120_000);

  it('releases a physical FK for a cache-noop source in a mixed batch', async () => {
    const fixture = await createBoundaryFixture(ctx);
    const [oldOwner, markerTarget] = await ctx.createRecords(fixture.parentTableId, [
      { fields: { [fixture.parentTitleFieldId]: 'Parent A' } },
      { fields: { [fixture.parentTitleFieldId]: 'Marker target' } },
    ]);
    if (!oldOwner || !markerTarget) throw new Error('Missing parent records');
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.childTitleFieldId]: 'Cache-noop child',
    });

    await ctx.updateRecord(fixture.parentTableId, oldOwner.id, {
      [fixture.childrenFieldId]: [{ id: child.id }],
    });
    await ctx.drainOutbox();

    // The presented inverse cache is already empty, but the physical FK and
    // child-side link still identify A as the owner.
    await sql`
      UPDATE ${sql.table(fixture.parentDbTableName)}
      SET ${sql.ref(fixture.childrenColumn)} = '[]'::jsonb
      WHERE ${sql.ref('__id')} = ${oldOwner.id}
    `.execute(ctx.testContainer.db);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      oldOwner.id
    );
    const mismatchedParents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    expect(
      linkIds(findRecord(mismatchedParents, oldOwner).fields[fixture.childrenFieldId])
    ).toEqual([]);
    const mismatchedChild = findRecord(
      await ctx.listRecordsWithoutDrain(fixture.childTableId),
      child
    );
    expect(singleLinkId(mismatchedChild.fields[fixture.parentFieldId])).toBe(oldOwner.id);

    const result = await ctx.updateRecords({
      tableId: fixture.parentTableId,
      records: [
        { id: oldOwner.id, fields: { [fixture.childrenFieldId]: [] } },
        { id: markerTarget.id, fields: { [fixture.markerFieldId]: 42 } },
      ],
    });
    expect(result.updatedCount).toBe(1);
    await ctx.drainOutbox();

    const finalParents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    expect(linkIds(findRecord(finalParents, oldOwner).fields[fixture.childrenFieldId])).toEqual([]);
    expect(findRecord(finalParents, markerTarget).fields[fixture.markerFieldId]).toBe(42);
    const finalChild = findRecord(await ctx.listRecordsWithoutDrain(fixture.childTableId), child);
    expect(singleLinkId(finalChild.fields[fixture.parentFieldId])).toBeUndefined();
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      null
    );
  }, 120_000);

  it('does not apply link side effects from a missing source in a mixed batch', async () => {
    const fixture = await createBoundaryFixture(ctx);
    const [oldOwner, markerTarget] = await ctx.createRecords(fixture.parentTableId, [
      { fields: { [fixture.parentTitleFieldId]: 'Parent A' } },
      { fields: { [fixture.parentTitleFieldId]: 'Marker target' } },
    ]);
    if (!oldOwner || !markerTarget) throw new Error('Missing parent records');
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.childTitleFieldId]: 'Existing child',
    });
    await ctx.updateRecord(fixture.parentTableId, oldOwner.id, {
      [fixture.childrenFieldId]: [{ id: child.id }],
    });
    await ctx.drainOutbox();

    const missingSourceId = `rec${getRandomString(16)}`;
    const result = await ctx.updateRecords({
      tableId: fixture.parentTableId,
      records: [
        {
          id: missingSourceId,
          fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
        },
        { id: markerTarget.id, fields: { [fixture.markerFieldId]: 84 } },
      ],
    });
    expect(result.updatedCount).toBe(1);
    await ctx.drainOutbox();

    const finalParents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    expect(linkIds(findRecord(finalParents, oldOwner).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(findRecord(finalParents, markerTarget).fields[fixture.markerFieldId]).toBe(84);
    const finalChild = findRecord(await ctx.listRecordsWithoutDrain(fixture.childTableId), child);
    expect(singleLinkId(finalChild.fields[fixture.parentFieldId])).toBe(oldOwner.id);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      oldOwner.id
    );
  }, 120_000);

  it('honors a no-op cache release in the second internal batch while transferring the physical FK', async () => {
    const fixture = await createBoundaryFixture(ctx);
    const parents = await createRecordsInChunks(
      ctx,
      fixture.parentTableId,
      fixture.parentTitleFieldId,
      UPDATE_RECORD_COUNT,
      'Boundary parent'
    );
    const oldOwner = parents[0]!;
    const claimant = parents[1]!;
    const fillers = parents.slice(2);
    expect(fillers).toHaveLength(INTERNAL_UPDATE_BATCH_SIZE - 1);
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.childTitleFieldId]: 'Boundary child',
    });

    await ctx.updateRecord(fixture.parentTableId, oldOwner.id, {
      [fixture.childrenFieldId]: [{ id: child.id }],
    });
    await ctx.drainOutbox();

    // Reproduce a deferred inverse-cache lag: the owning FK and child-side cache
    // still point at A, but A's presented Children cache is already empty.
    await sql`
      UPDATE ${sql.table(fixture.parentDbTableName)}
      SET ${sql.ref(fixture.childrenColumn)} = '[]'::jsonb
      WHERE ${sql.ref('__id')} = ${oldOwner.id}
    `.execute(ctx.testContainer.db);
    const rawOldOwnerCache = await sql<{ children_cache: unknown }>`
      SELECT ${sql.ref(fixture.childrenColumn)} AS children_cache
      FROM ${sql.table(fixture.parentDbTableName)}
      WHERE ${sql.ref('__id')} = ${oldOwner.id}
    `.execute(ctx.testContainer.db);
    expect(rawOldOwnerCache.rows).toEqual([{ children_cache: [] }]);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      oldOwner.id
    );
    const mismatchedParents = await listAllRecords(ctx, fixture.parentTableId, UPDATE_RECORD_COUNT);
    expect(
      linkIds(findRecord(mismatchedParents, oldOwner).fields[fixture.childrenFieldId])
    ).toEqual([]);

    const result = await ctx.updateRecords({
      tableId: fixture.parentTableId,
      records: [
        {
          id: claimant.id,
          fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
        },
        ...fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.markerFieldId]: index + 1 },
        })),
        {
          id: oldOwner.id,
          fields: { [fixture.childrenFieldId]: [] },
        },
      ],
    });
    // The final release is intentionally a cache no-op and must still contribute
    // intent to link validation without pretending that its row was updated.
    expect(result.updatedCount).toBe(INTERNAL_UPDATE_BATCH_SIZE);
    await ctx.drainOutbox();

    const finalParents = await listAllRecords(ctx, fixture.parentTableId, UPDATE_RECORD_COUNT);
    expect(linkIds(findRecord(finalParents, oldOwner).fields[fixture.childrenFieldId])).toEqual([]);
    expect(linkIds(findRecord(finalParents, claimant).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    const finalChildren = await ctx.listRecordsWithoutDrain(fixture.childTableId);
    expect(singleLinkId(findRecord(finalChildren, child).fields[fixture.parentFieldId])).toBe(
      claimant.id
    );
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      claimant.id
    );
  }, 180_000);

  it('migrates a selector-updated inverse link from the physical owner when its stable formula value is gated', async () => {
    const fixture = await createSelectorFixture(ctx);
    const [oldOwner, newOwner] = await ctx.createRecords(fixture.parentTableId, [
      { fields: { [fixture.parentTitleFieldId]: 'Parent A' } },
      { fields: { [fixture.parentTitleFieldId]: 'Parent B' } },
    ]);
    if (!oldOwner || !newOwner) throw new Error('Missing selector parent records');
    const child = await ctx.createRecord(fixture.childTableId, {
      [fixture.amountFieldId]: 2.1,
    });
    await ctx.drainOutbox();
    await ctx.updateRecord(fixture.childTableId, child.id, {
      [fixture.parentFieldId]: { id: oldOwner.id },
    });
    await ctx.drainOutbox();

    const initialChildren = await ctx.listRecordsWithoutDrain(fixture.childTableId);
    const initialChild = findRecord(initialChildren, child);
    expect(initialChild.fields[fixture.roundedFieldId]).toBe(2);
    expect(singleLinkId(initialChild.fields[fixture.parentFieldId])).toBe(oldOwner.id);

    // Reproduce the opposite deferred-cache lag: the physical FK is A and A's
    // inverse cache contains C, while C's presented Parent cache is null.
    await sql`
      UPDATE ${sql.table(fixture.childDbTableName)}
      SET ${sql.ref(fixture.childParentColumn)} = NULL
      WHERE ${sql.ref('__id')} = ${child.id}
    `.execute(ctx.testContainer.db);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      oldOwner.id
    );
    const mismatchedChild = findRecord(
      await ctx.listRecordsWithoutDrain(fixture.childTableId),
      child
    );
    expect(singleLinkId(mismatchedChild.fields[fixture.parentFieldId])).toBeUndefined();
    expect(mismatchedChild.fields[fixture.roundedFieldId]).toBe(2);
    const mismatchedParents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    expect(
      linkIds(findRecord(mismatchedParents, oldOwner).fields[fixture.childrenFieldId])
    ).toEqual([child.id]);

    const result = await updateByRecordIds(ctx, fixture.childTableId, [child.id], {
      [fixture.parentFieldId]: { id: newOwner.id },
      [fixture.amountFieldId]: 2.2,
    });
    expect(result.updatedCount).toBe(1);
    await ctx.drainOutbox();

    const finalChild = findRecord(await ctx.listRecordsWithoutDrain(fixture.childTableId), child);
    expect(finalChild.fields[fixture.amountFieldId]).toBe(2.2);
    // ROUND(2.1, 0) and ROUND(2.2, 0) are both 2. The inverse migration must
    // therefore survive computed propagation's unchanged-value gating.
    expect(finalChild.fields[fixture.roundedFieldId]).toBe(2);
    expect(singleLinkId(finalChild.fields[fixture.parentFieldId])).toBe(newOwner.id);

    const finalParents = await ctx.listRecordsWithoutDrain(fixture.parentTableId);
    expect(linkIds(findRecord(finalParents, oldOwner).fields[fixture.childrenFieldId])).toEqual([]);
    expect(linkIds(findRecord(finalParents, newOwner).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(await readPhysicalOwner(ctx, fixture.childDbTableName, fixture.ownerColumn, child)).toBe(
      newOwner.id
    );
  }, 120_000);
});

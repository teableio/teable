/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString, isRecordsBatchUpdatedEvent, isRecordUpdatedEvent } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const INTERNAL_UPDATE_BATCH_SIZE = 1_000;
const BOUNDARY_FILLER_COUNT = INTERNAL_UPDATE_BATCH_SIZE - 1;
const LARGE_PARENT_COUNT = 1_000;
const CHILDREN_PER_PARENT = 66;
const LARGE_CHILD_COUNT = LARGE_PARENT_COUNT * CHILDREN_PER_PARENT;
const CREATE_CHUNK_SIZE = 1_000;

type RecordRef = { id: string };

type SelfOneManyFixture = {
  tableId: string;
  titleFieldId: string;
  markerFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  dbTableName: string;
  titleColumn: string;
  markerColumn: string;
  childrenColumn: string;
  parentColumn: string;
  ownerColumn: string;
  ownerOrderColumn: string;
};

const createSelfOneManyFixture = async (
  ctx: SharedTestContext,
  scope: string
): Promise<SelfOneManyFixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const markerFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `${scope} ${getRandomString(8)}`,
    fields: [
      { id: titleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: markerFieldId, name: 'Marker', type: 'number' },
    ],
    views: [{ type: 'grid' }],
  });
  const tableMeta = await ctx.testContainer.db
    .selectFrom('table_meta')
    .select('db_table_name')
    .where('id', '=', table.id)
    .executeTakeFirstOrThrow();

  const childrenFieldId = `fld${getRandomString(16)}`;
  const parentFieldId = `fld${getRandomString(16)}`;
  const ownerColumn = `__fk_${parentFieldId}`;
  await ctx.createField({
    baseId: ctx.baseId,
    tableId: table.id,
    field: {
      id: childrenFieldId,
      name: 'Children',
      type: 'link',
      options: {
        relationship: 'oneMany',
        foreignTableId: table.id,
        lookupFieldId: titleFieldId,
        isOneWay: false,
        symmetricFieldId: parentFieldId,
        fkHostTableName: tableMeta.db_table_name,
        selfKeyName: ownerColumn,
        foreignKeyName: '__id',
      },
    },
  });
  const fieldRows = await ctx.testContainer.db
    .selectFrom('field')
    .select(['id', 'db_field_name'])
    .where('table_id', '=', table.id)
    .where('deleted_time', 'is', null)
    .where('id', 'in', [titleFieldId, markerFieldId, childrenFieldId, parentFieldId])
    .execute();
  const dbFieldNameById = new Map(fieldRows.map((row) => [row.id, row.db_field_name]));
  const titleColumn = dbFieldNameById.get(titleFieldId);
  const markerColumn = dbFieldNameById.get(markerFieldId);
  const childrenColumn = dbFieldNameById.get(childrenFieldId);
  const parentColumn = dbFieldNameById.get(parentFieldId);
  if (!titleColumn || !markerColumn || !childrenColumn || !parentColumn) {
    throw new Error('Missing self-link physical fixture metadata');
  }

  return {
    tableId: table.id,
    titleFieldId,
    markerFieldId,
    childrenFieldId,
    parentFieldId,
    dbTableName: tableMeta.db_table_name,
    titleColumn,
    markerColumn,
    childrenColumn,
    parentColumn,
    ownerColumn,
    ownerOrderColumn: `${ownerColumn}_order`,
  };
};

const createNamedRecords = async (
  ctx: SharedTestContext,
  fixture: SelfOneManyFixture,
  count: number,
  nameAt: (index: number) => string
): Promise<RecordRef[]> => {
  const created: RecordRef[] = [];
  for (let offset = 0; offset < count; offset += CREATE_CHUNK_SIZE) {
    const batchSize = Math.min(CREATE_CHUNK_SIZE, count - offset);
    created.push(
      ...(await ctx.createRecords(
        fixture.tableId,
        Array.from({ length: batchSize }, (_, index) => ({
          fields: { [fixture.titleFieldId]: nameAt(offset + index) },
        }))
      ))
    );
  }
  return created;
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

const findRecord = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  record: RecordRef
) => {
  const found = records.find(({ id }) => id === record.id);
  if (!found) throw new Error(`Missing record ${record.id}`);
  return found;
};

describe('self oneMany streamed ownership safety (postgres e2e, T8242)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  it('accepts the same self-link transfer written from both sides across the 1000-row boundary', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self link inverse boundary');
    const [parentA, parentB, childC] = await createNamedRecords(
      ctx,
      fixture,
      3,
      (index) => ['Parent A', 'Parent B', 'Child C'][index]!
    );
    if (!parentA || !parentB || !childC) throw new Error('Missing boundary records');
    const fillers = await createNamedRecords(
      ctx,
      fixture,
      BOUNDARY_FILLER_COUNT,
      (index) => `Boundary filler ${index}`
    );

    await ctx.updateRecord(fixture.tableId, parentA.id, {
      [fixture.childrenFieldId]: [{ id: childC.id }],
    });
    await ctx.drainOutbox();

    const result = await ctx.updateRecords({
      tableId: fixture.tableId,
      records: [
        {
          id: parentB.id,
          fields: { [fixture.childrenFieldId]: [{ id: childC.id }] },
        },
        ...fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.titleFieldId]: `Boundary filler updated ${index}` },
        })),
        {
          id: childC.id,
          fields: { [fixture.parentFieldId]: { id: parentB.id } },
        },
      ],
    });
    expect(result.updatedCount).toBe(INTERNAL_UPDATE_BATCH_SIZE + 1);
    await ctx.drainOutbox();

    const firstPage = await ctx.listRecordsWithoutDrain(fixture.tableId, {
      limit: INTERNAL_UPDATE_BATCH_SIZE,
      offset: 0,
    });
    const secondPage = await ctx.listRecordsWithoutDrain(fixture.tableId, {
      limit: INTERNAL_UPDATE_BATCH_SIZE,
      offset: INTERNAL_UPDATE_BATCH_SIZE,
    });
    const records = [...firstPage, ...secondPage];
    expect(linkIds(findRecord(records, parentA).fields[fixture.childrenFieldId])).toEqual([]);
    expect(linkIds(findRecord(records, parentB).fields[fixture.childrenFieldId])).toEqual([
      childC.id,
    ]);
    expect(singleLinkId(findRecord(records, childC).fields[fixture.parentFieldId])).toBe(
      parentB.id
    );

    const physicalOwner = await sql<{ owner_id: string | null }>`
      SELECT ${sql.ref(fixture.ownerColumn)} AS owner_id
      FROM ${sql.table(fixture.dbTableName)}
      WHERE ${sql.ref('__id')} = ${childC.id}
    `.execute(ctx.testContainer.db);
    expect(physicalOwner.rows).toEqual([{ owner_id: parentB.id }]);
  }, 180_000);

  it('clears a damaged self-link when X receives an ordinary write in the same internal batch', async () => {
    const fixture = await createSelfOneManyFixture(
      ctx,
      'Self link same-batch clear ordinary write'
    );
    const [parentA, childX] = await createNamedRecords(
      ctx,
      fixture,
      2,
      (index) => ['A', 'X'][index]!
    );
    if (!parentA || !childX) throw new Error('Missing same-batch clear records');

    await ctx.updateRecord(fixture.tableId, parentA.id, {
      [fixture.childrenFieldId]: [{ id: childX.id }],
    });
    await ctx.drainOutbox();

    // Reproduce the damaged cache independently of the public write path:
    // A.Children is [], while X.Parent and its authoritative FK still point to A.
    await sql`
      UPDATE ${sql.table(fixture.dbTableName)}
      SET ${sql.ref(fixture.childrenColumn)} = '[]'::jsonb
      WHERE ${sql.ref('__id')} = ${parentA.id}
    `.execute(ctx.testContainer.db);

    const readPhysicalState = async () => {
      const result = await sql<{
        id: string;
        children: unknown;
        parent: unknown;
        owner_id: string | null;
        marker: number | null;
        version: number;
      }>`
        SELECT ${sql.ref('__id')} AS id,
          ${sql.ref(fixture.childrenColumn)} AS children,
          ${sql.ref(fixture.parentColumn)} AS parent,
          ${sql.ref(fixture.ownerColumn)} AS owner_id,
          ${sql.ref(fixture.markerColumn)} AS marker,
          ${sql.ref('__version')} AS version
        FROM ${sql.table(fixture.dbTableName)}
        WHERE ${sql.ref('__id')} IN (${parentA.id}, ${childX.id})
      `.execute(ctx.testContainer.db);
      return new Map(result.rows.map((row) => [row.id, row]));
    };

    const before = await readPhysicalState();
    expect(before.get(parentA.id)?.children).toEqual([]);
    expect(before.get(childX.id)?.owner_id).toBe(parentA.id);
    expect(before.get(childX.id)?.parent).toEqual({ id: parentA.id, title: 'A' });
    const parentVersion = before.get(parentA.id)!.version;
    const childVersion = before.get(childX.id)!.version;
    const beforeEventCount = ctx.testContainer.eventBus.events().length;

    // Both rows stay inside one 1,000-record implementation batch. X's normal
    // Marker write is part of this command, so it must not be mistaken for an
    // external generation change while the pending FK release is validated.
    const result = await ctx.updateRecords({
      tableId: fixture.tableId,
      records: [
        { id: parentA.id, fields: { [fixture.childrenFieldId]: [] } },
        { id: childX.id, fields: { [fixture.markerFieldId]: 7 } },
      ],
    });
    expect(result.updatedCount).toBe(1);

    const afterCommit = await readPhysicalState();
    expect(afterCommit.get(childX.id)?.owner_id).toBeNull();
    expect(afterCommit.get(childX.id)?.marker).toBe(7);
    await ctx.drainOutbox();

    const records = await ctx.listRecordsWithoutDrain(fixture.tableId);
    expect(linkIds(findRecord(records, parentA).fields[fixture.childrenFieldId])).toEqual([]);
    expect(singleLinkId(findRecord(records, childX).fields[fixture.parentFieldId])).toBeUndefined();
    expect(findRecord(records, childX).fields[fixture.markerFieldId]).toBe(7);

    const after = await readPhysicalState();
    expect(after.get(parentA.id)?.children).toBeNull();
    expect(after.get(parentA.id)?.version).toBe(parentVersion + 1);
    expect(after.get(childX.id)?.owner_id).toBeNull();
    expect(after.get(childX.id)?.parent).toBeNull();
    expect(after.get(childX.id)?.version).toBe(childVersion + 2);

    const events = ctx.testContainer.eventBus.events().slice(beforeEventCount);
    const updates = events
      .filter(isRecordsBatchUpdatedEvent)
      .flatMap((event) =>
        event.tableId.toString() === fixture.tableId
          ? event.updates.map((update) => ({ source: event.source, ...update }))
          : []
      );
    expect(updates.filter(({ source }) => source !== 'computed')).toEqual([
      {
        source: 'user',
        recordId: childX.id,
        oldVersion: childVersion,
        newVersion: childVersion + 1,
        changes: [{ fieldId: fixture.markerFieldId, oldValue: null, newValue: 7 }],
      },
    ]);
    expect(
      events.filter(
        (event) =>
          isRecordUpdatedEvent(event) &&
          event.tableId.toString() === fixture.tableId &&
          event.recordId.toString() === parentA.id &&
          event.source !== 'computed'
      )
    ).toHaveLength(0);
    expect(
      updates.filter(({ source, recordId }) => source === 'computed' && recordId === parentA.id)
    ).toEqual([
      {
        source: 'computed',
        recordId: parentA.id,
        oldVersion: parentVersion,
        newVersion: parentVersion + 1,
        changes: [
          { fieldId: fixture.childrenFieldId, oldValue: [], newValue: null },
          { fieldId: fixture.parentFieldId, oldValue: null, newValue: null },
        ],
      },
    ]);
    expect(
      updates.filter(({ source, recordId }) => source === 'computed' && recordId === childX.id)
    ).toEqual([
      {
        source: 'computed',
        recordId: childX.id,
        oldVersion: childVersion + 1,
        newVersion: childVersion + 2,
        changes: [
          { fieldId: fixture.childrenFieldId, oldValue: null, newValue: null },
          {
            fieldId: fixture.parentFieldId,
            oldValue: { id: parentA.id, title: 'A' },
            newValue: null,
          },
        ],
      },
    ]);
  }, 120_000);

  it('keeps a pending self-link clear valid when its target receives only an ordinary write in the next batch', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self link pending clear ordinary write');
    const [parentA, childX] = await createNamedRecords(
      ctx,
      fixture,
      2,
      (index) => ['A', 'X'][index]!
    );
    if (!parentA || !childX) throw new Error('Missing pending-clear records');
    const fillers = await createNamedRecords(
      ctx,
      fixture,
      BOUNDARY_FILLER_COUNT,
      (index) => `Pending clear filler ${index}`
    );
    await ctx.updateRecord(fixture.tableId, parentA.id, {
      [fixture.childrenFieldId]: [{ id: childX.id }],
    });
    await ctx.drainOutbox();

    // Reproduce the historical mismatch: A's cache omits X, but X's owning
    // FK and inverse cache still point at A. An explicit [] must snapshot X
    // for the deferred physical clear even though A itself is a source no-op.
    await sql`
      UPDATE ${sql.table(fixture.dbTableName)}
      SET ${sql.ref(fixture.childrenColumn)} = '[]'::jsonb
      WHERE ${sql.ref('__id')} = ${parentA.id}
    `.execute(ctx.testContainer.db);

    const readPhysicalState = async () => {
      const result = await sql<{
        id: string;
        children: unknown;
        parent: unknown;
        owner_id: string | null;
        version: number;
      }>`
        SELECT ${sql.ref('__id')} AS id,
          ${sql.ref(fixture.childrenColumn)} AS children,
          ${sql.ref(fixture.parentColumn)} AS parent,
          ${sql.ref(fixture.ownerColumn)} AS owner_id,
          ${sql.ref('__version')} AS version
        FROM ${sql.table(fixture.dbTableName)}
        WHERE ${sql.ref('__id')} IN (${parentA.id}, ${childX.id})
      `.execute(ctx.testContainer.db);
      return new Map(result.rows.map((row) => [row.id, row]));
    };
    const before = await readPhysicalState();
    expect(before.get(parentA.id)?.children).toEqual([]);
    expect(before.get(childX.id)?.owner_id).toBe(parentA.id);
    expect(before.get(childX.id)?.parent).toEqual({ id: parentA.id, title: 'A' });
    const parentVersion = before.get(parentA.id)!.version;
    const childVersion = before.get(childX.id)!.version;
    const beforeEventCount = ctx.testContainer.eventBus.events().length;

    // Exactly 1001 inputs: batch one captures X's pending release token;
    // batch two changes X's tuple through Marker only, without link intent.
    // That same-request ordinary write must not look like an external ABA.
    const result = await ctx.updateRecords({
      tableId: fixture.tableId,
      records: [
        { id: parentA.id, fields: { [fixture.childrenFieldId]: [] } },
        ...fillers.map((record, index) => ({
          id: record.id,
          fields: { [fixture.markerFieldId]: index + 1 },
        })),
        { id: childX.id, fields: { [fixture.markerFieldId]: 10_001 } },
      ],
    });
    // Only the 999 filler writes and X's ordinary write are direct updates.
    expect(result.updatedCount).toBe(INTERNAL_UPDATE_BATCH_SIZE);
    const afterCommit = await readPhysicalState();
    expect(afterCommit.get(childX.id)?.owner_id).toBeNull();
    await ctx.drainOutbox();

    const firstPage = await ctx.listRecordsWithoutDrain(fixture.tableId, {
      limit: INTERNAL_UPDATE_BATCH_SIZE,
      offset: 0,
    });
    const secondPage = await ctx.listRecordsWithoutDrain(fixture.tableId, {
      limit: INTERNAL_UPDATE_BATCH_SIZE,
      offset: INTERNAL_UPDATE_BATCH_SIZE,
    });
    const records = [...firstPage, ...secondPage];
    expect(findRecord(records, childX).fields[fixture.markerFieldId]).toBe(10_001);
    expect(linkIds(findRecord(records, parentA).fields[fixture.childrenFieldId])).toEqual([]);
    expect(singleLinkId(findRecord(records, childX).fields[fixture.parentFieldId])).toBeUndefined();
    const after = await readPhysicalState();
    // Match the original no-op repair contract: empty computed caches become
    // SQL NULL, and repairing A is a computed update, not a direct source one.
    expect(after.get(parentA.id)?.children).toBeNull();
    expect(after.get(parentA.id)?.version).toBe(parentVersion + 1);
    expect(after.get(childX.id)?.owner_id).toBeNull();
    expect(after.get(childX.id)?.parent).toBeNull();
    expect(after.get(childX.id)?.version).toBe(childVersion + 2);

    const events = ctx.testContainer.eventBus.events().slice(beforeEventCount);
    const updates = events
      .filter(isRecordsBatchUpdatedEvent)
      .flatMap((event) =>
        event.tableId.toString() === fixture.tableId
          ? event.updates.map((update) => ({ source: event.source, ...update }))
          : []
      );
    const directUpdates = updates.filter(({ source }) => source !== 'computed');
    expect(directUpdates.map(({ recordId }) => recordId).sort()).toEqual(
      [...fillers.map(({ id }) => id), childX.id].sort()
    );
    expect(directUpdates.find(({ recordId }) => recordId === childX.id)).toEqual({
      source: 'user',
      recordId: childX.id,
      oldVersion: childVersion,
      newVersion: childVersion + 1,
      changes: [{ fieldId: fixture.markerFieldId, oldValue: null, newValue: 10_001 }],
    });
    expect(
      events.filter(
        (event) =>
          isRecordUpdatedEvent(event) &&
          event.tableId.toString() === fixture.tableId &&
          event.recordId.toString() === parentA.id &&
          event.source !== 'computed'
      )
    ).toHaveLength(0);
    expect(
      updates.filter(({ source, recordId }) => source === 'computed' && recordId === parentA.id)
    ).toEqual([
      {
        source: 'computed',
        recordId: parentA.id,
        oldVersion: parentVersion,
        newVersion: parentVersion + 1,
        changes: [
          { fieldId: fixture.childrenFieldId, oldValue: [], newValue: null },
          { fieldId: fixture.parentFieldId, oldValue: null, newValue: null },
        ],
      },
    ]);
    expect(
      updates.filter(({ source, recordId }) => source === 'computed' && recordId === childX.id)
    ).toEqual([
      {
        source: 'computed',
        recordId: childX.id,
        oldVersion: childVersion + 1,
        newVersion: childVersion + 2,
        changes: [
          { fieldId: fixture.childrenFieldId, oldValue: null, newValue: null },
          {
            fieldId: fixture.parentFieldId,
            oldValue: { id: parentA.id, title: 'A' },
            newValue: null,
          },
        ],
      },
    ]);
  }, 180_000);

  it('updates 1000 reversed parents with 66000 distinct children without exceeding PostgreSQL bind limits', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self link aggregate targets');
    const parents = await createNamedRecords(
      ctx,
      fixture,
      LARGE_PARENT_COUNT,
      (index) => `00 Parent ${String(index).padStart(4, '0')}`
    );
    const childIdSeed = getRandomString(11);
    const childIdPrefix = `rec${childIdSeed}`;
    const childRecordId = (index: number) => `${childIdPrefix}${String(index).padStart(5, '0')}`;

    // Seed the 66,000 already-linked targets with the same physical values a
    // production insert/update leaves behind: audit/version data, both link
    // caches, the owning FK, and the per-parent link order. Row-order storage
    // is lazy and is not required for this relationship fixture. This setup is
    // direct SQL only; the aggregate-boundary operation below still goes
    // through the real updateRecords HTTP API in one request.
    const inserted = await sql<{ inserted_count: number }>`
      WITH parent_rows AS (
        SELECT
          ${sql.ref('__id')} AS parent_id,
          ${sql.ref(fixture.titleColumn)} AS parent_title,
          ${sql.ref('__created_by')} AS created_by,
          COALESCE(${sql.ref('__last_modified_by')}, ${sql.ref('__created_by')}) AS last_modified_by,
          ROW_NUMBER() OVER (ORDER BY ${sql.ref(fixture.titleColumn)}) - 1 AS parent_index
        FROM ${sql.table(fixture.dbTableName)}
      ), inserted AS (
        INSERT INTO ${sql.table(fixture.dbTableName)} (
          ${sql.ref('__id')},
          ${sql.ref('__created_time')},
          ${sql.ref('__last_modified_time')},
          ${sql.ref('__created_by')},
          ${sql.ref('__last_modified_by')},
          ${sql.ref('__version')},
          ${sql.ref(fixture.titleColumn)},
          ${sql.ref(fixture.parentColumn)},
          ${sql.ref(fixture.ownerColumn)},
          ${sql.ref(fixture.ownerOrderColumn)}
        )
        SELECT
          ${childIdPrefix} || LPAD(series.child_index::text, 5, '0'),
          NOW(),
          NOW(),
          parent_rows.created_by,
          parent_rows.last_modified_by,
          1,
          '10 Child ' || LPAD(series.child_index::text, 5, '0'),
          jsonb_build_object('id', parent_rows.parent_id, 'title', parent_rows.parent_title),
          parent_rows.parent_id,
          (series.child_index % ${CHILDREN_PER_PARENT}) + 1
        FROM generate_series(0, ${LARGE_CHILD_COUNT - 1}) AS series(child_index)
        INNER JOIN parent_rows
          ON parent_rows.parent_index = series.child_index / ${CHILDREN_PER_PARENT}
        RETURNING ${sql.ref('__id')}
      )
      SELECT COUNT(*)::integer AS inserted_count FROM inserted
    `.execute(ctx.testContainer.db);
    expect(inserted.rows).toEqual([{ inserted_count: LARGE_CHILD_COUNT }]);

    const cached = await sql<{ cached_parent_count: number }>`
      WITH grouped_links AS (
        SELECT
          ${sql.ref(fixture.ownerColumn)} AS parent_id,
          jsonb_agg(
            jsonb_build_object(
              'id', ${sql.ref('__id')},
              'title', ${sql.ref(fixture.titleColumn)}
            )
            ORDER BY ${sql.ref(fixture.ownerOrderColumn)}
          ) AS children
        FROM ${sql.table(fixture.dbTableName)}
        WHERE LEFT(${sql.ref('__id')}, LENGTH(${childIdPrefix})) = ${childIdPrefix}
        GROUP BY ${sql.ref(fixture.ownerColumn)}
      ), updated AS (
        UPDATE ${sql.table(fixture.dbTableName)} AS parent
        SET
          ${sql.ref(fixture.childrenColumn)} = grouped_links.children,
          ${sql.ref('__last_modified_time')} = NOW(),
          ${sql.ref('__last_modified_by')} = COALESCE(
            parent.${sql.ref('__last_modified_by')},
            parent.${sql.ref('__created_by')}
          ),
          ${sql.ref('__version')} = parent.${sql.ref('__version')} + 1
        FROM grouped_links
        WHERE parent.${sql.ref('__id')} = grouped_links.parent_id
        RETURNING parent.${sql.ref('__id')}
      )
      SELECT COUNT(*)::integer AS cached_parent_count FROM updated
    `.execute(ctx.testContainer.db);
    expect(cached.rows).toEqual([{ cached_parent_count: LARGE_PARENT_COUNT }]);

    const expectedChildrenByParent = new Map<string, string[]>();
    const expectedOwnerByChild = new Map<string, string>();
    const relationshipUpdates = parents.map((parent, parentIndex) => {
      const firstChildIndex = parentIndex * CHILDREN_PER_PARENT;
      const childIds = Array.from({ length: CHILDREN_PER_PARENT }, (_, index) =>
        childRecordId(firstChildIndex + index)
      );
      expectedChildrenByParent.set(parent.id, childIds);
      for (const childId of childIds) expectedOwnerByChild.set(childId, parent.id);
      return {
        id: parent.id,
        fields: {
          [fixture.childrenFieldId]: childIds.map((id) => ({ id })),
        },
      };
    });
    await ctx.drainOutbox(20);

    // Re-submit every existing desired set in reverse parent order. The marker
    // change makes every row a real update while the links require no new or
    // removed relationship locks, leaving final-state aggregation as the load.
    const result = await ctx.updateRecords({
      tableId: fixture.tableId,
      records: [...relationshipUpdates].reverse().map((update, index) => ({
        id: update.id,
        fields: {
          ...update.fields,
          [fixture.markerFieldId]: index + 1,
        },
      })),
    });
    expect(result.updatedCount).toBe(LARGE_PARENT_COUNT);
    await ctx.drainOutbox(20);

    const parentRecords = await ctx.listRecordsWithoutDrain(fixture.tableId, {
      limit: LARGE_PARENT_COUNT,
      offset: 0,
      sort: [{ fieldId: fixture.titleFieldId, order: 'asc' }],
    });
    const parentRecordById = new Map(parentRecords.map((record) => [record.id, record]));
    const cacheMismatches = parents.flatMap((parent) => {
      const actual = linkIds(parentRecordById.get(parent.id)?.fields[fixture.childrenFieldId]);
      const expected = expectedChildrenByParent.get(parent.id)!;
      return actual.length === expected.length &&
        actual.every((id, index) => id === expected[index])
        ? []
        : [{ parentId: parent.id, expected, actual }];
    });
    expect(parentRecords).toHaveLength(LARGE_PARENT_COUNT);
    expect(cacheMismatches).toEqual([]);

    const physicalOwners = await sql<{ record_id: string; owner_id: string | null }>`
      SELECT ${sql.ref('__id')} AS record_id, ${sql.ref(fixture.ownerColumn)} AS owner_id
      FROM ${sql.table(fixture.dbTableName)}
      WHERE ${sql.ref(fixture.ownerColumn)} IS NOT NULL
    `.execute(ctx.testContainer.db);
    const actualOwnerByChild = new Map(
      physicalOwners.rows.map(({ record_id, owner_id }) => [record_id, owner_id])
    );
    const ownerMismatches = [...expectedOwnerByChild].flatMap(([childId, expectedOwner]) => {
      const actualOwner = actualOwnerByChild.get(childId);
      return actualOwner === expectedOwner ? [] : [{ childId, expectedOwner, actualOwner }];
    });
    expect(physicalOwners.rows).toHaveLength(LARGE_CHILD_COUNT);
    expect(ownerMismatches).toEqual([]);
  }, 600_000);
});

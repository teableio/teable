/* eslint-disable @typescript-eslint/naming-convention */
import { getRandomString } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import { executeUndo } from './undo-redo/shared/undoRedoE2eTestKit';

type SelfOneManyFixture = {
  tableId: string;
  titleFieldId: string;
  childrenFieldId: string;
  parentFieldId: string;
  dbTableName: string;
  ownerColumn: string;
};

type RecordRef = { id: string };

type RawUpdateResult = {
  response: Response;
  body: unknown;
};

const createSelfOneManyFixture = async (
  ctx: SharedTestContext,
  scope: string
): Promise<SelfOneManyFixture> => {
  const titleFieldId = `fld${getRandomString(16)}`;
  const table = await ctx.createTable({
    baseId: ctx.baseId,
    name: `${scope} ${getRandomString(8)}`,
    fields: [{ id: titleFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
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

  return {
    tableId: table.id,
    titleFieldId,
    childrenFieldId,
    parentFieldId,
    dbTableName: tableMeta.db_table_name,
    ownerColumn,
  };
};

const createTransferRecords = async (ctx: SharedTestContext, fixture: SelfOneManyFixture) => {
  const parentA = await ctx.createRecord(fixture.tableId, {
    [fixture.titleFieldId]: 'Parent A',
  });
  const parentB = await ctx.createRecord(fixture.tableId, {
    [fixture.titleFieldId]: 'Parent B',
  });
  const child = await ctx.createRecord(fixture.tableId, {
    [fixture.titleFieldId]: 'Child X',
  });
  await ctx.updateRecord(fixture.tableId, parentA.id, {
    [fixture.childrenFieldId]: [{ id: child.id }],
  });
  await ctx.drainOutbox();
  return { parentA, parentB, child };
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

const readPhysicalOwner = async (
  ctx: SharedTestContext,
  fixture: SelfOneManyFixture,
  record: RecordRef
): Promise<string | null> => {
  const result = await sql<{ owner_id: string | null }>`
    SELECT ${sql.ref(fixture.ownerColumn)} AS owner_id
    FROM ${sql.table(fixture.dbTableName)}
    WHERE ${sql.ref('__id')} = ${record.id}
  `.execute(ctx.testContainer.db);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.owner_id;
};

const updateRecordsRaw = async (
  ctx: SharedTestContext,
  tableId: string,
  records: Array<{ id: string; fields: Record<string, unknown> }>
): Promise<RawUpdateResult> => {
  const response = await fetch(`${ctx.baseUrl}/tables/updateRecords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, records }),
  });
  return {
    response,
    body: await response.json().catch(() => undefined),
  };
};

const assertClientRejection = ({ response, body }: RawUpdateResult) => {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  expect(JSON.stringify(body).toLowerCase()).toMatch(/already|conflict|duplicate|link|validation/);
};

describe('self oneMany restore and atomic ownership transfer (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it('restores both sides of a self-referential two-way oneMany batch through delete undo', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self oneMany restore');
    const parent = await ctx.createRecord(fixture.tableId, {
      [fixture.titleFieldId]: 'Parent A',
    });
    const child = await ctx.createRecord(fixture.tableId, {
      [fixture.titleFieldId]: 'Child B',
    });
    await ctx.updateRecord(fixture.tableId, parent.id, {
      [fixture.childrenFieldId]: [{ id: child.id }],
    });
    await ctx.drainOutbox();

    const beforeDelete = await ctx.listRecords(fixture.tableId);
    expect(linkIds(findRecord(beforeDelete, parent).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(singleLinkId(findRecord(beforeDelete, child).fields[fixture.parentFieldId])).toBe(
      parent.id
    );
    expect(
      singleLinkId(findRecord(beforeDelete, parent).fields[fixture.parentFieldId])
    ).toBeUndefined();
    expect(await readPhysicalOwner(ctx, fixture, parent)).toBeNull();
    expect(await readPhysicalOwner(ctx, fixture, child)).toBe(parent.id);

    await ctx.deleteRecords(fixture.tableId, [parent.id, child.id]);
    expect(await ctx.listRecords(fixture.tableId)).toEqual([]);

    await executeUndo(ctx, fixture.tableId);
    await ctx.drainOutbox();

    const restored = await ctx.listRecords(fixture.tableId);
    expect(restored).toHaveLength(2);
    expect(linkIds(findRecord(restored, parent).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(singleLinkId(findRecord(restored, child).fields[fixture.parentFieldId])).toBe(parent.id);
    expect(
      singleLinkId(findRecord(restored, parent).fields[fixture.parentFieldId])
    ).toBeUndefined();
    expect(await readPhysicalOwner(ctx, fixture, child)).toBe(parent.id);
    expect(await readPhysicalOwner(ctx, fixture, parent)).toBeNull();
  });

  it('atomically releases a child before assigning it to another parent in the same batch', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self oneMany atomic transfer');
    const { parentA, parentB, child } = await createTransferRecords(ctx, fixture);

    const result = await ctx.updateRecords({
      tableId: fixture.tableId,
      records: [
        { id: parentA.id, fields: { [fixture.childrenFieldId]: [] } },
        {
          id: parentB.id,
          fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
        },
      ],
    });
    expect(result.updatedCount).toBe(2);
    await ctx.drainOutbox();

    const records = await ctx.listRecords(fixture.tableId);
    expect(linkIds(findRecord(records, parentA).fields[fixture.childrenFieldId])).toEqual([]);
    expect(linkIds(findRecord(records, parentB).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(singleLinkId(findRecord(records, child).fields[fixture.parentFieldId])).toBe(parentB.id);
    expect(await readPhysicalOwner(ctx, fixture, child)).toBe(parentB.id);
  });

  it('rejects a batch takeover when the current owner retains the child in the final intent', async () => {
    const fixture = await createSelfOneManyFixture(ctx, 'Self oneMany retained owner');
    const { parentA, parentB, child } = await createTransferRecords(ctx, fixture);

    const result = await updateRecordsRaw(ctx, fixture.tableId, [
      {
        id: parentB.id,
        fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
      },
      {
        id: parentA.id,
        fields: { [fixture.childrenFieldId]: [{ id: child.id }] },
      },
    ]);
    assertClientRejection(result);
    await ctx.drainOutbox();

    const records = await ctx.listRecords(fixture.tableId);
    expect(linkIds(findRecord(records, parentA).fields[fixture.childrenFieldId])).toEqual([
      child.id,
    ]);
    expect(linkIds(findRecord(records, parentB).fields[fixture.childrenFieldId])).toEqual([]);
    expect(singleLinkId(findRecord(records, child).fields[fixture.parentFieldId])).toBe(parentA.id);
    expect(await readPhysicalOwner(ctx, fixture, child)).toBe(parentA.id);
  });
});

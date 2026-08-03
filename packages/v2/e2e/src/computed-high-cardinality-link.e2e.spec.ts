/**
 * Sanitized production-shaped regression for high-cardinality bidirectional links.
 *
 * The names and values below are synthetic. The fixture preserves only the behavior that matters:
 * thousands of rows point to one group through a many-many link, so the system-maintained reverse
 * link projection is larger than the scalar computed-cell safety limit.
 */
import { sql } from 'kysely';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const PROFILE_COUNT = 5_200;
const CREATE_BATCH_SIZE = 100;
const DEFAULT_MAX_COMPUTED_CELL_VALUE_BYTES = 262_144;

const isPgliteConnection = () => {
  const connectionString =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;
  return connectionString?.startsWith('pglite://') || connectionString === 'memory://';
};

describe.skipIf(isPgliteConnection())(
  'v2 high-cardinality bidirectional link projection (e2e)',
  () => {
    let ctx: SharedTestContext;
    let fieldSequence = 0;
    let cleanupTableIds: string[] = [];

    const createFieldId = (label: string) => {
      fieldSequence += 1;
      const suffix = `${label}${fieldSequence}`.replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
      return `fld${suffix.padEnd(16, '0')}`;
    };

    const createRecordsInBatches = async (
      tableId: string,
      rows: Array<{ fields: Record<string, unknown> }>
    ) => {
      const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
      for (let offset = 0; offset < rows.length; offset += CREATE_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + CREATE_BATCH_SIZE);
        created.push(...(await ctx.createRecords(tableId, batch)));
      }
      return created;
    };

    beforeAll(async () => {
      ctx = await getSharedTestContext({ dbMode: 'postgres' });
      expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
    }, 120_000);

    afterEach(async () => {
      for (const tableId of [...cleanupTableIds].reverse()) {
        await ctx.deleteTable(tableId, { mode: 'permanent' });
      }
      cleanupTableIds = [];
    });

    it('persists an oversized reverse projection without creating a dead letter', async () => {
      const groupNameFieldId = createFieldId('groupName');
      const groupTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `SyntheticGroups_${Date.now()}`,
        fields: [
          {
            type: 'singleLineText',
            id: groupNameFieldId,
            name: 'Group name',
            isPrimary: true,
          },
        ],
        views: [{ type: 'grid' }],
      });
      cleanupTableIds.push(groupTable.id);
      const groupRecord = await ctx.createRecord(groupTable.id, {
        [groupNameFieldId]: 'Synthetic group 001',
      });

      const profileNameFieldId = createFieldId('profileName');
      const groupLinkFieldId = createFieldId('groupLink');
      const profileTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `SyntheticProfiles_${Date.now()}`,
        fields: [
          {
            type: 'singleLineText',
            id: profileNameFieldId,
            name: 'Profile name',
            isPrimary: true,
          },
          {
            type: 'link',
            id: groupLinkFieldId,
            name: 'Groups',
            options: {
              relationship: 'manyMany',
              foreignTableId: groupTable.id,
              lookupFieldId: groupNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      cleanupTableIds.push(profileTable.id);

      const refreshedGroupTable = await ctx.getTableById(groupTable.id);
      const reverseLinkFieldId = refreshedGroupTable.fields.find(
        (field) => field.type === 'link' && field.options?.foreignTableId === profileTable.id
      )?.id;
      expect(reverseLinkFieldId).toBeDefined();

      const profiles = Array.from({ length: PROFILE_COUNT }, (_, index) => ({
        fields: {
          [profileNameFieldId]: `Synthetic profile ${index.toString().padStart(5, '0')} for load fixture`,
          [groupLinkFieldId]: [{ id: groupRecord.id }],
        },
      }));
      const createdProfiles = await createRecordsInBatches(profileTable.id, profiles);
      expect(createdProfiles).toHaveLength(PROFILE_COUNT);

      const pendingTasks = await ctx.testContainer.db
        .selectFrom('computed_update_outbox')
        .select(['status', 'affected_field_ids'])
        .where('base_id', '=', ctx.baseId)
        .execute();
      expect(
        pendingTasks.some(
          (task) =>
            task.status === 'pending' && task.affected_field_ids.includes(reverseLinkFieldId!)
        )
      ).toBe(true);

      await ctx.testContainer.processOutbox();

      const remainingTasks = await ctx.testContainer.db
        .selectFrom('computed_update_outbox')
        .select(['id', 'status', 'affected_field_ids'])
        .where('base_id', '=', ctx.baseId)
        .execute();
      expect(
        remainingTasks.filter((task) => task.affected_field_ids.includes(reverseLinkFieldId!))
      ).toEqual([]);

      const deadLetters = await ctx.testContainer.db
        .selectFrom('computed_update_dead_letter')
        .select(['id', 'last_error', 'affected_field_ids'])
        .where('base_id', '=', ctx.baseId)
        .execute();
      expect(
        deadLetters.filter((task) => task.affected_field_ids.includes(reverseLinkFieldId!))
      ).toEqual([]);

      const [storedGroup] = await ctx.listRecordsWithoutDrain(groupTable.id, { limit: 1 });
      const reverseLinks = storedGroup?.fields[reverseLinkFieldId!] as
        | Array<{ id: string; title?: string }>
        | undefined;
      expect(reverseLinks).toHaveLength(PROFILE_COUNT);
      expect(new TextEncoder().encode(JSON.stringify(reverseLinks)).byteLength).toBeGreaterThan(
        DEFAULT_MAX_COMPUTED_CELL_VALUE_BYTES
      );

      const tableStorage = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', groupTable.id)
        .executeTakeFirstOrThrow();
      const fieldStorage = await ctx.testContainer.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', reverseLinkFieldId!)
        .executeTakeFirstOrThrow();
      const storedBytes = await sql<{ bytes: number }>`
      SELECT octet_length(${sql.ref(fieldStorage.db_field_name)}::text)::int AS bytes
      FROM ${sql.table(tableStorage.db_table_name)}
      WHERE "__id" = ${groupRecord.id}
    `.execute(ctx.testContainer.db);
      expect(storedBytes.rows.at(0)?.bytes).toBeGreaterThan(DEFAULT_MAX_COMPUTED_CELL_VALUE_BYTES);

      const junctionTables = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
        AND table_name LIKE ${'junction_%'}
    `.execute(ctx.testContainer.db);
      const junctionTableName = junctionTables.rows.find((row) =>
        row.table_name.includes(groupLinkFieldId)
      )?.table_name;
      expect(junctionTableName).toBeDefined();
      const junctionRows = await sql<{ count: number }>`
      SELECT count(*)::int AS count
      FROM ${sql.table(`${ctx.baseId}.${junctionTableName!}`)}
    `.execute(ctx.testContainer.db);
      expect(junctionRows.rows.at(0)?.count).toBe(PROFILE_COUNT);
    }, 180_000);
  }
);

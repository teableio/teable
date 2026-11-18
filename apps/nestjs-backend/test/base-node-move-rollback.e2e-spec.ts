/* eslint-disable sonarjs/no-duplicate-string */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseNodeVo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  createBaseNode,
  getBaseNodeList,
  moveBaseNode,
  updateDbTableName,
} from '@teable/openapi';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import type { ITableMovePlan } from '../src/features/table/table-move.service';
import { TableMoveService } from '../src/features/table/table-move.service';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  getFields,
  getRecords,
  getTable,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const qualifiedName = (name: string) => name.split('.').map(quoteIdent).join('.');

type ICatalogRelation = { oid: string; name: string; kind: string };

interface IRollbackFixture {
  suffix: string;
  sourceBaseId: string;
  targetBaseId: string;
  folder: IBaseNodeVo;
  plan: ITableMovePlan;
  originalSourceCatalog: ICatalogRelation[];
  assertRestored: () => Promise<void>;
}

/**
 * Requires a disposable PostgreSQL database, CREATE EVENT TRIGGER (superuser),
 * and the normal CE e2e seed. The default route shares the metadata transaction,
 * so this suite proves rollback after physical DDL and metadata COMMIT failures.
 * Fault triggers have unique names and act only on this fixture's OIDs or IDs.
 * The runner must not point its database URL at production or user data.
 */
describe('BaseNode physical DDL rollback in the shared metadata transaction (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dataDb: KnexType;
  let spaceId: string | undefined;
  const internalSchema = `t8559_rollback_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    dataDb = Knex({ client: 'pg', connection: metaDatabaseUrl });
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await dataDb.raw('CREATE SCHEMA ??', [internalSchema]);
    spaceId = (await createSpace({ name: internalSchema })).id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (spaceId) await permanentDeleteSpace(spaceId);
    } finally {
      try {
        if (dataDb) await dataDb.raw(`DROP SCHEMA IF EXISTS ${quoteIdent(internalSchema)} CASCADE`);
      } finally {
        await Promise.all([dataDb?.destroy(), app?.close()]);
      }
    }
  }, 60_000);

  const catalog = async (baseId: string): Promise<ICatalogRelation[]> => {
    const result = await dataDb.raw(
      `SELECT c.oid::text AS oid, c.relname AS name, c.relkind::text AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ? ORDER BY c.relname`,
      [baseId]
    );
    return result.rows;
  };

  const withFixture = async (run: (fixture: IRollbackFixture) => Promise<void>) => {
    const bases: string[] = [];
    let cleanupFailure: PromiseRejectedResult | undefined;
    try {
      const fixture = await makeFixture(bases);
      await run(fixture);
    } finally {
      const cleanup = await Promise.allSettled(bases.reverse().map(permanentDeleteBase));
      cleanupFailure = cleanup.find((result) => result.status === 'rejected');
    }
    if (cleanupFailure) throw cleanupFailure.reason;
  };

  const makeFixture = async (bases: string[]): Promise<IRollbackFixture> => {
    const suffix = randomUUID().replace(/-/g, '');
    const sourceBaseId = (
      await createBase({ name: `rollback source ${suffix}`, spaceId: spaceId! })
    ).id;
    bases.push(sourceBaseId);
    const targetBaseId = (
      await createBase({ name: `rollback target ${suffix}`, spaceId: spaceId! })
    ).id;
    bases.push(targetBaseId);
    const folder = (
      await createBaseNode(sourceBaseId, {
        resourceType: BaseNodeResourceType.Folder,
        name: `rollback ${suffix}`,
      })
    ).data;
    const tableNode = async (baseId: string, name: string, parentId?: string) =>
      (
        await createBaseNode(baseId, {
          resourceType: BaseNodeResourceType.Table,
          name,
          parentId,
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid', type: ViewType.Grid }],
        })
      ).data;
    const first = await tableNode(sourceBaseId, 'First', folder.id);
    const second = await tableNode(sourceBaseId, 'Second', folder.id);
    const target = await tableNode(targetBaseId, 'Target sentinel');
    const basename = `collision_${suffix}`;
    await updateDbTableName(sourceBaseId, first.resourceId, { dbTableName: basename });
    await updateDbTableName(targetBaseId, target.resourceId, { dbTableName: basename });
    const firstTable = await getTable(sourceBaseId, first.resourceId);
    const targetTable = await getTable(targetBaseId, target.resourceId);
    const firstPrimary = (await getFields(first.resourceId)).find((field) => field.isPrimary)!;
    const secondPrimary = (await getFields(second.resourceId)).find((field) => field.isPrimary)!;
    const targetPrimary = (await getFields(target.resourceId)).find((field) => field.isPrimary)!;
    const link = await createField(first.resourceId, {
      name: 'Companion',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: second.resourceId,
        lookupFieldId: secondPrimary.id,
      },
    });
    const secondRecords = await createRecords(second.resourceId, {
      records: [{ fields: { [secondPrimary.id]: `companion ${suffix}` } }],
    });
    await createRecords(first.resourceId, {
      records: [
        {
          fields: {
            [firstPrimary.id]: `source ${suffix}`,
            [link.id]: [{ id: secondRecords.records[0].id }],
          },
        },
      ],
    });
    await createRecords(target.resourceId, {
      records: [{ fields: { [targetPrimary.id]: `target ${suffix}` } }],
    });
    // SET SCHEMA carries owned sequences and indexes with the table. Collide
    // both names too, so rollback must restore the real planner's associated
    // relation renames as well as the table basename rename.
    const indexName = `owned_index_${suffix}`;
    const sequenceName = `owned_seq_${suffix}`;
    for (const table of [firstTable, targetTable]) {
      const schema = table.dbTableName.split('.')[0];
      await dataDb.raw(
        `CREATE INDEX ${quoteIdent(indexName)} ON ${qualifiedName(table.dbTableName)} ("__id")`
      );
      await dataDb.raw(
        `CREATE SEQUENCE ${quoteIdent(schema)}.${quoteIdent(sequenceName)}
         OWNED BY ${qualifiedName(table.dbTableName)}."__id"`
      );
    }
    const tableIds = [first.resourceId, second.resourceId];
    // Consume the production plan, including future associated-relation entries.
    const plan = await app.get(TableMoveService).prepareMove(sourceBaseId, targetBaseId, tableIds);
    expect(plan.tables).toHaveLength(2);
    expect(plan.junctions).toHaveLength(1);
    expect(plan.tables.find((table) => table.id === first.resourceId)?.newDbTableName).not.toBe(
      `${targetBaseId}.${basename}`
    );
    const originalSourceCatalog = await catalog(sourceBaseId);
    const originalTargetCatalog = await catalog(targetBaseId);
    const originalMeta = await prisma.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, baseId: true, dbTableName: true, version: true },
      orderBy: { id: 'asc' },
    });
    const originalLinks = await prisma.field.findMany({
      where: { tableId: { in: tableIds }, type: FieldType.Link },
      select: { id: true, tableId: true, options: true },
      orderBy: { id: 'asc' },
    });
    const recordSnapshot = async (tableId: string) =>
      (await getRecords(tableId, { fieldKeyType: FieldKeyType.Id })).records;
    const originalRecords = await Promise.all(
      [first.resourceId, second.resourceId, target.resourceId].map(recordSnapshot)
    );
    const assertRestored = async () => {
      expect(await catalog(sourceBaseId)).toEqual(originalSourceCatalog);
      // Includes every preexisting target table/index/sequence OID and name;
      // exact equality also proves there are no leftover moved target copies.
      expect(await catalog(targetBaseId)).toEqual(originalTargetCatalog);
      expect(
        await prisma.tableMeta.findMany({
          where: { id: { in: tableIds } },
          select: { id: true, baseId: true, dbTableName: true, version: true },
          orderBy: { id: 'asc' },
        })
      ).toEqual(originalMeta);
      expect(
        await prisma.field.findMany({
          where: { tableId: { in: tableIds }, type: FieldType.Link },
          select: { id: true, tableId: true, options: true },
          orderBy: { id: 'asc' },
        })
      ).toEqual(originalLinks);
      expect(
        await Promise.all(
          [first.resourceId, second.resourceId, target.resourceId].map(recordSnapshot)
        )
      ).toEqual(originalRecords);
      const sourceNodes = (await getBaseNodeList(sourceBaseId)).data;
      const targetNodes = (await getBaseNodeList(targetBaseId)).data;
      for (const node of [folder, first, second]) {
        expect(sourceNodes.find((candidate) => candidate.id === node.id)).toMatchObject({
          id: node.id,
          parentId: node.parentId,
        });
        expect(targetNodes.some((candidate) => candidate.id === node.id)).toBe(false);
      }
    };
    return {
      suffix,
      sourceBaseId,
      targetBaseId,
      folder,
      plan,
      originalSourceCatalog,
      assertRestored,
    };
  };

  it('rolls back earlier table DDL when the later junction DDL fails through the move API', async () => {
    await withFixture(async (fixture) => {
      const { suffix, plan, sourceBaseId, targetBaseId, folder } = fixture;
      const triggerName = `t8559_ddl_${suffix}`;
      const functionName = `${quoteIdent(internalSchema)}.${quoteIdent(triggerName)}`;
      const marker = `${quoteIdent(internalSchema)}.${quoteIdent(`seen_${suffix}`)}`;
      const junctionBasename = plan.junctions[0].oldName.split('.')[1];
      const junction = fixture.originalSourceCatalog.find(
        (relation) => relation.name === junctionBasename
      )!;
      const tableOids = plan.tables.map(
        (table) =>
          fixture.originalSourceCatalog.find(
            (relation) => relation.name === table.oldDbTableName.split('.')[1]
          )!.oid
      );
      try {
        await dataDb.raw(`CREATE SEQUENCE ${marker}`);
        await dataDb.raw(`
          CREATE FUNCTION ${functionName}() RETURNS event_trigger LANGUAGE plpgsql AS $body$
          DECLARE command record;
          BEGIN
            FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
              IF command.objid = ${quoteLiteral(junction.oid)}::oid
                AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.oid = ANY(ARRAY[${tableOids.map(quoteLiteral).join(',')}]::oid[])
                       AND n.nspname = ${quoteLiteral(targetBaseId)}) = ${tableOids.length}
              THEN
                -- Sequence increments survive transaction rollback: this proves
                -- both earlier tables had reached the target before the fault.
                PERFORM nextval(${quoteLiteral(marker)}::regclass);
                RAISE EXCEPTION 't8559_late_ddl_${suffix}';
              END IF;
            END LOOP;
          END;
          $body$`);
        await dataDb.raw(`
          CREATE EVENT TRIGGER ${quoteIdent(triggerName)} ON ddl_command_end
          WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION ${functionName}()`);
        await expect(moveBaseNode(sourceBaseId, folder.id, { targetBaseId })).rejects.toMatchObject(
          {
            status: 500,
          }
        );
        expect((await dataDb.raw(`SELECT is_called FROM ${marker}`)).rows).toEqual([
          { is_called: true },
        ]);
        await fixture.assertRestored();
      } finally {
        await dataDb.raw(`DROP EVENT TRIGGER IF EXISTS ${quoteIdent(triggerName)}`);
        await dataDb.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
        await dataDb.raw(`DROP SEQUENCE IF EXISTS ${marker}`);
      }
    });
  }, 60_000);

  it('rejects a deferred metadata commit failure instead of reporting a moved node as missing', async () => {
    await withFixture(async (fixture) => {
      const { suffix, plan, sourceBaseId, targetBaseId, folder } = fixture;
      const triggerName = `t8559_commit_${suffix}`;
      const functionName = `${quoteIdent(internalSchema)}.${quoteIdent(triggerName)}`;
      const marker = `${quoteIdent(internalSchema)}.${quoteIdent(`commit_seen_${suffix}`)}`;
      const metadataSchema = new URL(metaDatabaseUrl!).searchParams.get('schema') ?? 'public';
      const metadataTable = `${quoteIdent(metadataSchema)}."table_meta"`;
      const movedNames = new Set([
        ...plan.tables.map((table) => table.oldDbTableName.split('.')[1]),
        ...plan.junctions.map((junction) => junction.oldName.split('.')[1]),
      ]);
      const movedOids = fixture.originalSourceCatalog
        .filter((relation) => movedNames.has(relation.name))
        .map((relation) => relation.oid);
      let primaryError: unknown;
      let succeeded = false;
      try {
        await dataDb.raw(`CREATE SEQUENCE ${marker}`);
        await dataDb.raw(`
          CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $body$
          BEGIN
            IF NEW.id = ${quoteLiteral(plan.tables[0].id)}
              AND NEW.base_id = ${quoteLiteral(targetBaseId)}
            THEN
              IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE c.oid = ANY(ARRAY[${movedOids.map(quoteLiteral).join(',')}]::oid[])
                    AND n.nspname = ${quoteLiteral(targetBaseId)}) = ${movedOids.length}
              THEN
                -- Survives rollback and proves every physical move preceded COMMIT.
                PERFORM nextval(${quoteLiteral(marker)}::regclass);
              END IF;
              RAISE EXCEPTION 't8559_metadata_commit_${suffix}';
            END IF;
            RETURN NEW;
          END;
          $body$`);
        await dataDb.raw(`
          CREATE CONSTRAINT TRIGGER ${quoteIdent(triggerName)} AFTER UPDATE ON ${metadataTable}
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
        await expect(moveBaseNode(sourceBaseId, folder.id, { targetBaseId })).rejects.toMatchObject(
          {
            status: 500,
          }
        );
        expect((await dataDb.raw(`SELECT is_called FROM ${marker}`)).rows).toEqual([
          { is_called: true },
        ]);
        await fixture.assertRestored();
        succeeded = true;
      } catch (error) {
        primaryError = error;
      }
      // Dropping this unique function also drops only its dependent trigger.
      const cleanup = await Promise.allSettled([
        dataDb.raw(`DROP FUNCTION IF EXISTS ${functionName}() CASCADE`),
        dataDb.raw(`DROP SEQUENCE IF EXISTS ${marker}`),
      ]);
      if (!succeeded) throw primaryError;
      const cleanupFailure = cleanup.find((result) => result.status === 'rejected');
      if (cleanupFailure?.status === 'rejected') throw cleanupFailure.reason;
    });
  }, 60_000);
});

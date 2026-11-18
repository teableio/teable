/* eslint-disable sonarjs/no-duplicate-string */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, ViewType } from '@teable/core';
import type { IBaseNodeVo, ITableQueryIndexPolicyRo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  TableIndex,
  createBase,
  createBaseNode,
  getTableActivatedIndex,
  getTableQueryIndexPolicy,
  moveBaseNode,
  toggleTableIndex,
  updateTableQueryIndexPolicy,
} from '@teable/openapi';
import { DatabaseRouter } from '../src/global/database-router.service';
import {
  convertField,
  createRecords,
  deleteField,
  getFields,
  getRecords,
  getTable,
  initApp,
  permanentDeleteBase,
} from './utils/init-app';

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

type IOwnedIndex = {
  oid: string;
  name: string;
  schema: string;
  tableOid: string;
  tableName: string;
  columns: string[];
};

interface IMoveIndexFixture {
  sourceBaseId: string;
  targetBaseId: string;
  sourceNode: IBaseNodeVo;
  indexed: IFieldVo;
  policy: ITableQueryIndexPolicyRo;
  sourceRecordId: string;
  assertTargetUnchanged: () => Promise<void>;
}

/**
 * Uses the normal CE seed and disposable bases. The failed-conversion case also
 * requires PostgreSQL CREATE EVENT TRIGGER privileges on the disposable database.
 */
describe('BaseNode move with a managed index name collision (e2e)', () => {
  let app: INestApplication;
  let databaseRouter: DatabaseRouter;

  beforeAll(async () => {
    app = (await initApp()).app;
    databaseRouter = app.get(DatabaseRouter);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const ownedIndexes = async (baseId: string, tableId: string): Promise<IOwnedIndex[]> => {
    const table = await getTable(baseId, tableId);
    const [schema, tableName] = table.dbTableName.split('.');
    return databaseRouter.queryDataPrismaForTable<IOwnedIndex[]>(
      tableId,
      `SELECT index_relation.oid::text AS oid, index_relation.relname::text AS name,
        index_namespace.nspname::text AS schema, owner.oid::text AS "tableOid",
        owner.relname::text AS "tableName",
        ARRAY(SELECT attribute.attname::text
          FROM unnest(index_entry.indkey) WITH ORDINALITY AS key(attnum, ordinality)
          JOIN pg_catalog.pg_attribute attribute
            ON attribute.attrelid = owner.oid AND attribute.attnum = key.attnum
          ORDER BY key.ordinality) AS columns
       FROM pg_catalog.pg_index index_entry
       JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_entry.indexrelid
       JOIN pg_catalog.pg_namespace index_namespace
         ON index_namespace.oid = index_relation.relnamespace
       JOIN pg_catalog.pg_class owner ON owner.oid = index_entry.indrelid
       JOIN pg_catalog.pg_namespace owner_namespace ON owner_namespace.oid = owner.relnamespace
       WHERE owner_namespace.nspname = $1 AND owner.relname = $2
       ORDER BY index_relation.relname`,
      schema,
      tableName
    );
  };

  const makeFixture = async (
    bases: string[],
    kind: 'query' | 'search'
  ): Promise<IMoveIndexFixture> => {
    const suffix = randomUUID().replaceAll('-', '');
    const spaceId = globalThis.testConfig.spaceId;
    const sourceBaseId = (await createBase({ name: `query move source ${suffix}`, spaceId })).data
      .id;
    bases.push(sourceBaseId);
    const targetBaseId = (await createBase({ name: `query move target ${suffix}`, spaceId })).data
      .id;
    bases.push(targetBaseId);

    const sourceNode = (
      await createBaseNode(sourceBaseId, {
        resourceType: BaseNodeResourceType.Table,
        name: `Moving ${suffix}`,
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Indexed', type: FieldType.SingleLineText },
        ],
        views: [{ name: 'Grid', type: ViewType.Grid }],
      })
    ).data;
    const targetNode = (
      await createBaseNode(targetBaseId, {
        resourceType: BaseNodeResourceType.Table,
        name: `Sentinel ${suffix}`,
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid', type: ViewType.Grid }],
      })
    ).data;
    const sourceFields = await getFields(sourceNode.resourceId);
    const sourcePrimary = sourceFields.find((field) => field.isPrimary)!;
    const indexed = sourceFields.find((field) => field.name === 'Indexed')!;
    expect(indexed.isPrimary).not.toBe(true);
    const targetPrimary = (await getFields(targetNode.resourceId)).find(
      (field) => field.isPrimary
    )!;
    const sourceRecord = await createRecords(sourceNode.resourceId, {
      records: [{ fields: { [sourcePrimary.id]: `source ${suffix}`, [indexed.id]: '12' } }],
    });
    await createRecords(targetNode.resourceId, {
      records: [{ fields: { [targetPrimary.id]: `preserved sentinel ${suffix}` } }],
    });

    const policy: ITableQueryIndexPolicyRo = {
      indexes: [
        {
          id: 'move_order',
          columns: [{ kind: 'field', fieldId: indexed.id, direction: 'desc', nulls: 'last' }],
        },
      ],
    };
    if (kind === 'query') {
      const configured = await updateTableQueryIndexPolicy(
        sourceBaseId,
        sourceNode.resourceId,
        policy
      );
      expect(configured.data).toEqual({ version: 1, ...policy });
    } else {
      await toggleTableIndex(sourceBaseId, sourceNode.resourceId, { type: TableIndex.search });
      expect((await getTableActivatedIndex(sourceBaseId, sourceNode.resourceId)).data).toContain(
        TableIndex.search
      );
    }
    const managedIndexes = (await ownedIndexes(sourceBaseId, sourceNode.resourceId)).filter(
      (index) =>
        kind === 'query'
          ? index.name.startsWith('idx_qry_')
          : index.name.startsWith('idx_trgm_') && index.name.endsWith(`_${indexed.id}`)
    );
    expect(managedIndexes).toHaveLength(1);
    const originalIndex = managedIndexes[0];
    if (kind === 'query') expect(originalIndex.columns).toEqual([indexed.dbFieldName]);

    // Discover the physical name from its owner instead of duplicating the naming algorithm.
    // The target index belongs to a different table, but occupies exactly that schema name.
    const targetTable = await getTable(targetBaseId, targetNode.resourceId);
    await databaseRouter.executeDataPrismaForTable(
      targetNode.resourceId,
      `CREATE INDEX ${quoteIdentifier(originalIndex.name)} ON ${targetTable.dbTableName.split('.').map(quoteIdentifier).join('.')} (${quoteIdentifier(targetPrimary.dbFieldName)})`
    );
    const targetIndex = (await ownedIndexes(targetBaseId, targetNode.resourceId)).find(
      (index) => index.name === originalIndex.name
    );
    expect(targetIndex).toBeDefined();
    expect(targetIndex!.oid).not.toBe(originalIndex.oid);
    const targetRecords = (
      await getRecords(targetNode.resourceId, { fieldKeyType: FieldKeyType.Id })
    ).records;
    expect(targetRecords).toHaveLength(1);
    expect(targetRecords[0].fields[targetPrimary.id]).toBe(`preserved sentinel ${suffix}`);

    const assertTargetUnchanged = async () => {
      const currentIndex = (await ownedIndexes(targetBaseId, targetNode.resourceId)).find(
        (index) => index.name === originalIndex.name
      );
      // Exact identity includes the pre-existing OID, schema, name and owning table.
      expect(currentIndex).toEqual(targetIndex);
      expect(
        (await getRecords(targetNode.resourceId, { fieldKeyType: FieldKeyType.Id })).records
      ).toEqual(targetRecords);
    };

    return {
      sourceBaseId,
      targetBaseId,
      sourceNode,
      indexed,
      policy,
      sourceRecordId: sourceRecord.records[0].id,
      assertTargetUnchanged,
    };
  };

  const withMovedFixture = async (
    run: (fixture: IMoveIndexFixture) => Promise<void>,
    kind: 'query' | 'search' = 'query'
  ) => {
    const bases: string[] = [];
    const operation = await Promise.allSettled([
      (async () => {
        const fixture = await makeFixture(bases, kind);
        const moved = await moveBaseNode(fixture.sourceBaseId, fixture.sourceNode.id, {
          targetBaseId: fixture.targetBaseId,
        });
        expect(moved.data.id).toBe(fixture.sourceNode.id);
        expect(moved.data.resourceId).toBe(fixture.sourceNode.resourceId);
        await run(fixture);
      })(),
    ]);
    const cleanup = await Promise.allSettled(
      bases.reverse().map(async (baseId) => {
        try {
          await permanentDeleteBase(baseId);
        } catch (error) {
          throw new AggregateError(
            [error],
            `Failed to delete query-index move fixture base ${baseId}`
          );
        }
      })
    );
    const failures = [...operation, ...cleanup].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failures.length === 1) throw failures[0].reason;
    if (failures.length > 1) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Query-index move operation and fixture cleanup failed'
      );
    }
  };

  it('preserves caller query-index IDs when replacing the policy after a colliding move', async () => {
    await withMovedFixture(async (fixture) => {
      const { targetBaseId, sourceNode, policy, indexed } = fixture;
      const expectedPolicy = { version: 1, ...policy };
      expect((await getTableQueryIndexPolicy(targetBaseId, sourceNode.resourceId)).data).toEqual(
        expectedPolicy
      );
      const replacement = await updateTableQueryIndexPolicy(
        targetBaseId,
        sourceNode.resourceId,
        policy
      );
      expect(replacement.data).toEqual(expectedPolicy);
      expect((await getTableQueryIndexPolicy(targetBaseId, sourceNode.resourceId)).data).toEqual(
        expectedPolicy
      );
      const managedIndexes = (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter(
        (index) => index.name.startsWith('idx_qry_')
      );
      expect(managedIndexes).toHaveLength(1);
      expect(managedIndexes[0].schema).toBe(targetBaseId);
      expect(managedIndexes[0].columns).toEqual([indexed.dbFieldName]);
      await fixture.assertTargetUnchanged();
    });
  }, 60_000);

  it('preserves the foreign index when converting the indexed field after a colliding move', async () => {
    await withMovedFixture(async (fixture) => {
      const { targetBaseId, sourceNode, indexed, sourceRecordId } = fixture;
      // Exercise the destructive consumer before GET can expose the stale physical name.
      const converted = await convertField(sourceNode.resourceId, indexed.id, {
        type: FieldType.Number,
      });
      expect(converted.type).toBe(FieldType.Number);
      const records = await getRecords(sourceNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(records.records).toHaveLength(1);
      expect(records.records[0].id).toBe(sourceRecordId);
      expect(records.records[0].fields[indexed.id]).toBe(12);
      await fixture.assertTargetUnchanged();
      expect((await getTableQueryIndexPolicy(targetBaseId, sourceNode.resourceId)).data).toEqual({
        version: 1,
        indexes: [],
      });
      expect(
        (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter((index) =>
          index.name.startsWith('idx_qry_')
        )
      ).toEqual([]);
    });
  }, 60_000);

  it('preserves the foreign index when deleting the indexed field after a colliding move', async () => {
    await withMovedFixture(async (fixture) => {
      const { targetBaseId, sourceNode, indexed } = fixture;
      // Do not assert GET first: deletion must reach the real index-removal path.
      await deleteField(sourceNode.resourceId, indexed.id);
      expect((await getFields(sourceNode.resourceId)).map((field) => field.id)).not.toContain(
        indexed.id
      );
      await fixture.assertTargetUnchanged();
      expect((await getTableQueryIndexPolicy(targetBaseId, sourceNode.resourceId)).data).toEqual({
        version: 1,
        indexes: [],
      });
      expect(
        (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter((index) =>
          index.name.startsWith('idx_qry_')
        )
      ).toEqual([]);
    });
  }, 60_000);

  it('preserves the foreign search index when deleting the indexed field after a colliding move', async () => {
    await withMovedFixture(async (fixture) => {
      const { targetBaseId, sourceNode, indexed } = fixture;
      await deleteField(sourceNode.resourceId, indexed.id);
      expect((await getFields(sourceNode.resourceId)).map((field) => field.id)).not.toContain(
        indexed.id
      );
      await fixture.assertTargetUnchanged();
      // The primary text field still has a search index, keeping search active during deletion.
      expect((await getTableActivatedIndex(targetBaseId, sourceNode.resourceId)).data).toContain(
        TableIndex.search
      );
      expect(
        (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter((index) =>
          index.name.endsWith(`_${indexed.id}`)
        )
      ).toEqual([]);
    }, 'search');
  }, 60_000);

  it('restores the actual managed index and caller policy when field conversion fails after a colliding move', async () => {
    await withMovedFixture(async (fixture) => {
      const { targetBaseId, sourceNode, indexed, sourceRecordId, policy } = fixture;
      const beforeIndexes = (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter(
        (index) => index.name.startsWith('idx_qry_')
      );
      expect(beforeIndexes).toHaveLength(1);
      const sourceIndex = beforeIndexes[0];
      expect(sourceIndex.columns).toEqual([indexed.dbFieldName]);
      const suffix = randomUUID().replaceAll('-', '');
      const triggerName = `t8559_query_convert_${suffix}`;
      const functionName = `${quoteIdentifier(targetBaseId)}.${quoteIdentifier(`query_fault_${suffix}`)}`;
      const marker = `${quoteIdentifier(targetBaseId)}.${quoteIdentifier(`query_seen_${suffix}`)}`;
      const operation = await Promise.allSettled([
        (async () => {
          await databaseRouter.executeDataPrismaForTable(
            sourceNode.resourceId,
            `CREATE SEQUENCE ${marker}`
          );
          await databaseRouter.executeDataPrismaForTable(
            sourceNode.resourceId,
            `CREATE FUNCTION ${functionName}() RETURNS event_trigger LANGUAGE plpgsql AS $body$
             DECLARE command record;
             BEGIN
               FOR command IN SELECT * FROM pg_catalog.pg_event_trigger_ddl_commands() LOOP
                 IF command.classid = 'pg_catalog.pg_class'::regclass
                   AND command.objid = '${sourceIndex.tableOid}'::oid
                   AND NOT EXISTS (
                     SELECT 1 FROM pg_catalog.pg_class WHERE oid = '${sourceIndex.oid}'::oid
                   )
                 THEN
                   -- nextval survives the failed ALTER transaction, proving that the
                   -- actual source-owned index was absent when the fault was raised.
                   PERFORM nextval('${marker}'::regclass);
                   RAISE EXCEPTION 't8559_after_query_index_predrop_${suffix}';
                 END IF;
               END LOOP;
             END;
             $body$`
          );
          await databaseRouter.executeDataPrismaForTable(
            sourceNode.resourceId,
            `CREATE EVENT TRIGGER ${quoteIdentifier(triggerName)} ON ddl_command_end
             WHEN TAG IN ('ALTER TABLE') EXECUTE FUNCTION ${functionName}()`
          );

          // The helper checks the expected HTTP status and rejects an unexpected success.
          await convertField(sourceNode.resourceId, indexed.id, { type: FieldType.Number }, 500);
          expect(
            await databaseRouter.queryDataPrismaForTable<{ isCalled: boolean }[]>(
              sourceNode.resourceId,
              `SELECT is_called AS "isCalled" FROM ${marker}`
            )
          ).toEqual([{ isCalled: true }]);

          const restoredField = (await getFields(sourceNode.resourceId)).find(
            (field) => field.id === indexed.id
          );
          expect(restoredField).toMatchObject({
            type: FieldType.SingleLineText,
            dbFieldName: indexed.dbFieldName,
          });
          const records = await getRecords(sourceNode.resourceId, {
            fieldKeyType: FieldKeyType.Id,
          });
          expect(records.records).toHaveLength(1);
          expect(records.records[0].id).toBe(sourceRecordId);
          expect(records.records[0].fields[indexed.id]).toBe('12');
          expect(
            (await getTableQueryIndexPolicy(targetBaseId, sourceNode.resourceId)).data
          ).toEqual({
            version: 1,
            ...policy,
          });
          const restoredIndexes = (await ownedIndexes(targetBaseId, sourceNode.resourceId)).filter(
            (index) => index.name.startsWith('idx_qry_')
          );
          expect(restoredIndexes).toHaveLength(1);
          // DROP/CREATE may change the index OID; its actual physical identity and
          // owning table must match the disambiguated index captured after the move.
          expect(restoredIndexes[0]).toEqual({ ...sourceIndex, oid: expect.any(String) });
          await fixture.assertTargetUnchanged();
        })(),
      ]);

      // Remove the global trigger before its function and marker, and before the
      // enclosing fixture deletes either base. Preserve every cleanup failure.
      const cleanupFailures: PromiseRejectedResult[] = [];
      for (const sql of [
        `DROP EVENT TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`,
        `DROP FUNCTION IF EXISTS ${functionName}()`,
        `DROP SEQUENCE IF EXISTS ${marker}`,
      ]) {
        const [result] = await Promise.allSettled([
          databaseRouter.executeDataPrismaForTable(sourceNode.resourceId, sql),
        ]);
        if (result.status === 'rejected') cleanupFailures.push(result);
      }
      const failures = [...operation, ...cleanupFailures].filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failures.length === 1) throw failures[0].reason;
      if (failures.length > 1) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          'Failed-conversion assertion or event-trigger cleanup failed'
        );
      }
    });
  }, 60_000);
});

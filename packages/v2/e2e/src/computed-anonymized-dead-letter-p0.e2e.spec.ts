/**
 * Sanitized production-shaped regressions for computed dead-letter P0 incidents.
 *
 * All names, ids, and values are synthetic. The fixtures preserve only two structural facts:
 * historical metadata may point two link fields at one physical column, and an async computed
 * task may outlive a table that the user permanently deleted.
 */
import {
  BaseId,
  FieldId,
  getRandomString,
  RecordId,
  TableId,
  v2CoreTokens,
  type IHasher,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildOutboxTaskInput,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlan,
  type IComputedUpdateOutbox,
} from '../../adapter-table-repository-postgres/src';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

const unwrapDomainId = <T>(result: {
  isOk(): boolean;
  error?: { message: string };
  value?: T;
}): T => {
  if (!result.isOk() || result.value === undefined) {
    throw new Error(result.error?.message ?? 'Invalid domain id');
  }
  return result.value;
};

const countTasksByRunId = async (ctx: SharedTestContext, runId: string) => {
  const outbox = await ctx.testContainer.dataDb
    .selectFrom('computed_update_outbox')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('run_id', '=', runId)
    .executeTakeFirstOrThrow();
  const deadLetter = await ctx.testContainer.dataDb
    .selectFrom('computed_update_dead_letter')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('run_id', '=', runId)
    .executeTakeFirstOrThrow();

  return {
    outbox: Number(outbox.count),
    deadLetter: Number(deadLetter.count),
  };
};

const deleteTasksByRunId = async (ctx: SharedTestContext, runId: string) => {
  await Promise.all([
    ctx.testContainer.dataDb
      .deleteFrom('computed_update_outbox')
      .where('run_id', '=', runId)
      .execute(),
    ctx.testContainer.dataDb
      .deleteFrom('computed_update_dead_letter')
      .where('run_id', '=', runId)
      .execute(),
  ]);
};

const enqueuePlan = async (ctx: SharedTestContext, plan: ComputedUpdatePlan, runId: string) => {
  const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
  const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
    v2RecordRepositoryPostgresTokens.computedUpdateOutbox
  );
  const enqueueResult = await outbox.enqueueOrMerge(
    buildOutboxTaskInput({
      plan,
      hasher,
      runId,
      originRunIds: [runId],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
      syncMaxLevel: 0,
    })
  );
  if (enqueueResult.isErr()) {
    throw new Error(enqueueResult.error.message);
  }
};

describe('anonymized computed dead-letter P0 regressions (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  });

  it('updates historical link fields that share one physical column without ambiguous SQL', async () => {
    let referenceTableId: string | undefined;
    let hostTableId: string | undefined;
    let firstLinkFieldId: string | undefined;
    let firstDbFieldName: string | undefined;
    let runId: string | undefined;

    try {
      const referenceNameFieldId = createFieldId();
      const referenceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic reference ${getRandomString(6)}`,
        fields: [
          {
            type: 'singleLineText',
            id: referenceNameFieldId,
            name: 'Reference label',
            isPrimary: true,
          },
        ],
        views: [{ type: 'grid' }],
      });
      referenceTableId = referenceTable.id;
      const firstReference = await ctx.createRecord(referenceTable.id, {
        [referenceNameFieldId]: 'Synthetic reference A',
      });
      const secondReference = await ctx.createRecord(referenceTable.id, {
        [referenceNameFieldId]: 'Synthetic reference B',
      });

      const rowNameFieldId = createFieldId();
      firstLinkFieldId = createFieldId();
      const secondLinkFieldId = createFieldId();
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic host ${getRandomString(6)}`,
        fields: [
          {
            type: 'singleLineText',
            id: rowNameFieldId,
            name: 'Row label',
            isPrimary: true,
          },
          {
            type: 'link',
            id: firstLinkFieldId,
            name: 'First reference',
            options: {
              relationship: 'manyOne',
              isOneWay: true,
              foreignTableId: referenceTable.id,
              lookupFieldId: referenceNameFieldId,
            },
          },
          {
            type: 'link',
            id: secondLinkFieldId,
            name: 'Second reference',
            options: {
              relationship: 'manyOne',
              isOneWay: true,
              foreignTableId: referenceTable.id,
              lookupFieldId: referenceNameFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [rowNameFieldId]: 'Synthetic row',
        [firstLinkFieldId]: { id: firstReference.id },
        [secondLinkFieldId]: { id: secondReference.id },
      });
      await ctx.drainOutbox();

      const fieldStorageBefore = await ctx.testContainer.db
        .selectFrom('field')
        .select(['id', 'db_field_name'])
        .where('id', 'in', [firstLinkFieldId, secondLinkFieldId])
        .execute();
      const firstFieldStorage = fieldStorageBefore.find((field) => field.id === firstLinkFieldId);
      const secondFieldStorage = fieldStorageBefore.find((field) => field.id === secondLinkFieldId);
      if (!firstFieldStorage || !secondFieldStorage) {
        throw new Error('Failed to resolve synthetic link field storage');
      }
      firstDbFieldName = firstFieldStorage.db_field_name;
      expect(firstDbFieldName).not.toBe(secondFieldStorage.db_field_name);

      const collisionUpdate = await ctx.testContainer.db
        .updateTable('field')
        .set({ db_field_name: secondFieldStorage.db_field_name })
        .where('id', '=', firstLinkFieldId)
        .execute();
      expect(collisionUpdate[0]?.numUpdatedRows).toBe(1n);

      const fieldStorageAfter = await ctx.testContainer.db
        .selectFrom('field')
        .select(['id', 'db_field_name'])
        .where('id', 'in', [firstLinkFieldId, secondLinkFieldId])
        .execute();
      expect(fieldStorageAfter).toHaveLength(2);
      expect(new Set(fieldStorageAfter.map((field) => field.db_field_name))).toEqual(
        new Set([secondFieldStorage.db_field_name])
      );

      await sql`
      UPDATE ${sql.table(`${ctx.baseId}.${hostTable.id}`)}
      SET ${sql.ref(secondFieldStorage.db_field_name)} = NULL
      WHERE "__id" = ${hostRecord.id}
    `.execute(ctx.testContainer.db);
      const beforeWorker = await sql<{ value: unknown }>`
      SELECT ${sql.ref(secondFieldStorage.db_field_name)} as "value"
      FROM ${sql.table(`${ctx.baseId}.${hostTable.id}`)}
      WHERE "__id" = ${hostRecord.id}
    `.execute(ctx.testContainer.db);
      expect(beforeWorker.rows.at(0)?.value).toBeNull();

      const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
      const tableId = unwrapDomainId(TableId.create(hostTable.id));
      const recordId = unwrapDomainId(RecordId.create(hostRecord.id));
      const firstFieldId = unwrapDomainId(FieldId.create(firstLinkFieldId));
      const secondFieldId = unwrapDomainId(FieldId.create(secondLinkFieldId));
      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [{ tableId, fieldIds: [firstFieldId, secondFieldId], level: 0 }],
        edges: [],
        estimatedComplexity: 2,
        changeType: 'update',
        sameTableBatches: [],
      };
      runId = `run_shared_column_${getRandomString(12)}`;
      await enqueuePlan(ctx, plan, runId);

      expect(await ctx.testContainer.processOutbox()).toBeGreaterThan(0);
      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 0, deadLetter: 0 });

      const stored = await sql<{ value: { id?: string } | null }>`
      SELECT ${sql.ref(secondFieldStorage.db_field_name)} as "value"
      FROM ${sql.table(`${ctx.baseId}.${hostTable.id}`)}
      WHERE "__id" = ${hostRecord.id}
      `.execute(ctx.testContainer.db);
      expect(stored.rows.at(0)?.value?.id).toBe(secondReference.id);
    } finally {
      if (runId) {
        await deleteTasksByRunId(ctx, runId);
      }
      if (firstLinkFieldId && firstDbFieldName) {
        await ctx.testContainer.db
          .updateTable('field')
          .set({ db_field_name: firstDbFieldName })
          .where('id', '=', firstLinkFieldId)
          .execute()
          .catch(() => undefined);
      }
      if (hostTableId) {
        await ctx.deleteTable(hostTableId, { mode: 'permanent' }).catch(() => undefined);
      }
      if (referenceTableId) {
        await ctx.deleteTable(referenceTableId, { mode: 'permanent' }).catch(() => undefined);
      }
    }
  });

  it('completes an async computed task whose table was permanently deleted', async () => {
    let tableIdToCleanup: string | undefined;
    let runId: string | undefined;

    try {
      const nameFieldId = createFieldId();
      const valueFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Synthetic obsolete target ${getRandomString(6)}`,
        fields: [
          { type: 'singleLineText', id: nameFieldId, name: 'Label', isPrimary: true },
          { type: 'number', id: valueFieldId, name: 'Value' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Derived value',
            options: { expression: `{${valueFieldId}} * 2` },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableIdToCleanup = table.id;
      const record = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Synthetic obsolete row',
        [valueFieldId]: 21,
      });
      await ctx.drainOutbox();

      const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
      const tableId = unwrapDomainId(TableId.create(table.id));
      const recordId = unwrapDomainId(RecordId.create(record.id));
      const fieldId = unwrapDomainId(FieldId.create(formulaFieldId));
      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [{ tableId, fieldIds: [fieldId], level: 0 }],
        edges: [],
        estimatedComplexity: 1,
        changeType: 'update',
        sameTableBatches: [],
      };

      runId = `run_obsolete_table_${getRandomString(12)}`;
      await enqueuePlan(ctx, plan, runId);
      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 1, deadLetter: 0 });

      await ctx.deleteTable(table.id, { mode: 'permanent' });

      const deletedMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('id')
        .where('id', '=', table.id)
        .executeTakeFirst();
      expect(deletedMeta).toBeUndefined();
      const physicalTable = await sql<{ relation: string | null }>`
      SELECT to_regclass(${`${ctx.baseId}.${table.id}`})::text as "relation"
    `.execute(ctx.testContainer.db);
      expect(physicalTable.rows.at(0)?.relation).toBeNull();
      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 1, deadLetter: 0 });

      expect(await ctx.testContainer.processOutbox()).toBeGreaterThan(0);
      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 0, deadLetter: 0 });
    } finally {
      if (runId) {
        await deleteTasksByRunId(ctx, runId);
      }
      if (tableIdToCleanup) {
        await ctx.deleteTable(tableIdToCleanup, { mode: 'permanent' }).catch(() => undefined);
      }
    }
  });
});

/**
 * Trashed tables are a user action, not a computed failure.
 * A persisted plan that still names a recycled table must skip that table's
 * steps/edges, finish the live remainder, and never dead-letter.
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

describe('computed tasks skip trashed tables (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  });

  it('skips a trashed lookup target in a persisted plan and still updates the live lookup', async () => {
    let sourceTableId: string | undefined;
    let trashedTableId: string | undefined;
    let liveTableId: string | undefined;
    let runId: string | undefined;

    try {
      const sourceNameFieldId = createFieldId();
      const sourceValueFieldId = createFieldId();
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Trash skip source ${getRandomString(6)}`,
        fields: [
          { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
          { type: 'number', id: sourceValueFieldId, name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      sourceTableId = sourceTable.id;
      const sourceRecord = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Source row',
        [sourceValueFieldId]: 100,
      });

      const createLookupTable = async (label: string) => {
        const nameFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Trash skip ${label} ${getRandomString(6)}`,
          fields: [
            { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Source',
              options: {
                relationship: 'manyOne',
                isOneWay: true,
                foreignTableId: sourceTable.id,
                lookupFieldId: sourceNameFieldId,
              },
            },
            {
              type: 'lookup',
              id: lookupFieldId,
              name: 'Lookup value',
              options: {
                linkFieldId,
                foreignTableId: sourceTable.id,
                lookupFieldId: sourceValueFieldId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        const record = await ctx.createRecord(table.id, {
          [nameFieldId]: `${label} row`,
          [linkFieldId]: { id: sourceRecord.id },
        });
        return { table, record, lookupFieldId, linkFieldId };
      };

      const trashed = await createLookupTable('trashed');
      const live = await createLookupTable('live');
      trashedTableId = trashed.table.id;
      liveTableId = live.table.id;
      await ctx.drainOutbox();

      await ctx.updateRecord(sourceTable.id, sourceRecord.id, {
        [sourceValueFieldId]: 200,
      });

      const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
      const seedTableId = unwrapDomainId(TableId.create(sourceTable.id));
      const trashedId = unwrapDomainId(TableId.create(trashed.table.id));
      const liveId = unwrapDomainId(TableId.create(live.table.id));
      const sourceValueId = unwrapDomainId(FieldId.create(sourceValueFieldId));
      const trashedLookupId = unwrapDomainId(FieldId.create(trashed.lookupFieldId));
      const liveLookupId = unwrapDomainId(FieldId.create(live.lookupFieldId));
      const trashedLinkId = unwrapDomainId(FieldId.create(trashed.linkFieldId));
      const liveLinkId = unwrapDomainId(FieldId.create(live.linkFieldId));
      const seedRecordId = unwrapDomainId(RecordId.create(sourceRecord.id));

      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId,
        seedRecordIds: [seedRecordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [
          { tableId: trashedId, fieldIds: [trashedLookupId], level: 0 },
          { tableId: liveId, fieldIds: [liveLookupId], level: 0 },
        ],
        edges: [
          {
            fromFieldId: sourceValueId,
            toFieldId: trashedLookupId,
            fromTableId: seedTableId,
            toTableId: trashedId,
            linkFieldId: trashedLinkId,
            order: 0,
          },
          {
            fromFieldId: sourceValueId,
            toFieldId: liveLookupId,
            fromTableId: seedTableId,
            toTableId: liveId,
            linkFieldId: liveLinkId,
            order: 1,
          },
        ],
        estimatedComplexity: 2,
        changeType: 'update',
        sameTableBatches: [],
      };

      runId = `run_trash_skip_${getRandomString(12)}`;
      await enqueuePlan(ctx, plan, runId);
      await ctx.deleteTable(trashed.table.id, { mode: 'soft' });
      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 1, deadLetter: 0 });

      await ctx.drainOutbox();

      expect(await countTasksByRunId(ctx, runId)).toEqual({ outbox: 0, deadLetter: 0 });
      const liveRecords = await ctx.listRecords(live.table.id);
      const liveLookup = liveRecords.find((record) => record.id === live.record.id)?.fields[
        live.lookupFieldId
      ];
      expect(liveLookup).toEqual([200]);
    } finally {
      if (runId) {
        await deleteTasksByRunId(ctx, runId);
      }
      if (trashedTableId) {
        await ctx.deleteTable(trashedTableId, { mode: 'permanent' }).catch(() => undefined);
      }
      if (liveTableId) {
        await ctx.deleteTable(liveTableId, { mode: 'permanent' }).catch(() => undefined);
      }
      if (sourceTableId) {
        await ctx.deleteTable(sourceTableId, { mode: 'permanent' }).catch(() => undefined);
      }
    }
  });
});

import { BaseId, FieldId, RecordId, TableId, v2CoreTokens, type IHasher } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildOutboxTaskInput,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlan,
  type IComputedUpdateOutbox,
} from '../../adapter-table-repository-postgres/src';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const unwrapDomainId = <T>(result: {
  isErr(): boolean;
  error?: { message: string };
  value: T;
}): T => {
  if (result.isErr()) {
    throw new Error(result.error?.message ?? 'Invalid domain id');
  }
  return result.value;
};

const countOutboxRowsByRunId = async (ctx: SharedTestContext, runId: string) => {
  const outbox = await sql<{ count: number }>`
    SELECT COUNT(*)::int as "count"
    FROM "computed_update_outbox"
    WHERE "run_id" = ${runId}
  `.execute(ctx.testContainer.dataDb);

  const deadLetter = await sql<{ count: number }>`
    SELECT COUNT(*)::int as "count"
    FROM "computed_update_dead_letter"
    WHERE "run_id" = ${runId}
  `.execute(ctx.testContainer.dataDb);

  return {
    outbox: outbox.rows.at(0)?.count ?? 0,
    deadLetter: deadLetter.rows.at(0)?.count ?? 0,
  };
};

describe('computed seed-all outbox updates (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('loads tables referenced only by seedAllTableIds before processing async tasks', async () => {
    let sourceTableId: string | undefined;
    let seedAllTableId: string | undefined;

    try {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'computed seed-all source',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
      });
      sourceTableId = sourceTable.id;
      const sourcePrimaryField = sourceTable.fields.find((field) => field.isPrimary);
      const amountField = sourceTable.fields.find((field) => field.name === 'Amount');
      if (!sourcePrimaryField || !amountField) {
        throw new Error('Failed to resolve source fields');
      }

      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: sourceTable.id,
        field: {
          type: 'formula',
          name: 'AmountTimesTwo',
          options: {
            expression: `{${amountField.id}} * 2`,
          },
        },
      });
      const formulaField = tableWithFormula.fields.find((field) => field.name === 'AmountTimesTwo');
      if (!formulaField) {
        throw new Error('Failed to create formula field');
      }

      const seedAllTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'computed seed-all unrelated target',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      seedAllTableId = seedAllTable.id;
      const seedAllPrimaryField = seedAllTable.fields.find((field) => field.isPrimary);
      if (!seedAllPrimaryField) {
        throw new Error('Failed to resolve seed-all primary field');
      }

      const sourceRecord = await ctx.createRecord(sourceTable.id, {
        [sourcePrimaryField.id]: 'source row',
        [amountField.id]: 21,
      });
      await ctx.createRecord(seedAllTable.id, {
        [seedAllPrimaryField.id]: 'seed-all row',
      });
      await ctx.drainOutbox();

      const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
      const parsedSourceTableId = unwrapDomainId(TableId.create(sourceTable.id));
      const parsedSeedAllTableId = unwrapDomainId(TableId.create(seedAllTable.id));
      const parsedSourceRecordId = unwrapDomainId(RecordId.create(sourceRecord.id));
      const parsedFormulaFieldId = unwrapDomainId(FieldId.create(formulaField.id));
      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: parsedSourceTableId,
        seedRecordIds: [parsedSourceRecordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [
          {
            tableId: parsedSourceTableId,
            fieldIds: [parsedFormulaFieldId],
            level: 0,
          },
        ],
        edges: [],
        estimatedComplexity: 1,
        changeType: 'update',
        sameTableBatches: [],
        seedAllTableIds: [parsedSeedAllTableId],
      };

      const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
      const runId = `run_seed_all_e2e_${Date.now()}`;
      const task = buildOutboxTaskInput({
        plan,
        hasher,
        runId,
        originRunIds: [runId],
        runTotalSteps: plan.steps.length,
        runCompletedStepsBefore: 0,
        syncMaxLevel: 0,
      });
      const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const enqueueResult = await outbox.enqueueOrMerge(task);
      if (enqueueResult.isErr()) {
        throw new Error(enqueueResult.error.message);
      }

      const processed = await ctx.testContainer.processOutbox();
      expect(processed).toBeGreaterThan(0);

      const rows = await countOutboxRowsByRunId(ctx, runId);
      expect(rows.outbox).toBe(0);
      expect(rows.deadLetter).toBe(0);
    } finally {
      if (seedAllTableId) {
        await ctx.deleteTable(seedAllTableId, { mode: 'permanent' });
      }
      if (sourceTableId) {
        await ctx.deleteTable(sourceTableId, { mode: 'permanent' });
      }
    }
  });
});

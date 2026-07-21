/**
 * E2E: async computed activity projection lifecycle.
 *
 * Exercises the real outbox enqueue path + activity reader + getComputeActivity HTTP.
 */
import { getComputeActivityOkResponseSchema } from '@teable/v2-contract-http';
import {
  BaseId,
  FieldId,
  RecordId,
  TableId,
  v2CoreTokens,
  type IComputedActivityReader,
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

describe('computed activity lifecycle (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('enqueue → activity queued/running → processOutbox → idle with duration', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `computed activity ${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    const amountField = table.fields.find((field) => field.name === 'Amount');
    if (!amountField) throw new Error('missing amount field');

    const withFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'AmountTimesTwo',
        options: { expression: `{${amountField.id}} * 2` },
      },
    });
    const formulaField = withFormula.fields.find((field) => field.name === 'AmountTimesTwo');
    if (!formulaField) throw new Error('missing formula field');

    const nameField = table.fields.find((field) => field.isPrimary);
    if (!nameField) throw new Error('missing primary field');

    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'row-1',
      [amountField.id]: 21,
    });
    await ctx.drainOutbox();

    const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
    const tableId = unwrapDomainId(TableId.create(table.id));
    const recordId = unwrapDomainId(RecordId.create(record.id));
    const formulaFieldId = unwrapDomainId(FieldId.create(formulaField.id));

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: tableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [
        {
          tableId,
          fieldIds: [formulaFieldId],
          level: 0,
        },
      ],
      edges: [],
      estimatedComplexity: 42,
      changeType: 'update',
      sameTableBatches: [],
    };

    const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
    const runId = `run_activity_e2e_${Date.now()}`;
    const task = buildOutboxTaskInput({
      plan,
      hasher,
      runId,
      originRunIds: [runId],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
      syncMaxLevel: 0,
      orchestration: {
        operationId: runId,
        groupId: runId,
        totalRecordCount: 900,
        totalChunkCount: 5,
        chunkIndex: 2,
        scope: 'chunk',
      },
      dirtyStats: [{ tableId: table.id, recordCount: 1 }],
    });

    const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const enqueueResult = await outbox.enqueueOrMerge(task);
    if (enqueueResult.isErr()) {
      throw new Error(enqueueResult.error.message);
    }

    const reader = ctx.testContainer.container.resolve<IComputedActivityReader>(
      v2CoreTokens.computedActivityReader
    );

    const afterEnqueue = await reader.getByTableId(undefined, table.id);
    if (afterEnqueue.isErr()) {
      throw new Error(afterEnqueue.error.message);
    }
    const formulaAfterEnqueue = afterEnqueue.value.fields.find(
      (f) => f.fieldId === formulaField.id
    );
    expect(formulaAfterEnqueue).toBeTruthy();
    expect(['queued', 'running']).toContain(formulaAfterEnqueue!.status);
    expect(formulaAfterEnqueue!.estimatedComplexity).toBeGreaterThanOrEqual(1);
    expect(afterEnqueue.value.diagnostics.computeMode).toBe('server');
    expect(afterEnqueue.value.diagnostics.activeFieldCount).toBeGreaterThanOrEqual(1);

    // HTTP diagnostics endpoint
    const httpRes = await fetch(
      `${ctx.baseUrl}/tables/getComputeActivity?baseId=${ctx.baseId}&tableId=${table.id}`,
      { method: 'GET' }
    );
    expect(httpRes.status).toBe(200);
    const httpBody = getComputeActivityOkResponseSchema.parse(await httpRes.json());
    expect(httpBody.ok).toBe(true);
    expect(httpBody.data.diagnostics.computeMode).toBe('server');
    const formulaActivity = httpBody.data.fields.find((f) => f.fieldId === formulaField.id);
    expect(formulaActivity).toMatchObject({
      activeTaskCount: 1,
      batchProgress: { total: 5, completed: 2 },
    });

    // getTableById should include computeMeta
    const tableRes = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${table.id}`,
      { method: 'GET' }
    );
    expect(tableRes.status).toBe(200);
    const tableBody = (await tableRes.json()) as {
      ok: boolean;
      data: {
        table: {
          computeMeta?: { status: string; calculatingFieldCount?: number };
          fields: Array<{ id: string; computeMeta?: { status: string } }>;
        };
      };
    };
    expect(tableBody.ok).toBe(true);
    const formulaDto = tableBody.data.table.fields.find((f) => f.id === formulaField.id);
    expect(formulaDto?.computeMeta?.status).toMatch(/queued|running/);
    expect(tableBody.data.table.computeMeta?.status).toBe('calculating');

    const processed = await ctx.testContainer.processOutbox();
    expect(processed).toBeGreaterThan(0);
    await ctx.drainOutbox();

    const afterDone = await reader.getByTableId(undefined, table.id);
    if (afterDone.isErr()) {
      throw new Error(afterDone.error.message);
    }
    const formulaAfterDone = afterDone.value.fields.find((f) => f.fieldId === formulaField.id);
    expect(formulaAfterDone).toBeTruthy();
    expect(formulaAfterDone!.status).toBe('idle');
    expect(formulaAfterDone!.lastDurationMs == null || formulaAfterDone!.lastDurationMs >= 0).toBe(
      true
    );
    expect(afterDone.value.diagnostics.activeFieldCount).toBe(0);
  });

  it('projects computed targets discovered while processing a seed task', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `computed seed activity ${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    const amountField = table.fields.find((field) => field.name === 'Amount');
    const nameField = table.fields.find((field) => field.isPrimary);
    if (!amountField || !nameField) throw new Error('missing source fields');

    const withFormula = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'AmountTimesThree',
        options: { expression: `{${amountField.id}} * 3` },
      },
    });
    const formulaField = withFormula.fields.find((field) => field.name === 'AmountTimesThree');
    if (!formulaField) throw new Error('missing formula field');

    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'row-1',
      [amountField.id]: 21,
    });
    await ctx.drainOutbox();

    const reader = ctx.testContainer.container.resolve<IComputedActivityReader>(
      v2CoreTokens.computedActivityReader
    );
    const before = await reader.getByTableId(undefined, table.id);
    if (before.isErr()) throw new Error(before.error.message);
    const generationBefore =
      before.value.fields.find((field) => field.fieldId === formulaField.id)?.generation ?? 0;

    await ctx.updateRecords({
      tableId: table.id,
      records: [{ id: record.id, fields: { [amountField.id]: 22 } }],
      fieldKeyType: 'id',
      deferComputedUpdates: true,
      enqueueDeferredComputedUpdates: true,
    });
    const processed = await ctx.testContainer.processOutbox();
    expect(processed).toBeGreaterThan(0);
    await ctx.drainOutbox();

    const after = await reader.getByTableId(undefined, table.id);
    if (after.isErr()) throw new Error(after.error.message);
    const formulaAfter = after.value.fields.find((field) => field.fieldId === formulaField.id);
    expect(formulaAfter).toBeTruthy();
    expect(formulaAfter!.status).toBe('idle');
    expect(formulaAfter!.generation).toBeGreaterThan(generationBefore);
    expect(formulaAfter!.lastDurationMs == null || formulaAfter!.lastDurationMs >= 0).toBe(true);
  });
});

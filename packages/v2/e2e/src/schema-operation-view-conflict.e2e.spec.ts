/* eslint-disable @typescript-eslint/naming-convention */
import { apiErrorResponseDtoSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import {
  ActorId,
  TableId,
  ViewColumnMeta,
  v2CoreTokens,
  type ForeignTableLoaderService,
  type ICreateTableCommandInput,
  type IExecutionContext,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

interface StoredOperation {
  id: string;
  type: string;
  status: string;
  phase: string;
  table_id: string;
  idempotency_key: string;
  payload: unknown;
  result: unknown;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_run_at: Date;
}

/**
 * T8504 consumption regression: a committed target-view save deliberately
 * invalidates the snapshot used by structure-only table.create's reciprocal
 * side effect, then repeats during repair. This tests recovery from real OCC;
 * it does not establish the incident's cause or reproduce its full field graph.
 * No overlapping creates, customer identifiers, record payloads, fake errors,
 * or fake snapshots are involved.
 */
describe('table.create view conflict schema recovery (T8504, postgres)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
  }, 120_000);

  const readCreateOperation = async (tableId: string): Promise<StoredOperation> => {
    const result = await sql<StoredOperation>`
      SELECT "id", "type", "status", "phase", "table_id", "idempotency_key",
        "payload", "result", "attempts", "max_attempts", "last_error", "next_run_at"
      FROM "schema_operation"
      WHERE "table_id" = ${tableId} AND "type" = ${'table.create'}
    `.execute(ctx.testContainer.db);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  };

  const readColumnMeta = async (viewId: string) => {
    const view = await ctx.testContainer.db
      .selectFrom('view')
      .select('column_meta')
      .where('id', '=', viewId)
      .where('deleted_time', 'is', null)
      .executeTakeFirstOrThrow();
    return ViewColumnMeta.create(JSON.parse(view.column_meta))._unsafeUnwrap().toDto();
  };

  it('retries a repeated real view OCC conflict and preserves the latest committed column metadata', async () => {
    const sourceTableId = TableId.generate()._unsafeUnwrap().toString();
    const requestId = `e2e-schema-view-conflict-${sourceTableId}`;
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
    let targetTableId: string | undefined;
    let sourceMetadataExists = false;
    let restoreLoader: (() => void) | undefined;

    try {
      const target = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Recovery target',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Notes' },
        ],
        views: [{ type: 'grid', name: 'All fields' }],
      });
      targetTableId = target.id;
      const primary = target.fields.find((field) => field.isPrimary)!;
      const notes = target.fields.find((field) => field.name === 'Notes')!;
      const viewId = target.views[0]!.id;
      const committedPatches = [
        { width: 240, order: 12 },
        { width: 320, order: 24 },
      ] as const;
      let interleavings = 0;
      let savingView = false;
      const loader = ctx.testContainer.container.resolve<ForeignTableLoaderService>(
        v2CoreTokens.foreignTableLoaderService
      );
      const originalLoad = loader.load.bind(loader);
      const loadSpy = vi.spyOn(loader, 'load').mockImplementation(async (context, input) => {
        const loaded = await originalLoad(context, input);
        // This checkpoint is before the caller starts its data transaction. The
        // nested API save completes before returning the genuine stale snapshot;
        // no barrier, held transaction, or simulated repository result is involved.
        if (
          !savingView &&
          interleavings < committedPatches.length &&
          context.requestId === requestId &&
          input.references.some((reference) => reference.foreignTableId.toString() === target.id) &&
          loaded.isOk() &&
          loaded.value.some((table) => table.id().toString() === target.id)
        ) {
          const patch = committedPatches[interleavings]!;
          interleavings += 1;
          savingView = true;
          try {
            const saved = await client.tables.updateViewColumnMeta({
              tableId: target.id,
              viewId,
              columnMeta: [{ fieldId: notes.id, columnMeta: patch }],
            });
            expect(saved.ok).toBe(true);
            expect((await readColumnMeta(viewId))[notes.id]).toMatchObject(patch);
          } finally {
            savingView = false;
          }
        }
        return loaded;
      });
      restoreLoader = () => loadSpy.mockRestore();

      const payload = {
        baseId: ctx.baseId,
        tableId: sourceTableId,
        name: 'Recovery source',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'longText', name: 'Description' },
          { type: 'longText', name: 'Details' },
          {
            type: 'link',
            name: 'Target',
            options: {
              relationship: 'manyOne',
              foreignTableId: target.id,
              lookupFieldId: primary.id,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid', name: 'All fields' }],
      } satisfies ICreateTableCommandInput;
      const response = await fetch(`${ctx.baseUrl}/tables/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      const sourceMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select(['id', 'provision_state', 'db_table_name'])
        .where('id', '=', sourceTableId)
        .executeTakeFirst();
      sourceMetadataExists = sourceMeta !== undefined;
      expect(response.status, JSON.stringify(body)).toBe(400);
      const error = apiErrorResponseDtoSchema.parse(body);
      expect(error.error.code).toBe('view.version_conflict');
      expect(interleavings).toBe(1);
      expect(sourceMeta).toMatchObject({ id: sourceTableId, provision_state: 'error' });

      const initial = await readCreateOperation(sourceTableId);
      expect(initial).toMatchObject({
        status: 'error',
        phase: 'error',
        attempts: 1,
        max_attempts: 8,
        payload: { recordCount: 0 },
        last_error: error.error.message,
      });
      expect(initial.idempotency_key).toContain(requestId);

      const runner = ctx.testContainer.container.resolve<SchemaOperationRunnerService>(
        v2CoreTokens.schemaOperationRunnerService
      );
      const runnerContext: IExecutionContext = {
        actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap(),
        requestId,
      };
      const firstRepairNow = new Date(Date.now() + 3_600_000);
      const firstRepair = (
        await runner.runNext(runnerContext, {
          workerId: requestId,
          now: firstRepairNow,
        })
      )._unsafeUnwrap();
      const afterConflict = await readCreateOperation(sourceTableId);
      expect(interleavings).toBe(2);
      // A fresh repair can recover this OCC failure while attempts remain.
      expect(afterConflict).toMatchObject({
        id: initial.id,
        status: 'error',
        phase: 'error',
        attempts: 2,
        max_attempts: 8,
        last_error: error.error.message,
        result: { schemaOperationFailure: { retryable: true, terminal: false } },
      });
      expect(firstRepair).toMatchObject({
        status: 'failed',
        operation: { id: initial.id },
        error: { code: 'view.version_conflict' },
        retryable: true,
        terminal: false,
      });
      expect(afterConflict.next_run_at.getTime()).toBeGreaterThan(firstRepairNow.getTime());

      const recovery = (
        await runner.runNext(runnerContext, {
          workerId: requestId,
          now: new Date(firstRepairNow.getTime() + 3_600_000),
        })
      )._unsafeUnwrap();
      const ready = await readCreateOperation(sourceTableId);
      expect(interleavings).toBe(2);
      expect(recovery).toMatchObject({ status: 'completed', operation: { id: initial.id } });
      expect(ready).toMatchObject({
        id: initial.id,
        status: 'ready',
        phase: 'ready',
        attempts: 2,
        max_attempts: 8,
        last_error: null,
        result: { repaired: 'table_schema', tableIds: [sourceTableId] },
      });

      const restoredSource = await ctx.getTableById(sourceTableId);
      const restoredTarget = await ctx.getTableById(target.id);
      expect(restoredSource.fields).toHaveLength(4);
      expect(restoredTarget.fields).toHaveLength(3);
      const sourceLinks = restoredSource.fields.filter((field) => field.type === 'link');
      const reciprocalLinks = restoredTarget.fields.filter((field) => field.type === 'link');
      expect(sourceLinks).toHaveLength(1);
      expect(reciprocalLinks).toHaveLength(1);
      const link = sourceLinks[0]!;
      const reciprocal = reciprocalLinks[0]!;
      expect(link.options).toMatchObject({
        foreignTableId: target.id,
        symmetricFieldId: reciprocal.id,
        relationship: 'manyOne',
        isOneWay: false,
      });
      expect(reciprocal.options).toMatchObject({
        foreignTableId: sourceTableId,
        symmetricFieldId: link.id,
        relationship: 'oneMany',
        isOneWay: false,
      });
      const storedLinks = await ctx.testContainer.db
        .selectFrom('field')
        .select(['id', 'table_id'])
        .where('table_id', 'in', [sourceTableId, target.id])
        .where('type', '=', 'link')
        .where('deleted_time', 'is', null)
        .execute();
      expect(storedLinks.map((field) => field.id).sort()).toEqual([link.id, reciprocal.id].sort());
      const columnMeta = await readColumnMeta(viewId);
      expect(Object.keys(columnMeta).sort()).toEqual(
        restoredTarget.fields.map((field) => field.id).sort()
      );
      expect(columnMeta[notes.id]).toMatchObject(committedPatches[1]);
      expect(Number.isFinite(columnMeta[reciprocal.id]?.order)).toBe(true);
      expect(restoredTarget.views.find((view) => view.id === viewId)!.columnMeta).toEqual(
        columnMeta
      );

      const provisioned = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select(['provision_state', 'db_table_name'])
        .where('id', '=', sourceTableId)
        .executeTakeFirstOrThrow();
      expect(provisioned.provision_state).toBe('ready');
      const [schemaName, physicalTableName] = provisioned.db_table_name.split('.');
      const physical = await sql<{ table_schema: string; table_name: string }>`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = ${schemaName} AND table_name = ${physicalTableName}
      `.execute(ctx.testContainer.db);
      expect(physical.rows).toEqual([{ table_schema: ctx.baseId, table_name: sourceTableId }]);
      expect(await ctx.listRecords(sourceTableId)).toEqual([]);
      expect(await ctx.listRecords(target.id)).toEqual([]);
    } finally {
      restoreLoader?.();
      // The source can remain provision_state=error on the expected red path.
      // Delete through the public API, which accepts any active provision state.
      try {
        if (sourceMetadataExists) {
          await ctx.deleteTable(sourceTableId, { mode: 'permanent' });
        }
      } finally {
        if (targetTableId) {
          await ctx.deleteTable(targetTableId, { mode: 'permanent' });
        }
      }
    }
  }, 120_000);
});

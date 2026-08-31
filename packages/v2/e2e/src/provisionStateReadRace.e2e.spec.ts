/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * Regression coverage for T6660: reads against a table whose schema update is
 * mid-flight (`table_meta.provision_state = 'pending'`) must not flap into
 * `Table not found` (404).
 *
 * Production evidence (app.teable.ai, 2026-08-11): an AI agent burst of field
 * updates kept the table pending in ~50-400ms windows; concurrent read paths
 * (getRecords, socket doc-ids, snapshot-bulk) returned
 * `Table not found (TableByIdSpec)` and surfaced as repeated Socket Errors.
 *
 * The repository must wait briefly for provisioning to finish instead of
 * reporting not-found immediately.
 */
describe('v2 read paths while table provisioning is pending (e2e)', () => {
  let ctx: SharedTestContext;

  const setProvisionState = async (tableId: string, state: 'pending' | 'ready') => {
    await sql`
      UPDATE "table_meta"
      SET "provision_state" = ${state}
      WHERE "id" = ${tableId}
    `.execute(ctx.testContainer.metaDb);
  };

  const listRecordsRaw = async (tableId: string) => {
    const params = new URLSearchParams({ tableId, fieldKeyType: 'id' });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const body = (await response.json()) as { ok: boolean; error?: { message?: string } };
    return { status: response.status, body };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 60000);

  it('waits for a pending table to become ready instead of returning 404', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Provision Read Race Table',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.name === 'Title')?.id;
    if (!titleFieldId) throw new Error('Missing Title field');
    await ctx.createRecord(table.id, { [titleFieldId]: 'hello' });

    await setProvisionState(table.id, 'pending');
    // Simulate the schema update finishing shortly after the read starts.
    const restore = setTimeout(() => {
      void setProvisionState(table.id, 'ready');
    }, 250);

    try {
      const startedAt = Date.now();
      const result = await listRecordsRaw(table.id);
      expect(
        result.status,
        `expected 200 after provisioning completes, got ${result.status}: ${JSON.stringify(result.body)}`
      ).toBe(200);
      // The read must have waited for the ready transition instead of failing
      // fast with "Table not found".
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
      expect(result.body.ok).toBe(true);
    } finally {
      clearTimeout(restore);
      await setProvisionState(table.id, 'ready');
    }
  }, 60000);

  it('keeps returning 404 for tables that stay pending past the wait budget', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Provision Stuck Table',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    await setProvisionState(table.id, 'pending');
    const previousWait = process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
    process.env.V2_TABLE_PROVISION_READY_WAIT_MS = '1500';
    try {
      const startedAt = Date.now();
      const result = await listRecordsRaw(table.id);
      expect(result.status).toBe(404);
      expect(result.body.ok).toBe(false);
      // Must wait (bounded) rather than fail instantly: a stuck table is
      // indistinguishable from a slow schema update until the budget expires.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
    } finally {
      if (previousWait == null) {
        delete process.env.V2_TABLE_PROVISION_READY_WAIT_MS;
      } else {
        process.env.V2_TABLE_PROVISION_READY_WAIT_MS = previousWait;
      }
      await setProvisionState(table.id, 'ready');
    }
  }, 60000);
});

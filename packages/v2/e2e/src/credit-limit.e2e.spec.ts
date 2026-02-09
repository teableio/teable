/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import express from 'express';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * NOTE: This test cannot use the shared test context because it requires
 * a custom maxFreeRowLimit configuration and direct database access for
 * manipulating space credit. It needs its own isolated test container.
 */
describe('v2 credit limit (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let testContainer: IV2NodeTestContainer;
  let baseId: string;
  let db: Kysely<V1TeableDatabase>;
  let spaceId: string;

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createRecords = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
    expectedStatus = 201
  ) => {
    const response = await fetch(`${baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });

    expect(response.status).toBe(expectedStatus);
    if (expectedStatus !== 201) return;

    const rawBody = await response.json();
    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create records: ${JSON.stringify(rawBody)}`);
    }
  };

  beforeAll(async () => {
    // Pass maxFreeRowLimit as a parameter instead of relying on env var
    testContainer = await createV2NodeTestContainer({ maxFreeRowLimit: 10 });
    baseId = testContainer.baseId.toString();
    db = testContainer.db;

    const baseRow = await db
      .selectFrom('base')
      .select(['space_id'])
      .where('id', '=', baseId)
      .executeTakeFirstOrThrow();
    spaceId = baseRow.space_id;

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server?.close();
    await testContainer.dispose();
  });

  it('enforces max row limit based on MAX_FREE_ROW_LIMIT', async () => {
    const table = await createTable({
      baseId,
      name: 'CreditLimit_Default',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    await createRecords(
      table.id,
      Array.from({ length: 10 }, () => ({ fields: {} }))
    );

    await createRecords(table.id, [{ fields: {} }], 400);
  });

  it('uses space credit when set', async () => {
    await db.updateTable('space').set({ credit: 11 }).where('id', '=', spaceId).execute();

    const table = await createTable({
      baseId,
      name: 'CreditLimit_WithCredit',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    await createRecords(
      table.id,
      Array.from({ length: 11 }, () => ({ fields: {} }))
    );

    await createRecords(table.id, [{ fields: {} }], 400);
  });
});

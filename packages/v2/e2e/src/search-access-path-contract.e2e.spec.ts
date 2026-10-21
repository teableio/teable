/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerV2TableOpsPostgresAdapter } from '@teable/v2-adapter-table-query-ops-postgres';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createTableOkResponseSchema,
  getSearchAccessPathCapabilitiesOkResponseSchema,
  getSearchAccessPathStatusOkResponseSchema,
  reconcileSearchAccessPathOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { createV2TableQueryOpsExpressRouter } from '@teable/v2-contract-http-express/table-query-ops';
import { registerV2TableOps } from '@teable/v2-table-query-ops';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createE2eTestContainer } from './shared/createE2eTestContainer';

describe('managed search access-path HTTP contract (postgres)', () => {
  let testContainer: IV2NodeTestContainer;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    testContainer = await createE2eTestContainer({ dbMode: 'postgres' });
    registerV2TableOps(testContainer.container);
    await registerV2TableOpsPostgresAdapter(testContainer.container, {
      metaDb: testContainer.metaDb,
      dataDb: testContainer.dataDb,
      ensureSchema: true,
    });
    await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').execute(testContainer.dataDb);

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );
    app.use(
      createV2TableQueryOpsExpressRouter({
        createContainer: () => testContainer.container,
        allowSearchAccessPathMutation: true,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await testContainer?.dispose();
  });

  it('exposes the v2-native status, capability, and guarded reconcile lifecycle', async () => {
    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: testContainer.baseId.toString(),
        name: 'Managed search access path',
        fields: [{ type: 'singleLineText', name: 'Title' }],
      }),
    });
    const createTableBody = createTableOkResponseSchema.parse(await createTableResponse.json());
    expect(createTableResponse.status).toBe(201);
    expect(createTableBody.ok).toBe(true);
    if (!createTableBody.ok) return;

    const table = createTableBody.data.table;
    const titleField = table.fields.find((field) => field.name === 'Title');
    if (!titleField) throw new Error('Expected Title field');

    const tableStorage = await testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirstOrThrow();
    const fieldStorage = await testContainer.db
      .selectFrom('field')
      .select('db_field_name')
      .where('id', '=', titleField.id)
      .executeTakeFirstOrThrow();

    await sql`
      INSERT INTO ${sql.table(tableStorage.db_table_name)}
        ("__id", "__created_by", "__version", ${sql.ref(fieldStorage.db_field_name)})
      SELECT
        'rec_search_contract_' || row_number::text,
        'system',
        1,
        CASE
          WHEN row_number = 4242 THEN 'needle package target'
          ELSE md5(row_number::text) || md5((row_number + 100000)::text)
        END
      FROM generate_series(1, 30000) AS row_number
    `.execute(testContainer.dataDb);
    await sql`ANALYZE ${sql.table(tableStorage.db_table_name)}`.execute(testContainer.dataDb);

    const capabilitiesResponse = await fetch(
      `${baseUrl}/table-query-ops/search-access-path/capabilities`
    );
    const capabilitiesRawBody = await capabilitiesResponse.json();
    expect(capabilitiesResponse.status, JSON.stringify(capabilitiesRawBody)).toBe(200);
    const capabilitiesBody =
      getSearchAccessPathCapabilitiesOkResponseSchema.parse(capabilitiesRawBody);
    expect(capabilitiesBody.ok).toBe(true);
    if (!capabilitiesBody.ok) return;
    expect(capabilitiesBody.data.capabilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'pg_trgm', state: 'ready' })])
    );

    const readStatus = async () => {
      const response = await fetch(
        `${baseUrl}/table-query-ops/search-access-path/status?tableId=${table.id}`
      );
      const rawBody = await response.json();
      expect(response.status, JSON.stringify(rawBody)).toBe(200);
      const body = getSearchAccessPathStatusOkResponseSchema.parse(rawBody);
      expect(body.ok).toBe(true);
      if (!body.ok) throw new Error('Expected search access-path status');
      return body.data.status;
    };

    expect(await readStatus()).toMatchObject({
      tableId: table.id,
      state: 'disabled',
      configured: false,
    });

    const reconcile = async (body: Record<string, unknown>) => {
      const response = await fetch(`${baseUrl}/table-query-ops/search-access-path/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rawBody = await response.json();
      expect(response.status, JSON.stringify(rawBody)).toBe(200);
      const parsedBody = reconcileSearchAccessPathOkResponseSchema.parse(rawBody);
      expect(parsedBody.ok).toBe(true);
      if (!parsedBody.ok) throw new Error('Expected search access-path reconcile result');
      return parsedBody.data.result;
    };

    const created = await reconcile({
      tableId: table.id,
      mode: 'create',
      semantics: 'substring',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      fieldIds: [titleField.id],
      searchProbe: 'needle package',
    });
    expect(created).toMatchObject({
      action: 'created',
      tableId: table.id,
      status: 'ready',
    });
    expect(created.planEvidence).toMatchObject({
      explainStatus: 'validated',
      explainMethod: 'real_index',
      usesCandidateIndex: true,
      semanticsCompatible: true,
    });
    expect(await readStatus()).toMatchObject({
      state: 'ready',
      configured: true,
      provider: 'pg_trgm',
      accessPath: 'generated_text',
      coveredFieldCount: 1,
    });

    const rebuilt = await reconcile({
      tableId: table.id,
      mode: 'rebuild',
      expectedDefinitionKey: created.definitionKey,
      semantics: 'substring',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      fieldIds: [titleField.id],
      searchProbe: 'needle package',
    });
    expect(rebuilt).toMatchObject({
      action: 'rebuilt',
      definitionKey: created.definitionKey,
      status: 'ready',
    });

    const dropped = await reconcile({ tableId: table.id, mode: 'drop' });
    expect(dropped).toMatchObject({ action: 'dropped', status: 'disabled' });
    expect(await readStatus()).toMatchObject({ state: 'disabled', configured: false });
  }, 120_000);
});

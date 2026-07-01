import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { axios } from '@teable/openapi';
import { ShareDbService } from '../src/share-db/share-db.service';
import { collectActionTriggers } from './utils/action-trigger';
import { createField, createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Action trigger field conversion presence (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  const tableIds = new Set<string>();
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    for (const tableId of [...tableIds].reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    await app.close();
  });

  it('emits schema-refresh setField when converting a text-valued formula field to text in v1', async () => {
    const table = await createTable(baseId, {
      name: 'action-trigger-formula-to-text-v1',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
    });
    tableIds.add(table.id);

    const formulaField = await createField(table.id, {
      name: 'Formula Amount',
      type: FieldType.Formula,
      options: {
        expression: "'ready'",
      },
    });

    const actions = await collectActionTriggers({
      shareDbService,
      cookie,
      port,
      tableId: table.id,
      act: async () => {
        const response = await axios.put(`/table/${table.id}/field/${formulaField.id}/convert`, {
          name: formulaField.name,
          type: FieldType.SingleLineText,
        });

        expect(response.status).toBe(200);
        expect(response.headers['x-teable-v2']).not.toBe('true');
      },
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: 'setField',
          payload: expect.objectContaining({
            tableId: table.id,
            field: expect.objectContaining({
              id: formulaField.id,
            }),
          }),
        }),
      ])
    );
  });
});

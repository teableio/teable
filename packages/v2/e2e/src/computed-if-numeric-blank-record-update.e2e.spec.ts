/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T7609: record updates must preserve text-typed IF/ROUND outputs between
 * same-table computed levels, including independent roots compiled as a group.
 * Build each formula separately so setup does not substitute field backfill for
 * the production trigger: a persisted asynchronous record-update plan.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createE2eTestContainer } from './shared/createE2eTestContainer';

const createFieldId = () => `fld${getRandomString(16)}`;

describe('v2 record-update numeric-blank formula cascade (T7609)', () => {
  let testContainer: IV2NodeTestContainer;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    testContainer = await createE2eTestContainer({
      dbMode: 'postgres',
      computedUpdate: {
        mode: 'hybrid',
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        // Keep all three same-table levels in the same worker batch.
        outboxConfig: { stageMaxSteps: 0, stageMaxFields: 0, stageMaxDirtyRecords: 0 },
      },
    });
    const app = express();
    app.use(createV2ExpressRouter({ createContainer: () => testContainer.container }));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    server.keepAliveTimeout = 0;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (testContainer) await testContainer.dispose();
  }, 120_000);

  const request = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const rawBody: unknown = await response.json();
    expect(response.ok, JSON.stringify(rawBody)).toBe(true);
    return rawBody;
  };

  it.each(['single', 'grouped'] as const)(
    'persists blank-to-number-to-blank transitions through %s roots and three formula levels',
    async (rootMode) => {
      const baseId = testContainer.baseId.toString();
      const nameId = createFieldId();
      const intervalId = createFieldId();
      const previousId = createFieldId();
      const currentId = createFieldId();
      const upstreamId = createFieldId();
      const companionId = createFieldId();
      const downstreamId = createFieldId();
      const tertiaryId = createFieldId();
      let tableId: string | undefined;

      try {
        const createdTable = createTableOkResponseSchema.parse(
          await request('/tables/create', 'POST', {
            baseId,
            name: `Synthetic formula cascade ${rootMode} ${getRandomString(8)}`,
            fields: [
              { type: 'singleLineText', id: nameId, name: 'Name', isPrimary: true },
              { type: 'number', id: intervalId, name: 'Interval' },
              { type: 'number', id: previousId, name: 'Previous' },
              { type: 'number', id: currentId, name: 'Current' },
            ],
            views: [{ type: 'grid' }],
          })
        );
        if (!createdTable.ok) throw new Error('Failed to create formula cascade table');
        tableId = createdTable.data.table.id;

        const createdRecord = createRecordOkResponseSchema.parse(
          await request('/tables/createRecord', 'POST', {
            tableId,
            fields: { [nameId]: 'Sample', [intervalId]: 0, [previousId]: 20, [currentId]: 8 },
          })
        );
        if (!createdRecord.ok) throw new Error('Failed to create formula cascade record');
        const recordId = createdRecord.data.record.id;
        await testContainer.processOutbox();

        const formulas = [
          {
            id: upstreamId,
            name: 'Rounded or blank',
            expression: `IF({${intervalId}}>0,ROUND({${intervalId}}+{${previousId}}-{${currentId}},0),"")`,
            cellValueType: 'string',
          },
          ...(rootMode === 'grouped'
            ? [
                {
                  id: companionId,
                  name: 'Independent rounded or blank',
                  expression: `IF({${intervalId}}>0,ROUND({${intervalId}}+{${previousId}}-{${currentId}}+4,0),"")`,
                  cellValueType: 'string',
                },
              ]
            : []),
          {
            id: downstreamId,
            name: 'Parsed or sentinel',
            expression: `IF({${upstreamId}}!="",INT({${upstreamId}}),99999)`,
            cellValueType: 'number',
          },
          {
            id: tertiaryId,
            name: 'Half parsed value',
            expression: `{${downstreamId}}/2`,
            cellValueType: 'number',
          },
        ];

        for (const formula of formulas) {
          const createdField = createFieldOkResponseSchema.parse(
            await request('/tables/createField', 'POST', {
              baseId,
              tableId,
              field: {
                type: 'formula',
                id: formula.id,
                name: formula.name,
                options: { expression: formula.expression },
              },
            })
          );
          if (!createdField.ok) throw new Error(`Failed to create ${formula.name}`);
          const field = createdField.data.table.fields.find((field) => field.id === formula.id);
          expect(field?.hasError).toBeFalsy();
          expect(field?.cellValueType).toBe(formula.cellValueType);
          await testContainer.processOutbox();
        }

        const readComputed = async () => {
          const params = new URLSearchParams({ tableId: tableId!, fieldKeyType: 'id' });
          const listed = listTableRecordsOkResponseSchema.parse(
            await request(`/tables/listRecords?${params.toString()}`, 'GET')
          );
          if (!listed.ok) throw new Error('Failed to read formula cascade record');
          const record = listed.data.records.find((record) => record.id === recordId);
          expect(record).toBeDefined();
          return record!.fields;
        };

        const expectComputed = async (numeric: boolean) => {
          const fields = await readComputed();
          expect(fields[upstreamId]).toBe(numeric ? '17' : null);
          if (rootMode === 'grouped') {
            expect(fields[companionId]).toBe(numeric ? '21' : null);
          }
          expect(fields[downstreamId]).toBe(numeric ? 17 : 99999);
          expect(fields[tertiaryId]).toBe(numeric ? 8.5 : 49999.5);
        };
        await expectComputed(false);

        for (const interval of [5, 0]) {
          const updated = updateRecordOkResponseSchema.parse(
            await request('/tables/updateRecord', 'POST', {
              tableId,
              recordId,
              fields: { [intervalId]: interval },
            })
          );
          if (!updated.ok) throw new Error('Failed to update formula cascade source');

          // This is deliberately not a field-create/backfill assertion: the
          // worker now computes the dependent levels from the persisted update.
          await testContainer.processOutbox();
          const deadLetters = await sql<{ last_error: string }>`
            SELECT last_error FROM computed_update_dead_letter
            WHERE base_id = ${baseId} AND seed_table_id = ${tableId}
          `.execute(testContainer.db);
          expect(deadLetters.rows).toEqual([]);
          await expectComputed(interval > 0);
        }
      } finally {
        if (tableId) {
          await request('/tables/delete', 'DELETE', { baseId, tableId, mode: 'permanent' });
        }
      }
    },
    180_000
  );
});

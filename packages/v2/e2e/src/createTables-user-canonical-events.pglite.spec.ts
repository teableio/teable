/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ShareDbBackendPublisher,
  registerV2ShareDbRealtime,
} from '@teable/v2-adapter-realtime-sharedb';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { createTablesOkResponseSchema } from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { ActorId, RecordCreated, RecordsBatchCreated } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import ShareDb from 'sharedb';
import type { Doc } from 'sharedb/lib/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createE2eTestContainer } from './shared/createE2eTestContainer';
import { createShareDbRealtimeConfig } from './shared/shareDbRealtimeConfig';

const allowedCollaborator = {
  id: 'usrInitialEventMember',
  name: 'Initial Event Member',
  email: 'initial-event-member@example.invalid',
};
const canonicalUser = {
  id: allowedCollaborator.id,
  title: allowedCollaborator.name,
  email: allowedCollaborator.email,
};

type RecordSnapshot = { id: string; fields: Record<string, unknown> };

describe('v2 HTTP createTables canonical initial user events (PGlite)', () => {
  let testContainer: IV2NodeTestContainer;
  let server: Server | undefined;
  let backend: ShareDb | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    testContainer = await createE2eTestContainer({ dbMode: 'pglite' });
    backend = new ShareDb();
    registerV2ShareDbRealtime(
      testContainer.container,
      createShareDbRealtimeConfig(backend, new ShareDbBackendPublisher(backend))
    );
    await testContainer.db.insertInto('users').values(allowedCollaborator).execute();
    await testContainer.db
      .insertInto('collaborator')
      .values({
        id: 'colInitialEventMember',
        resource_type: 'base',
        resource_id: testContainer.baseId.toString(),
        principal_id: allowedCollaborator.id,
        principal_type: 'user',
      })
      .execute();

    const actorId = ActorId.create(allowedCollaborator.id)._unsafeUnwrap();
    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
        createExecutionContext: () => ({ actorId }),
      })
    );
    const listening = Promise.withResolvers<void>();
    server = app.listen(0, '127.0.0.1', listening.resolve);
    await listening.promise;
    server.keepAliveTimeout = 0;
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    }
    if (testContainer) await testContainer.dispose();
    if (backend) {
      const closed = Promise.withResolvers<void>();
      backend.close(() => closed.resolve());
      await closed.promise;
    }
  });

  test.each([1, 2])(
    'publishes canonical initial users to events and realtime (%i records per table)',
    async (recordCount) => {
      const eventOffset = testContainer.eventBus.events().length;
      const response = await fetch(`${baseUrl}/tables/createTables`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: testContainer.baseId.toString(),
          tables: [0, 1].map((tableIndex) => {
            const nameFieldId = `fld${`eventName${recordCount}${tableIndex}`.padEnd(16, '0')}`;
            const ownerFieldId = `fld${`eventOwner${recordCount}${tableIndex}`.padEnd(16, '0')}`;
            return {
              name: `Canonical initial users ${recordCount}-${tableIndex}`,
              fields: [
                { id: nameFieldId, type: 'singleLineText', name: 'Name', isPrimary: true },
                { id: ownerFieldId, type: 'user', name: 'Owner', options: { isMultiple: false } },
              ],
              records: Array.from({ length: recordCount }, (_, recordIndex) => ({
                fields: {
                  [nameFieldId]: `Table ${tableIndex} record ${recordIndex}`,
                  [ownerFieldId]: {
                    id: allowedCollaborator.id,
                    title: 'Forged initial member title',
                    email: allowedCollaborator.email,
                  },
                },
              })),
            };
          }),
        }),
      });
      const rawBody = await response.json();
      expect(response.status, JSON.stringify(rawBody)).toBe(201);
      const body = createTablesOkResponseSchema.parse(rawBody);
      expect(body.data.tables).toHaveLength(2);
      const events = testContainer.eventBus.events().slice(eventOffset);

      for (const table of body.data.tables) {
        const ownerField = table.fields.find((field) => field.name === 'Owner')!;
        const ownerFieldId = ownerField.id;
        const stored = await sql<{ id: string; owner: unknown }>`
          SELECT "__id" as id, ${sql.ref(ownerField.dbFieldName!)} as owner
          FROM ${sql.table(table.dbTableName!)}
        `.execute(testContainer.db);
        expect(stored.rows).toHaveLength(recordCount);
        for (const row of stored.rows) expect(row.owner).toEqual(canonicalUser);

        const createdEvents = events.filter(
          (event): event is RecordCreated | RecordsBatchCreated =>
            (event instanceof RecordCreated || event instanceof RecordsBatchCreated) &&
            event.tableId.toString() === table.id
        );
        const createdRecords = createdEvents.flatMap((event) =>
          event instanceof RecordCreated
            ? [{ recordId: event.recordId.toString(), fields: event.fieldValues }]
            : event.records
        );
        expect(createdRecords).toHaveLength(recordCount);
        expect(createdRecords.map((record) => record.recordId).sort()).toEqual(
          stored.rows.map((row) => row.id).sort()
        );
        for (const record of createdRecords) {
          expect
            .soft(record.fields.find((field) => field.fieldId === ownerFieldId)?.value)
            .toMatchObject(canonicalUser);

          const connection = backend!.connect();
          const doc = connection.get(`rec_${table.id}`, record.recordId) as Doc<RecordSnapshot>;
          try {
            const fetched = Promise.withResolvers<void>();
            doc.fetch((error) => (error ? fetched.reject(error) : fetched.resolve()));
            await fetched.promise;
            expect.soft(doc.data?.fields[ownerFieldId]).toMatchObject(canonicalUser);
          } finally {
            doc.destroy();
            connection.close();
          }
        }
        expect(createdEvents).toHaveLength(1);
        expect(createdEvents[0]).toBeInstanceOf(
          recordCount === 1 ? RecordCreated : RecordsBatchCreated
        );
      }
    }
  );
});

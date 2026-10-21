import { setTimeout } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldType, IdPrefix } from '@teable/core';
import { axios } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { Connection, Doc } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { ShareDbService } from '../src/share-db/share-db.service';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateField,
} from './utils/init-app';

const subscribe = (doc: Doc<Record<string, unknown>>) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  doc.subscribe((error) => (error ? reject(error) : resolve()));
  return promise;
};

const unsubscribe = (doc: Doc<Record<string, unknown>>) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  doc.unsubscribe((error) => (error ? reject(error) : resolve()));
  return promise;
};

const json0InstructionKeys = ['oi', 'od', 'li', 'ld', 'lm', 'na', 't', 'si', 'sd'];

/** Subset of a ShareDB wire message: a recovery op carries what the client applies next. */
type ShareDbWireOpMessage = { a?: unknown; c?: unknown; d?: unknown; op?: unknown[] };

const isJson0Component = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Published ops reach subscribers asynchronously; poll until the doc caught up. */
const waitForDoc = async (predicate: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await setTimeout(20);
  }
  if (!predicate()) {
    throw new Error('client document did not catch up in time');
  }
};

const collectWireOps = (connection: Connection, collection: string, docId: string) => {
  const components: Array<Record<string, unknown>> = [];
  connection.on('receive', (request: ConnectionReceiveRequest) => {
    const message: ShareDbWireOpMessage | undefined = request.data;
    if (
      message?.a !== 'op' ||
      message.c !== collection ||
      message.d !== docId ||
      !Array.isArray(message.op)
    ) {
      return;
    }
    for (const component of message.op) {
      if (isJson0Component(component)) components.push(component);
    }
  });
  return components;
};

// A json0 component without an instruction cannot be applied at all: ot-json0
// reads it as "invalid / missing instruction in op", the client aborts the
// whole op and hard-rolls its document back.
const instructionless = (components: Array<Record<string, unknown>>) =>
  components.filter(
    (component) => !json0InstructionKeys.some((key) => component[key] !== undefined)
  );

// Sanitized T7720 structure: documents whose row carries columns that are empty
// in the database (description, icon, deleted time) or a value that is cleared,
// and a client that keeps its document across a missed update. A fresh
// connection would fetch a snapshot instead of asking for the ops in the gap,
// which is the failing path here.
describe('Table socket gap recovery (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let shareDbService: ShareDbService;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const context = await initApp();
    app = context.app;
    cookie = context.cookie;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    await app.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  it('delivers only applicable ops when a missed table update is recovered T7720', async () => {
    let table: ITableFullVo | undefined;
    let connection: Connection | undefined;
    try {
      table = await createTable(baseId, {
        name: 'Gap table',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });

      connection = shareDbService.connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const socketErrors: string[] = [];
      connection.on('error', (error: unknown) => {
        socketErrors.push(error instanceof Error ? error.message : String(error));
      });
      const deliveredOps = collectWireOps(connection, `${IdPrefix.Table}_${baseId}`, table.id);

      const doc: Doc<Record<string, unknown>> = connection.get(
        `${IdPrefix.Table}_${baseId}`,
        table.id
      );
      await subscribe(doc);
      const initialVersion = doc.version ?? 0;
      // Hand the client a value the recovery has to clear afterwards.
      await axios.put(`/base/${baseId}/table/${table.id}/description`, {
        description: 'stale description',
      });
      await waitForDoc(() => doc.data?.description === 'stale description');
      await unsubscribe(doc);

      // All three writes land while this client is unsubscribed: the description
      // empties the value the client still holds, the rename is what the
      // recovery has to catch up with, and adding a field bumps the table row
      // version, which is what opens the recovery gap.
      await axios.put(`/base/${baseId}/table/${table.id}/description`, { description: null });
      await axios.put(`/base/${baseId}/table/${table.id}/name`, { name: 'Gap table renamed' });
      await createField(table.id, { name: 'Extra', type: FieldType.SingleLineText });

      await subscribe(doc);
      // The apply failure is emitted on the connection after the message that
      // carried it, so give that emission a turn before asserting on it.
      await setTimeout(100);

      expect(doc.version ?? 0).toBeGreaterThan(initialVersion);
      expect(doc.data?.name).toBe('Gap table renamed');
      expect(doc.data?.description).toBeNull();
      expect(socketErrors).toEqual([]);
      expect(instructionless(deliveredOps)).toEqual([]);
    } finally {
      connection?.close();
      if (table) await permanentDeleteTable(baseId, table.id);
    }
  });

  it('recovers a field document whose missed update came through a field edit T7720', async () => {
    let table: ITableFullVo | undefined;
    let connection: Connection | undefined;
    try {
      table = await createTable(baseId, {
        name: 'Field gap table',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });
      const fieldId = table.fields[0].id;

      connection = shareDbService.connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const socketErrors: string[] = [];
      connection.on('error', (error: unknown) => {
        socketErrors.push(error instanceof Error ? error.message : String(error));
      });
      const deliveredOps = collectWireOps(connection, `${IdPrefix.Field}_${table.id}`, fieldId);

      const doc: Doc<Record<string, unknown>> = connection.get(
        `${IdPrefix.Field}_${table.id}`,
        fieldId
      );
      await subscribe(doc);
      await unsubscribe(doc);

      await updateField(table.id, fieldId, { name: 'Field renamed' });

      await subscribe(doc);
      await setTimeout(100);

      expect(doc.data?.name).toBe('Field renamed');
      expect(socketErrors).toEqual([]);
      expect(instructionless(deliveredOps)).toEqual([]);
    } finally {
      connection?.close();
      if (table) await permanentDeleteTable(baseId, table.id);
    }
  });
});

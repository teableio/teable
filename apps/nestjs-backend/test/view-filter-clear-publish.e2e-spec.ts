import { setTimeout } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldType, IdPrefix } from '@teable/core';
import { axios } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { Connection, Doc } from 'sharedb/lib/client';
import type { ConnectionReceiveRequest } from 'sharedb/lib/sharedb';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

const subscribe = (doc: Doc<Record<string, unknown>>) => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  doc.subscribe((error) => (error ? reject(error) : resolve()));
  return promise;
};

const json0InstructionKeys = ['oi', 'od', 'li', 'ld', 'lm', 'na', 't', 'si', 'sd'];

/** Subset of a ShareDB wire message: a live op is what subscribers apply next. */
type ShareDbWireOpMessage = { a?: unknown; c?: unknown; d?: unknown; op?: unknown[] };

const isJson0Component = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Sanitized T7720 structure: a freshly created view whose filter was never set,
// cleared through the v1 endpoint (no FORCE_V2_ALL, canary off). The clear is a
// no-op against the stored row, so the delta built from it used to carry a
// component without any instruction and every subscriber applying it aborted.
describe('View filter clear publish (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let shareDbService: ShareDbService;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    delete process.env.FORCE_V2_ALL;
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

  it('clears a filter that was never set without publishing an inapplicable op T7720', async () => {
    let table: ITableFullVo | undefined;
    let connection: Connection | undefined;
    try {
      table = await createTable(baseId, {
        name: 'Filter table',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });
      const viewId = table.views[0].id;

      connection = shareDbService.connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const socketErrors: string[] = [];
      connection.on('error', (error: unknown) => {
        socketErrors.push(error instanceof Error ? error.message : String(error));
      });
      const deliveredOps: Array<Record<string, unknown>> = [];
      connection.on('receive', (request: ConnectionReceiveRequest) => {
        const message: ShareDbWireOpMessage | undefined = request.data;
        if (
          message?.a !== 'op' ||
          message.c !== `${IdPrefix.View}_${table?.id}` ||
          message.d !== viewId ||
          !Array.isArray(message.op)
        ) {
          return;
        }
        for (const component of message.op) {
          if (isJson0Component(component)) deliveredOps.push(component);
        }
      });

      const doc: Doc<Record<string, unknown>> = connection.get(
        `${IdPrefix.View}_${table.id}`,
        viewId
      );
      await subscribe(doc);

      const response = await axios.put(`/table/${table.id}/view/${viewId}/filter`, {
        filter: null,
      });
      expect(response.status).toBe(200);
      // The apply failure is emitted on the connection after the message that
      // carried it, so give that emission a turn before asserting on it.
      await setTimeout(100);

      expect(socketErrors).toEqual([]);
      expect(doc.data?.filter ?? null).toBeNull();
      expect(
        deliveredOps.filter(
          (component) => !json0InstructionKeys.some((key) => component[key] !== undefined)
        )
      ).toEqual([]);
    } finally {
      connection?.close();
      if (table) await permanentDeleteTable(baseId, table.id);
    }
  });
});

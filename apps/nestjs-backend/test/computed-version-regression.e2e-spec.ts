import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events, type RecordUpdateEvent } from '../src/event-emitter/events';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const isForceV2 = process.env.FORCE_V2_ALL === 'true';

describe('Computed ops version alignment (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  const baseId = globalThis.testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
  });

  afterAll(async () => {
    await app.close();
  });

  const waitForRecordUpdateOnTable = (tableId: string) =>
    new Promise<RecordUpdateEvent>((resolve) => {
      const handler = (event: RecordUpdateEvent) => {
        if (event.payload.tableId !== tableId) return;
        eventEmitterService.eventEmitter.off(Events.TABLE_RECORD_UPDATE, handler);
        resolve(event);
      };
      eventEmitterService.eventEmitter.on(Events.TABLE_RECORD_UPDATE, handler);
    });

  // Skip in v2 mode - this test verifies v1 event payload format
  // v2 uses different event system (RecordUpdated/RecordsBatchUpdated)
  const itWhenV1 = isForceV2 ? it.skip : it;

  itWhenV1(
    'emits non-null new values for track-all last modified fields and formulas',
    async () => {
      let table: Awaited<ReturnType<typeof createTable>> | undefined;
      try {
        table = await createTable(baseId, {
          name: 'computed_version_alignment',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'before' } }],
        });

        const titleId = table.fields.find((f) => f.name === 'Title')!.id;
        const lmtField = await createField(table.id, {
          name: 'LMT',
          type: FieldType.LastModifiedTime,
        });
        const lmbField = await createField(table.id, {
          name: 'LMB',
          type: FieldType.LastModifiedBy,
        });
        const formulaField = await createField(table.id, {
          name: 'UpperTitle',
          type: FieldType.Formula,
          options: { expression: `UPPER({${titleId}})` },
        });

        const waitForUpdate = waitForRecordUpdateOnTable(table.id);
        await updateRecordByApi(table.id, table.records[0].id, titleId, 'after');
        const event = await waitForUpdate;

        const recordPayload = Array.isArray(event.payload.record)
          ? event.payload.record[0]
          : event.payload.record;
        const changes = recordPayload.fields as Record<
          string,
          { oldValue: unknown; newValue: unknown }
        >;

        expect(changes[lmtField.id]).toBeDefined();
        expect(typeof changes[lmtField.id].newValue).toBe('string');

        expect(changes[lmbField.id]).toBeDefined();
        expect(changes[lmbField.id].newValue).toMatchObject({
          id: globalThis.testConfig.userId,
        });

        expect(changes[formulaField.id]).toBeDefined();
        expect(changes[formulaField.id].newValue).toBe('AFTER');
      } finally {
        if (table) {
          await permanentDeleteTable(baseId, table.id);
        }
      }
    }
  );
});

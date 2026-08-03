import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import {
  DateFormattingPreset,
  FieldType,
  Relationship,
  TimeFormatting,
  formatDateToString,
} from '@teable/core';
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

describe('Link events (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
  });

  afterAll(async () => {
    await app.close();
  });

  const waitForRecordUpdateOnTable = (tableId: string) => {
    return new Promise<RecordUpdateEvent>((resolve) => {
      const handler = (event: RecordUpdateEvent) => {
        if (event.payload.tableId !== tableId) {
          return;
        }
        eventEmitterService.eventEmitter.off(Events.TABLE_RECORD_UPDATE, handler);
        resolve(event);
      };
      eventEmitterService.eventEmitter.on(Events.TABLE_RECORD_UPDATE, handler);
    });
  };

  // Skip in v2 mode - this test verifies v1 event payload format
  // v2 uses different event system (RecordUpdated/RecordsBatchUpdated)
  const itWhenV1 = isForceV2 ? it.skip : it;

  itWhenV1('emits formatted link titles in record update events', async () => {
    const releaseFormatting = {
      date: DateFormattingPreset.Asian,
      time: TimeFormatting.Hour24,
      timeZone: 'Asia/Shanghai',
    };
    const releaseValue = '2024-01-01T00:00:00.000Z';
    const expectedTitle = formatDateToString(releaseValue, releaseFormatting);

    let hostTable: Awaited<ReturnType<typeof createTable>> | undefined;
    let foreignTable: Awaited<ReturnType<typeof createTable>> | undefined;
    try {
      foreignTable = await createTable(baseId, {
        name: 'LinkEvents_Foreign',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Release',
            type: FieldType.Date,
            options: {
              formatting: releaseFormatting,
            },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Name: 'Foreign row',
              Release: releaseValue,
            },
          },
        ],
      });

      const releaseField = foreignTable.fields.find((field) => field.name === 'Release');
      if (!releaseField) {
        throw new Error('Release field not found');
      }

      hostTable = await createTable(baseId, {
        name: 'LinkEvents_Host',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Host row' } }],
      });

      const linkField = await createField(hostTable.id, {
        name: 'Formatted Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          lookupFieldId: releaseField.id,
        },
      } as IFieldRo);

      const waitForHostUpdate = waitForRecordUpdateOnTable(hostTable.id);

      await updateRecordByApi(hostTable.id, hostTable.records[0].id, linkField.id, {
        id: foreignTable.records[0].id,
      });

      const hostEvent = await waitForHostUpdate;
      const changeRecord = Array.isArray(hostEvent.payload.record)
        ? hostEvent.payload.record[0]
        : hostEvent.payload.record;
      const linkChange = changeRecord.fields[linkField.id];
      expect(linkChange).toBeDefined();

      const newValue = Array.isArray(linkChange.newValue)
        ? linkChange.newValue
        : [linkChange.newValue];
      expect(newValue[0]).toBeDefined();
      expect(newValue[0]?.id).toBe(foreignTable.records[0].id);
      expect(newValue[0]?.title).toBe(expectedTitle);
    } finally {
      if (hostTable) {
        await permanentDeleteTable(baseId, hostTable.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  });
});

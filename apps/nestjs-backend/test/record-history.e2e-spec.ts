/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { getRecordHistory, getRecordListHistory, recordHistoryVoSchema } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { IBaseConfig } from '../src/configs/base.config';
import { baseConfig } from '../src/configs/base.config';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createField,
  createTable,
  permanentDeleteTable,
  initApp,
  updateRecord,
} from './utils/init-app';

describe('Record history (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    eventEmitterService = app.get(EventEmitterService);
    const baseConfigService = app.get(baseConfig.KEY) as IBaseConfig;
    baseConfigService.recordHistoryDisabled = false;

    awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.RECORD_HISTORY_CREATE);
  });

  afterAll(async () => {
    eventEmitterService.eventEmitter.removeAllListeners(Events.RECORD_HISTORY_CREATE);
    await app.close();
  });

  describe('record history', () => {
    let mainTable: ITableFullVo;
    let foreignTable: ITableFullVo;

    beforeEach(async () => {
      mainTable = await createTable(baseId, { name: 'Main table' });
      foreignTable = await createTable(baseId, { name: 'Foreign table' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, mainTable.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('should get record history of changes in the base cell values', async () => {
      const recordId = mainTable.records[0].id;
      const textField = await createField(mainTable.id, {
        type: FieldType.SingleLineText,
      });

      const { data: originRecordHistory } = await getRecordHistory(mainTable.id, recordId, {});

      expect(recordHistoryVoSchema.safeParse(originRecordHistory).success).toEqual(true);
      expect(originRecordHistory.historyList.length).toEqual(0);

      await awaitWithEvent(() =>
        updateRecord(mainTable.id, recordId, {
          record: {
            fields: {
              [textField.id]: 'new value',
            },
          },
          fieldKeyType: FieldKeyType.Id,
        })
      );

      const { data: recordHistory } = await getRecordHistory(mainTable.id, recordId, {});
      const { data: tableRecordHistory } = await getRecordListHistory(mainTable.id, {});

      expect(recordHistory.historyList.length).toEqual(1);
      expect(tableRecordHistory.historyList.length).toEqual(1);
    });

    it('should get record history of changes in the modified cell values is referenced by a formula', async () => {
      const recordId = mainTable.records[0].id;
      const textField = await createField(mainTable.id, {
        type: FieldType.SingleLineText,
      });
      await createField(mainTable.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${textField.id}}`,
        },
      });

      await awaitWithEvent(() =>
        updateRecord(mainTable.id, recordId, {
          record: {
            fields: {
              [textField.id]: 'test',
            },
          },
          fieldKeyType: FieldKeyType.Id,
        })
      );

      const { data: mainTableRecordHistory } = await getRecordHistory(mainTable.id, recordId, {});

      expect(mainTableRecordHistory.historyList.length).toEqual(1);
    });

    it('should get record history of changes in the link field cell values', async () => {
      const recordId = mainTable.records[0].id;
      const foreignRecordId = foreignTable.records[0].id;
      const linkField = await createField(mainTable.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
        },
      });

      await awaitWithEvent(() =>
        updateRecord(mainTable.id, recordId, {
          record: {
            fields: {
              [linkField.id]: { id: foreignRecordId },
            },
          },
          fieldKeyType: FieldKeyType.Id,
        })
      );

      const { data: mainTableRecordHistory } = await getRecordHistory(mainTable.id, recordId, {});
      const { data: foreignTableRecordHistory } = await getRecordHistory(
        foreignTable.id,
        foreignRecordId,
        {}
      );

      expect(recordHistoryVoSchema.safeParse(mainTableRecordHistory).success).toEqual(true);
      expect(recordHistoryVoSchema.safeParse(foreignTableRecordHistory).success).toEqual(true);
    });
  });
});

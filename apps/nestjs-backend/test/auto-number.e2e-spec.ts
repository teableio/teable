import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { domainError, err, v2CoreTokens } from '@teable/v2-core';
import type { ITableRecordRepository } from '@teable/v2-core';
import { vi } from 'vitest';
import { RecordService } from '../src/features/record/record.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createField,
  createRecords,
  createTable,
  convertField,
  getRecords,
  initApp,
  permanentDeleteTable,
  deleteRecords,
} from './utils/init-app';

describe('Auto number continuity (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('when record creation fails', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, { name: `auto-number-${Date.now()}` });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should not advance autoNumber if the request fails before hitting the database', async () => {
      const initial = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const initialCount = initial.records.length;
      const maxAutoNumber =
        initial.records.reduce((max, r) => Math.max(max, r.autoNumber ?? 0), 0) || 0;

      const spy = isForceV2
        ? vi
            .spyOn(
              (await app.get(V2ContainerService).getContainer()).resolve<ITableRecordRepository>(
                v2CoreTokens.tableRecordRepository
              ),
              'insertMany'
            )
            .mockResolvedValueOnce(
              err(domainError.unexpected({ message: 'mocked-create-failure' }))
            )
        : vi
            .spyOn(app.get(RecordService), 'batchCreateRecords')
            .mockImplementationOnce(async () => {
              throw new Error('mocked-create-failure');
            });

      await createRecords(
        table.id,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [table.fields[0].id]: 'should-fail' } }],
        },
        500
      );
      spy.mockRestore();

      const { records: created } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table.fields[0].id]: 'ok' } }],
      });

      const after = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const finalMax = after.records.reduce((max, r) => Math.max(max, r.autoNumber ?? 0), 0) || 0;

      expect(after.records.length).toBe(initialCount + 1);
      expect(finalMax).toBe(maxAutoNumber + 1);
      expect(created[0].autoNumber).toBe(finalMax);
    });

    it('should keep autoNumber when missing required field then retry with value', async () => {
      let initial = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const maxAutoNumber =
        initial.records.reduce((max, r) => Math.max(max, r.autoNumber ?? 0), 0) || 0;
      if (initial.records.length) {
        await deleteRecords(
          table.id,
          initial.records.map((r) => r.id)
        );
        initial = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      }

      const initialCount = initial.records.length;

      let requiredField = await createField(table.id, {
        name: 'Required',
        type: FieldType.SingleLineText,
      });

      requiredField = await convertField(table.id, requiredField.id, {
        ...requiredField,
        notNull: true,
      });

      await createRecords(
        table.id,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [requiredField.id]: null } }],
        },
        400
      );

      const { records: created } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [requiredField.id]: 'ok' } }],
      });

      const after = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const finalMax = after.records.reduce((max, r) => Math.max(max, r.autoNumber ?? 0), 0) || 0;

      expect(after.records.length).toBe(initialCount + 1);
      expect(finalMax).toBe(maxAutoNumber + 1);
      expect(created[0].autoNumber).toBe(finalMax);
    });
  });
});

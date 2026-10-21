import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { getRecord, updateRecord } from '@teable/openapi';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/v2-attribution';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

const describeV2 = process.env.FORCE_V2_ALL === 'true' ? describe : describe.skip;

describeV2('Computed-only record updates (v2 e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 without changing values for a PATCH containing only system/computed fields', async () => {
    const table = await createTable(baseId, {
      name: 'Computed-only update',
      fields: [
        { name: 'Text', type: FieldType.SingleLineText },
        { name: 'Number', type: FieldType.AutoNumber },
        { name: 'Created', type: FieldType.CreatedTime },
      ],
      records: [{ fields: { Text: 'initial' } }],
    });

    try {
      const recordId = table.records[0].id;
      const before = await getRecord(table.id, recordId);
      expect(before.status).toBe(200);
      expect(before.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(before.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(before.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
      expect(before.data.fields).toMatchObject({ Text: 'initial', Number: 1 });
      expect(before.data.fields.Created).toEqual(expect.any(String));

      // Preserve the reported PATCH body: name keys, no fieldKeyType or typecast.
      const response = await updateRecord(table.id, recordId, {
        record: { fields: { Number: 999, Created: '2020-01-01T00:00:00.000Z' } },
      });
      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateRecord');
      expect(response.data.fields).toEqual(before.data.fields);

      const after = await getRecord(table.id, recordId);
      expect(after.status).toBe(200);
      expect(after.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(after.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(after.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
      expect(after.data.fields).toEqual(before.data.fields);

      const numberFieldId = table.fields.find((field) => field.name === 'Number')!.id;
      const byId = await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [numberFieldId]: 999 } },
      });
      expect(byId.status).toBe(200);
      expect(byId.data.fields[numberFieldId]).toBe(1);

      // An unknown field must not be mistaken for an ignored computed field.
      await expect(
        updateRecord(table.id, recordId, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [numberFieldId]: 999, fldUnknownField12345: 'invalid' } },
        })
      ).rejects.toMatchObject({ status: 404, code: 'not_found' });

      const mixed = await updateRecord(table.id, recordId, {
        record: { fields: { Text: 'updated', Number: 999 } },
      });
      expect(mixed.status).toBe(200);
      expect(mixed.data.fields).toMatchObject({ Text: 'updated', Number: 1 });
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('returns 400 instead of 500 when a PATCH has no updatable fields', async () => {
    const table = await createTable(baseId, {
      name: 'Empty update',
      fields: [{ name: 'Text', type: FieldType.SingleLineText }],
      records: [{ fields: { Text: 'initial' } }],
    });

    try {
      const recordId = table.records[0].id;

      await expect(
        updateRecord(table.id, recordId, {
          record: { fields: {} },
        })
      ).rejects.toMatchObject({ status: 400, code: 'validation_error' });

      const after = await getRecord(table.id, recordId);
      expect(after.status).toBe(200);
      expect(after.data.fields).toMatchObject({ Text: 'initial' });
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});

import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { axios } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { getFields, initApp, permanentDeleteTable } from './utils/init-app';

describe('Primary field creation validation (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    ({ app } = await initApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a second primary field without changing fields and still creates ordinary fields', async () => {
    const tableResponse = await axios.post<ITableFullVo>(`/base/${baseId}/table`, {
      name: 'primary-field-create-validation',
      fields: [{ name: 'Title', type: FieldType.SingleLineText, isPrimary: true }],
    });
    const table = tableResponse.data;
    try {
      expect(tableResponse.status).toBe(201);
      expect(tableResponse.headers['x-teable-v2']).toBe('true');
      const before = await getFields(table.id);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ name: 'Title', isPrimary: true });

      for (const suffix of ['', '/plan']) {
        const rejected = await axios.post(
          `/table/${table.id}/field${suffix}`,
          { name: 'Second primary', type: FieldType.SingleLineText, isPrimary: true },
          { validateStatus: () => true }
        );
        expect(rejected.status).toBe(400);
        expect(await getFields(table.id)).toEqual(before);
      }

      for (const isPrimary of [undefined, false]) {
        const created = await axios.post<IFieldVo>(`/table/${table.id}/field`, {
          name: isPrimary === false ? 'Explicit ordinary' : 'Ordinary',
          type: FieldType.SingleLineText,
          ...(isPrimary === false ? { isPrimary } : {}),
        });
        expect(created.status).toBe(201);
        expect(created.headers['x-teable-v2']).toBe('true');
        expect(created.data.isPrimary).not.toBe(true);
      }
      const after = await getFields(table.id);
      expect(after).toHaveLength(before.length + 2);
      expect(after.filter((field) => field.isPrimary)).toEqual([before[0]]);
      expect(after.some((field) => field.name === 'Second primary')).toBe(false);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});

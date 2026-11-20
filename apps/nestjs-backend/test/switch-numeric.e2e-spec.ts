import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, NumberFormattingType } from '@teable/core';
import type { IRecordsVo } from '@teable/openapi';
import { axios, X_CANARY_HEADER } from '@teable/openapi';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Numeric SWITCH in legacy formulas (e2e)', () => {
  const baseId = globalThis.testConfig.baseId;
  const headers = { [X_CANARY_HEADER]: 'false' };
  let app: INestApplication;
  let tableId: string | undefined;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'false';
    ({ app } = await initApp());
  });

  afterAll(async () => {
    try {
      if (tableId) await permanentDeleteTable(baseId, tableId);
    } finally {
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
      await app?.close();
    }
  });

  it('matches the stored number independently of display precision and branch types', async () => {
    const table = await createTable(baseId, {
      name: 'Numeric SWITCH',
      fields: [
        { name: 'a', type: FieldType.SingleLineText },
        {
          name: 'n',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
      ],
      records: [],
    });
    tableId = table.id;
    const [a, n] = table.fields;
    const input = [0, 1, 2, 3, 1.004, null];
    const { records } = await createRecords(table.id, {
      records: input.map((value) => ({ fields: { [a.id]: '中🙂', [n.id]: value } })),
    });

    const addFormula = async (name: string, expression: string) => {
      const response = await axios.post<IFieldVo>(
        `/table/${table.id}/field`,
        { name, type: FieldType.Formula, options: { expression } },
        { headers }
      );
      expect(response.status).toBe(201);
      expect(response.headers['x-teable-v2']).not.toBe('true');
      return response.data.id;
    };
    const numeric = await addFormula('Numeric result', `SWITCH({${n.id}}, 1, 1, 2, 3, 4)`);
    const text = await addFormula(
      'Text result',
      `SWITCH({${n.id}}, 0, "zero", 1.00, "x", 1, "late", 2, "y", "z")`
    );
    const mixed = await addFormula(
      'Mixed result',
      `SWITCH({${n.id}}, 1, "x", 2, {${a.id}}, {${a.id}} & "z")`
    );
    const mixedMatches = await addFormula(
      'Mixed match types',
      `SWITCH({${n.id}}, 1.00, "numeric", "other", "text", 1, "late", 2, "two", "default")`
    );

    const response = await axios.get<IRecordsVo>(`/table/${table.id}/record`, {
      headers,
      params: { fieldKeyType: FieldKeyType.Id },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).not.toBe('true');
    const byId = new Map(response.data.records.map((record) => [record.id, record.fields]));
    expect(
      records.map(({ id }) => [
        byId.get(id)?.[numeric],
        byId.get(id)?.[text],
        byId.get(id)?.[mixed],
        byId.get(id)?.[mixedMatches],
      ])
    ).toEqual([
      [4, 'zero', '中🙂z', 'default'],
      [1, 'x', 'x', 'numeric'],
      [3, 'y', '中🙂', 'two'],
      [4, 'z', '中🙂z', 'default'],
      [4, 'z', '中🙂z', 'default'],
      [4, 'z', '中🙂z', 'default'],
    ]);
  });
});

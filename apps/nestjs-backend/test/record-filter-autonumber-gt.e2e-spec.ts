import type { INestApplication } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { and, FieldKeyType, FieldType, isGreater } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, getRowCount } from '@teable/openapi';
import { createField, createTable, initApp, permanentDeleteTable } from './utils/init-app';

/**
 * T7071: autoNumber view-filter UI sent string values; v2 numeric comparison
 * rejected them and Nest row-count returned 500.
 *
 * Keep this file out of `v2CoveredV1TableIntegrationFiles` so the
 * postgres-community host matrix actually runs it.
 *
 * Fixture is sanitized and structure-equivalent: autoNumber field, isGreater,
 * string numeric value, Nest row-count + records API.
 */
describe('T7071: autoNumber greater-than filter with string value (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let autoNumberFieldId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    table = await createTable(baseId, {
      name: 'autonumber_gt_filter',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [
        { fields: { Title: 'A' } },
        { fields: { Title: 'B' } },
        { fields: { Title: 'C' } },
        { fields: { Title: 'D' } },
        { fields: { Title: 'E' } },
      ],
    });
    const autoNumberField = await createField(table.id, {
      name: 'No.',
      type: FieldType.AutoNumber,
    });
    autoNumberFieldId = autoNumberField.id;
  });

  afterAll(async () => {
    if (table) {
      await permanentDeleteTable(baseId, table.id);
    }
    await app.close();
  });

  const buildFilter = (value: string): IFilter => ({
    conjunction: and.value,
    filterSet: [{ fieldId: autoNumberFieldId, operator: isGreater.value, value }],
  });

  it('row-count accepts string numeric value from filter input', async () => {
    const { data: all } = await apiGetRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    const expected = all.records.filter(
      (record) => (record.fields[autoNumberFieldId] as number) > 2
    ).length;
    expect(expected).toBeGreaterThan(0);

    const { data } = await getRowCount(table.id, { filter: buildFilter('2') });
    expect(data.rowCount).toBe(expected);
  });

  it('records API matches row-count for string numeric greater-than', async () => {
    const { data: all } = await apiGetRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    const expected = all.records
      .map((record) => record.fields[autoNumberFieldId] as number)
      .filter((value) => value > 2)
      .sort((left, right) => left - right);

    const { data } = await apiGetRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      filter: buildFilter('2'),
    });
    const numbers = data.records
      .map((record) => record.fields[autoNumberFieldId] as number)
      .sort((left, right) => left - right);
    expect(numbers).toEqual(expected);
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
import {
  CellValueType,
  DriverClient,
  FieldType,
  SingleLineTextFieldCore,
  is,
  isNot,
} from '@teable/core';
import type { FieldCore, IFilter } from '@teable/core';
import knex from 'knex';
import type { IDbProvider } from '../../db.provider.interface';
import { FilterQueryPostgres } from '../postgres/filter-query.postgres';

const knexBuilder = knex({ client: 'pg' });
const dbProviderStub = { driver: DriverClient.Pg } as unknown as IDbProvider;

function createTextField(id: string, dbFieldName: string): SingleLineTextFieldCore {
  const field = new SingleLineTextFieldCore();
  field.id = id;
  field.name = id;
  field.dbFieldName = dbFieldName;
  field.type = FieldType.SingleLineText;
  field.options = SingleLineTextFieldCore.defaultOptions();
  field.cellValueType = CellValueType.String;
  field.isMultipleCellValue = false;
  field.isLookup = false;
  field.updateDbFieldType();
  return field;
}

function buildSql(field: FieldCore, filter: IFilter): string {
  const qb = knexBuilder('main_table as main');
  new FilterQueryPostgres(qb, { [field.id]: field }, filter, undefined, dbProviderStub, {
    selectionMap: new Map([[field.id, `"main"."${field.dbFieldName}"`]]),
  }).appendQueryBuilder();
  return qb.toQuery().replace(/\s+/g, ' ');
}

describe('numeric value on a text field filter', () => {
  // A numeric-looking value (e.g. a tracking number) arrives as a JS number per
  // literalValueSchema. Rendered to SQL it must be a quoted string, otherwise
  // Postgres rejects "text = bigint".
  const trackingNumber = 872985557030;

  it('renders "is" as a quoted string literal, not a bigint', () => {
    const field = createTextField('fld_text', 'tracking_number');
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: field.id, operator: is.value, value: trackingNumber }],
    };

    const sql = buildSql(field, filter);
    expect(sql).toContain(`"main"."tracking_number" = '${trackingNumber}'`);
    expect(sql).not.toMatch(new RegExp(`=\\s*${trackingNumber}(?!')`));
  });

  it('renders "isNot" as a quoted string literal, not a bigint', () => {
    const field = createTextField('fld_text', 'tracking_number');
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: field.id, operator: isNot.value, value: trackingNumber }],
    };

    const sql = buildSql(field, filter);
    expect(sql).toContain(`"main"."tracking_number" IS DISTINCT FROM '${trackingNumber}'`);
  });
});

import { StatisticsFunc, TableDomain, Tables } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import { PostgresProvider } from '../../../db-provider/postgres.provider';
import { createFieldInstanceByVo } from '../../field/model/factory';
import type { TableDomainQueryService } from '../../table-domain/table-domain-query.service';
import { PgRecordQueryDialect } from './providers/pg-record-query-dialect';
import { RecordQueryBuilderService } from './record-query-builder.service';

// Group fields excluded from the projection (e.g. by field-level permissions)
// fall back to their raw dbFieldName, which must be quoted or Postgres folds
// case-sensitive names to lower case and fails with 42703.

const MAIN_TABLE_ID = 'tblMainGroupQuoting1';
const FOREIGN_TABLE_ID = 'tblForeignGroupQuot1';
const MAIN_DB_TABLE = 'test_base.MainTable';
const FOREIGN_DB_TABLE = 'test_base.ForeignTable';

const PRIMARY_ID = 'fldPrimaryGroupQuot1';
const LINK_ID = 'fldLinkGroupQuoting1';
const LOOKUP_ID = 'fldLookupGroupQuot01';
const SELECT_ID = 'fldSelectGroupQuot01';
const FOREIGN_PRIMARY_ID = 'fldForeignPrimary001';
const FOREIGN_SELECT_ID = 'fldForeignSelect0001';

const choices = [
  { name: 'Alpha', id: 'choAlpha', color: 'greenBright' },
  { name: 'Beta', id: 'choBeta', color: 'purpleBright' },
];

const mainFields = [
  {
    id: PRIMARY_ID,
    name: 'Report Name',
    dbFieldName: 'Label',
    type: 'singleLineText',
    options: {},
    dbFieldType: 'TEXT',
    cellValueType: 'string',
    isPrimary: true,
  },
  {
    id: LINK_ID,
    name: 'All Clients',
    dbFieldName: 'All_Clients',
    type: 'link',
    options: {
      relationship: 'manyOne',
      foreignTableId: FOREIGN_TABLE_ID,
      isOneWay: false,
      symmetricFieldId: 'fldSymmetric00000001',
      lookupFieldId: FOREIGN_PRIMARY_ID,
      fkHostTableName: MAIN_DB_TABLE,
      selfKeyName: '__id',
      foreignKeyName: `__fk_${LINK_ID}`,
    },
    dbFieldType: 'JSON',
    cellValueType: 'string',
  },
  {
    id: LOOKUP_ID,
    name: 'Services (Synced)',
    dbFieldName: 'Services_Synced',
    type: 'singleSelect',
    isLookup: true,
    isComputed: true,
    lookupOptions: {
      foreignTableId: FOREIGN_TABLE_ID,
      lookupFieldId: FOREIGN_SELECT_ID,
      linkFieldId: LINK_ID,
      relationship: 'manyOne',
      fkHostTableName: MAIN_DB_TABLE,
      selfKeyName: '__id',
      foreignKeyName: `__fk_${LINK_ID}`,
    },
    options: { choices },
    dbFieldType: 'TEXT',
    cellValueType: 'string',
  },
  {
    id: SELECT_ID,
    name: 'Services',
    dbFieldName: 'Services',
    type: 'singleSelect',
    options: { choices },
    dbFieldType: 'TEXT',
    cellValueType: 'string',
  },
] as unknown as IFieldVo[];

const foreignFields = [
  {
    id: FOREIGN_PRIMARY_ID,
    name: 'Client',
    dbFieldName: 'Client',
    type: 'singleLineText',
    options: {},
    dbFieldType: 'TEXT',
    cellValueType: 'string',
    isPrimary: true,
  },
  {
    id: FOREIGN_SELECT_ID,
    name: 'Services',
    dbFieldName: 'Services',
    type: 'singleSelect',
    options: { choices },
    dbFieldType: 'TEXT',
    cellValueType: 'string',
  },
] as unknown as IFieldVo[];

function buildService() {
  const knex = knexFactory({ client: 'pg' });
  const mainDomain = new TableDomain({
    id: MAIN_TABLE_ID,
    name: 'Main',
    dbTableName: MAIN_DB_TABLE,
    lastModifiedTime: new Date().toISOString(),
    fields: mainFields.map((f) => createFieldInstanceByVo(f)),
  });
  const foreignDomain = new TableDomain({
    id: FOREIGN_TABLE_ID,
    name: 'Foreign',
    dbTableName: FOREIGN_DB_TABLE,
    lastModifiedTime: new Date().toISOString(),
    fields: foreignFields.map((f) => createFieldInstanceByVo(f)),
  });
  const tables = new Tables(
    MAIN_TABLE_ID,
    new Map([
      [MAIN_TABLE_ID, mainDomain],
      [FOREIGN_TABLE_ID, foreignDomain],
    ]),
    new Set([MAIN_TABLE_ID, FOREIGN_TABLE_ID])
  );
  const tableDomainQueryService = {
    getAllRelatedTableDomains: async () => tables,
    getTableDomainById: async () => mainDomain,
  } as unknown as TableDomainQueryService;
  const dbProvider = new PostgresProvider(knex);
  const dialect = new PgRecordQueryDialect(knex);
  const service = new RecordQueryBuilderService(tableDomainQueryService, dbProvider, knex, dialect);
  return { service, knex };
}

async function buildGroupedAggregateSql(projection?: string[]) {
  const { service, knex } = buildService();
  const builder = knex
    .queryBuilder()
    .with('permission_view', knex.raw(`select * from ??`, [MAIN_DB_TABLE]));
  const { qb } = await service.createRecordAggregateBuilder('permission_view', {
    tableId: MAIN_TABLE_ID,
    viewId: 'viwGroupQuoting00001',
    aggregationFields: [
      { fieldId: PRIMARY_ID, statisticFunc: StatisticsFunc.Filled, alias: `${PRIMARY_ID}_filled` },
    ],
    groupBy: [
      { fieldId: LOOKUP_ID, order: 'asc' },
      { fieldId: SELECT_ID, order: 'asc' },
    ] as never,
    projection,
    useQueryModel: false,
    builder,
  });
  return qb.toQuery();
}

const bareIdentifiers = (sql: string) =>
  sql.match(/(?<!")\b(?:Services_Synced|Services|All_Clients|Label)\b(?!")/g);

describe('createRecordAggregateBuilder group column quoting', () => {
  it('keeps projected group columns qualified and quoted', async () => {
    const sql = await buildGroupedAggregateSql([PRIMARY_ID, LINK_ID, LOOKUP_ID, SELECT_ID]);

    expect(sql).toContain(
      `group by "t_${MAIN_TABLE_ID}"."Services_Synced", "t_${MAIN_TABLE_ID}"."Services"`
    );
    expect(bareIdentifiers(sql)).toBeNull();
  });

  it('quotes the dbFieldName fallback for group fields excluded from the projection', async () => {
    // The second group field is missing from the projection, so it has no
    // selection entry and resolves through the dbFieldName fallback.
    const sql = await buildGroupedAggregateSql([PRIMARY_ID, LOOKUP_ID]);

    expect(sql).toContain(`group by "t_${MAIN_TABLE_ID}"."Services_Synced", "Services"`);
    expect(bareIdentifiers(sql)).toBeNull();
  });
});

import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  LinkFieldConfig,
  LookupOptions,
  RecordId,
  Table,
  TableId,
  TableName,
  domainError,
  ok,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { err } from 'neverthrow';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';

const BASE_ID = `bse${'a'.repeat(16)}`;
const ORDERS_ID = `tbl${'o'.repeat(16)}`;
const CUSTOMERS_ID = `tbl${'c'.repeat(16)}`;
const X_ID = `fld${'x'.repeat(16)}`;
const ROUNDED_ID = `fld${'r'.repeat(16)}`;
const B_ID = `fld${'b'.repeat(16)}`;
const NOW_ID = `fld${'w'.repeat(16)}`;
const LINK_ID = `fld${'l'.repeat(16)}`;
const LOOKUP_ID = `fld${'k'.repeat(16)}`;
const LOOKUP_NOW_ID = `fld${'m'.repeat(16)}`;
const LOOKUP_B_ID = `fld${'u'.repeat(16)}`;
const NAME_ID = `fld${'n'.repeat(16)}`;
const INVOICES_ID = `tbl${'i'.repeat(16)}`;
const INVOICE_LINK_ID = `fld${'v'.repeat(16)}`;
const INVOICE_LOOKUP_ID = `fld${'y'.repeat(16)}`;
const INVOICE_NAME_ID = `fld${'z'.repeat(16)}`;
const ACTOR_ID = 'usr_test';
const FK = `__fk_${LINK_ID}`;
const INVOICE_FK = `__fk_${INVOICE_LINK_ID}`;

const rec = (ch: string) => `rec${ch.repeat(16)}`;

const lookupNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (Array.isArray(value) && value.length === 1) return lookupNumber(value[0]);
  return Number.NaN;
};

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

const createTableRepository = (tables: ReadonlyArray<Table>): ITableRepository => ({
  insert: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.insert not used in tests' })),
  insertMany: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.insertMany not used in tests' })),
  findOne: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.findOne not used in tests' })),
  find: async () => ok(tables),
  updateOne: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.updateOne not used in tests' })),
  delete: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.delete not used in tests' })),
  restore: async () =>
    err(domainError.notImplemented({ message: 'ITableRepository.restore not used in tests' })),
});

const createUpdater = (db: PGliteTestDb['db'], tables: ReadonlyArray<Table>) =>
  new ComputedFieldUpdater(
    createTableRepository(tables),
    createLogger(),
    db,
    undefined,
    new Pg16TypeValidationStrategy()
  );

type LinkedTables = {
  baseId: BaseId;
  orders: Table;
  customers: Table;
  xId: FieldId;
  roundedId: FieldId;
  bId: FieldId;
  nowId: FieldId;
  linkId: FieldId;
  lookupId: FieldId;
};

const createLinkedTables = (options?: { withB?: boolean; withNow?: boolean }): LinkedTables => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const ordersId = TableId.create(ORDERS_ID)._unsafeUnwrap();
  const customersId = TableId.create(CUSTOMERS_ID)._unsafeUnwrap();
  const xId = FieldId.create(X_ID)._unsafeUnwrap();
  const roundedId = FieldId.create(ROUNDED_ID)._unsafeUnwrap();
  const bId = FieldId.create(B_ID)._unsafeUnwrap();
  const nowId = FieldId.create(NOW_ID)._unsafeUnwrap();
  const linkId = FieldId.create(LINK_ID)._unsafeUnwrap();
  const lookupId = FieldId.create(LOOKUP_ID)._unsafeUnwrap();
  const nameId = FieldId.create(NAME_ID)._unsafeUnwrap();

  const ordersBuilder = Table.builder()
    .withId(ordersId)
    .withBaseId(baseId)
    .withName(TableName.create('Orders')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${BASE_ID}.${ORDERS_ID}`)._unsafeUnwrap());
  ordersBuilder.field().number().withId(xId).withName(FieldName.create('X')._unsafeUnwrap()).done();
  ordersBuilder
    .field()
    .formula()
    .withId(roundedId)
    .withName(FieldName.create('Rounded')._unsafeUnwrap())
    .withExpression(FormulaExpression.create(`ROUND({${X_ID}}, 0)`)._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  if (options?.withB) {
    ordersBuilder
      .field()
      .formula()
      .withId(bId)
      .withName(FieldName.create('B')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`{${ROUNDED_ID}} + {${X_ID}}`)._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
  }
  if (options?.withNow) {
    ordersBuilder
      .field()
      .formula()
      .withId(nowId)
      .withName(FieldName.create('Now')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('NOW()')._unsafeUnwrap())
      .done();
  }
  ordersBuilder.view().defaultGrid().done();
  const orders = ordersBuilder.build()._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(xId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_x')._unsafeUnwrap())
    ._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(roundedId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_rounded')._unsafeUnwrap())
    ._unsafeUnwrap();
  if (options?.withB) {
    orders
      .getField((field) => field.id().equals(bId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_b')._unsafeUnwrap())
      ._unsafeUnwrap();
  }
  if (options?.withNow) {
    orders
      .getField((field) => field.id().equals(nowId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_now')._unsafeUnwrap())
      ._unsafeUnwrap();
  }

  const roundedField = orders.getField((field) => field.id().equals(roundedId))._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: ORDERS_ID,
    lookupFieldId: X_ID,
    fkHostTableName: `${BASE_ID}.${CUSTOMERS_ID}`,
    selfKeyName: '__id',
    foreignKeyName: FK,
  })._unsafeUnwrap();
  const lookupOptions = LookupOptions.create({
    linkFieldId: LINK_ID,
    lookupFieldId: options?.withNow ? NOW_ID : ROUNDED_ID,
    foreignTableId: ORDERS_ID,
  })._unsafeUnwrap();

  const customersBuilder = Table.builder()
    .withId(customersId)
    .withBaseId(baseId)
    .withName(TableName.create('Customers')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${BASE_ID}.${CUSTOMERS_ID}`)._unsafeUnwrap());
  customersBuilder
    .field()
    .singleLineText()
    .withId(nameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  customersBuilder
    .field()
    .link()
    .withId(linkId)
    .withName(FieldName.create('Order')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  customersBuilder
    .field()
    .lookup()
    .withId(lookupId)
    .withName(FieldName.create('RoundedLookup')._unsafeUnwrap())
    .withLookupOptions(lookupOptions)
    .withInnerField(
      options?.withNow
        ? orders.getField((field) => field.id().equals(nowId))._unsafeUnwrap()
        : roundedField
    )
    .done();
  customersBuilder.view().defaultGrid().done();
  const customers = customersBuilder.build()._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(nameId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(linkId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(lookupId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { baseId, orders, customers, xId, roundedId, bId, nowId, linkId, lookupId };
};

const createSchemaSql = (options?: { withB?: boolean; withNow?: boolean }) => `
  CREATE SCHEMA "${BASE_ID}";
  CREATE TABLE "${BASE_ID}"."${ORDERS_ID}" (
    __id text PRIMARY KEY,
    __version integer NOT NULL,
    col_x double precision
    ${options?.withNow ? ', col_now timestamptz' : ', col_rounded double precision'}
    ${options?.withB ? ', col_b double precision' : ''}
  );
  CREATE TABLE "${BASE_ID}"."${CUSTOMERS_ID}" (
    __id text PRIMARY KEY,
    __version integer NOT NULL,
    col_name text,
    col_link jsonb,
    "${FK}" text,
    col_lookup jsonb
  );
  CREATE TABLE customer_updates (executed boolean NOT NULL);
  CREATE FUNCTION record_customer_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO customer_updates VALUES (true);
      RETURN NULL;
    END;
  $$;
  CREATE TRIGGER track_customer_update
    AFTER UPDATE ON "${BASE_ID}"."${CUSTOMERS_ID}"
    FOR EACH STATEMENT EXECUTE FUNCTION record_customer_update();
`;

const createCascadeTables = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const ordersId = TableId.create(ORDERS_ID)._unsafeUnwrap();
  const customersId = TableId.create(CUSTOMERS_ID)._unsafeUnwrap();
  const invoicesId = TableId.create(INVOICES_ID)._unsafeUnwrap();
  const xId = FieldId.create(X_ID)._unsafeUnwrap();
  const roundedId = FieldId.create(ROUNDED_ID)._unsafeUnwrap();
  const bId = FieldId.create(B_ID)._unsafeUnwrap();
  const nowId = FieldId.create(NOW_ID)._unsafeUnwrap();
  const linkId = FieldId.create(LINK_ID)._unsafeUnwrap();
  const lookupRoundId = FieldId.create(LOOKUP_ID)._unsafeUnwrap();
  const lookupNowId = FieldId.create(LOOKUP_NOW_ID)._unsafeUnwrap();
  const lookupBId = FieldId.create(LOOKUP_B_ID)._unsafeUnwrap();
  const nameId = FieldId.create(NAME_ID)._unsafeUnwrap();
  const invoiceLinkId = FieldId.create(INVOICE_LINK_ID)._unsafeUnwrap();
  const invoiceLookupId = FieldId.create(INVOICE_LOOKUP_ID)._unsafeUnwrap();
  const invoiceNameId = FieldId.create(INVOICE_NAME_ID)._unsafeUnwrap();

  const ordersBuilder = Table.builder()
    .withId(ordersId)
    .withBaseId(baseId)
    .withName(TableName.create('Orders')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${BASE_ID}.${ORDERS_ID}`)._unsafeUnwrap());
  ordersBuilder.field().number().withId(xId).withName(FieldName.create('X')._unsafeUnwrap()).done();
  ordersBuilder
    .field()
    .formula()
    .withId(roundedId)
    .withName(FieldName.create('Rounded')._unsafeUnwrap())
    .withExpression(FormulaExpression.create(`ROUND({${X_ID}}, 0)`)._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  ordersBuilder
    .field()
    .formula()
    .withId(nowId)
    .withName(FieldName.create('Now')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('NOW()')._unsafeUnwrap())
    .done();
  ordersBuilder
    .field()
    .formula()
    .withId(bId)
    .withName(FieldName.create('B')._unsafeUnwrap())
    .withExpression(FormulaExpression.create(`{${ROUNDED_ID}} + {${X_ID}}`)._unsafeUnwrap())
    .withResultType({
      cellValueType: CellValueType.number(),
      isMultipleCellValue: CellValueMultiplicity.single(),
    })
    .done();
  ordersBuilder.view().defaultGrid().done();
  const orders = ordersBuilder.build()._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(xId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_x')._unsafeUnwrap())
    ._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(roundedId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_rounded')._unsafeUnwrap())
    ._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(nowId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_now')._unsafeUnwrap())
    ._unsafeUnwrap();
  orders
    .getField((field) => field.id().equals(bId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_b')._unsafeUnwrap())
    ._unsafeUnwrap();

  const roundedField = orders.getField((field) => field.id().equals(roundedId))._unsafeUnwrap();
  const nowField = orders.getField((field) => field.id().equals(nowId))._unsafeUnwrap();
  const bField = orders.getField((field) => field.id().equals(bId))._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: ORDERS_ID,
    lookupFieldId: X_ID,
    fkHostTableName: `${BASE_ID}.${CUSTOMERS_ID}`,
    selfKeyName: '__id',
    foreignKeyName: FK,
  })._unsafeUnwrap();

  const customersBuilder = Table.builder()
    .withId(customersId)
    .withBaseId(baseId)
    .withName(TableName.create('Customers')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${BASE_ID}.${CUSTOMERS_ID}`)._unsafeUnwrap());
  customersBuilder
    .field()
    .singleLineText()
    .withId(nameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  customersBuilder
    .field()
    .link()
    .withId(linkId)
    .withName(FieldName.create('Order')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  customersBuilder
    .field()
    .lookup()
    .withId(lookupRoundId)
    .withName(FieldName.create('RoundedLookup')._unsafeUnwrap())
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: LINK_ID,
        lookupFieldId: ROUNDED_ID,
        foreignTableId: ORDERS_ID,
      })._unsafeUnwrap()
    )
    .withInnerField(roundedField)
    .done();
  customersBuilder
    .field()
    .lookup()
    .withId(lookupNowId)
    .withName(FieldName.create('NowLookup')._unsafeUnwrap())
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: LINK_ID,
        lookupFieldId: NOW_ID,
        foreignTableId: ORDERS_ID,
      })._unsafeUnwrap()
    )
    .withInnerField(nowField)
    .done();
  customersBuilder
    .field()
    .lookup()
    .withId(lookupBId)
    .withName(FieldName.create('BLookup')._unsafeUnwrap())
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: LINK_ID,
        lookupFieldId: B_ID,
        foreignTableId: ORDERS_ID,
      })._unsafeUnwrap()
    )
    .withInnerField(bField)
    .done();
  customersBuilder.view().defaultGrid().done();
  const customers = customersBuilder.build()._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(nameId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(linkId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(lookupRoundId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_round')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(lookupNowId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_now')._unsafeUnwrap())
    ._unsafeUnwrap();
  customers
    .getField((field) => field.id().equals(lookupBId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup_b')._unsafeUnwrap())
    ._unsafeUnwrap();

  const lookupRoundField = customers
    .getField((field) => field.id().equals(lookupRoundId))
    ._unsafeUnwrap();
  const invoicesBuilder = Table.builder()
    .withId(invoicesId)
    .withBaseId(baseId)
    .withName(TableName.create('Invoices')._unsafeUnwrap())
    .withDbTableName(DbTableName.rehydrate(`${BASE_ID}.${INVOICES_ID}`)._unsafeUnwrap());
  invoicesBuilder
    .field()
    .singleLineText()
    .withId(invoiceNameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  invoicesBuilder
    .field()
    .link()
    .withId(invoiceLinkId)
    .withName(FieldName.create('Customer')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: CUSTOMERS_ID,
        lookupFieldId: LOOKUP_ID,
        fkHostTableName: `${BASE_ID}.${INVOICES_ID}`,
        selfKeyName: '__id',
        foreignKeyName: INVOICE_FK,
      })._unsafeUnwrap()
    )
    .done();
  invoicesBuilder
    .field()
    .lookup()
    .withId(invoiceLookupId)
    .withName(FieldName.create('RoundedViaCustomer')._unsafeUnwrap())
    .withLookupOptions(
      LookupOptions.create({
        linkFieldId: INVOICE_LINK_ID,
        lookupFieldId: LOOKUP_ID,
        foreignTableId: CUSTOMERS_ID,
      })._unsafeUnwrap()
    )
    .withInnerField(lookupRoundField)
    .done();
  invoicesBuilder.view().defaultGrid().done();
  const invoices = invoicesBuilder.build()._unsafeUnwrap();
  invoices
    .getField((field) => field.id().equals(invoiceNameId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  invoices
    .getField((field) => field.id().equals(invoiceLinkId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
    ._unsafeUnwrap();
  invoices
    .getField((field) => field.id().equals(invoiceLookupId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_lookup')._unsafeUnwrap())
    ._unsafeUnwrap();

  return {
    baseId,
    orders,
    customers,
    invoices,
    xId,
    roundedId,
    bId,
    nowId,
    linkId,
    lookupRoundId,
    lookupNowId,
    lookupBId,
    invoiceLinkId,
    invoiceLookupId,
  };
};

const createCascadeSchemaSql = () => `
  CREATE SCHEMA "${BASE_ID}";
  CREATE TABLE "${BASE_ID}"."${ORDERS_ID}" (
    __id text PRIMARY KEY,
    __version integer NOT NULL,
    col_x double precision,
    col_rounded double precision,
    col_now timestamptz,
    col_b double precision
  );
  CREATE TABLE "${BASE_ID}"."${CUSTOMERS_ID}" (
    __id text PRIMARY KEY,
    __version integer NOT NULL,
    col_name text,
    col_link jsonb,
    "${FK}" text,
    col_lookup_round jsonb,
    col_lookup_now jsonb,
    col_lookup_b jsonb
  );
  CREATE TABLE "${BASE_ID}"."${INVOICES_ID}" (
    __id text PRIMARY KEY,
    __version integer NOT NULL,
    col_name text,
    col_link jsonb,
    "${INVOICE_FK}" text,
    col_lookup jsonb
  );
`;

const cascadePlan = (tables: ReturnType<typeof createCascadeTables>): ComputedUpdatePlan => ({
  baseId: tables.baseId,
  seedTableId: tables.orders.id(),
  seedRecordIds: [],
  extraSeedRecords: [],
  changedFieldIds: [tables.xId],
  steps: [
    { tableId: tables.orders.id(), fieldIds: [tables.roundedId, tables.nowId], level: 0 },
    { tableId: tables.orders.id(), fieldIds: [tables.bId], level: 1 },
    {
      tableId: tables.customers.id(),
      fieldIds: [tables.lookupRoundId, tables.lookupNowId, tables.lookupBId],
      level: 2,
    },
    { tableId: tables.invoices.id(), fieldIds: [tables.invoiceLookupId], level: 3 },
  ],
  edges: [
    {
      fromTableId: tables.orders.id(),
      toTableId: tables.customers.id(),
      fromFieldId: tables.roundedId,
      toFieldId: tables.lookupRoundId,
      propagationSourceFieldIds: [tables.roundedId],
      propagationTargetFieldIds: [tables.lookupRoundId],
      linkFieldId: tables.linkId,
      propagationMode: 'linkTraversal',
      order: 0,
    },
    {
      fromTableId: tables.orders.id(),
      toTableId: tables.customers.id(),
      fromFieldId: tables.nowId,
      toFieldId: tables.lookupNowId,
      propagationSourceFieldIds: [tables.nowId],
      propagationTargetFieldIds: [tables.lookupNowId],
      linkFieldId: tables.linkId,
      propagationMode: 'linkTraversal',
      order: 1,
    },
    {
      fromTableId: tables.orders.id(),
      toTableId: tables.customers.id(),
      fromFieldId: tables.bId,
      toFieldId: tables.lookupBId,
      propagationSourceFieldIds: [tables.bId],
      propagationTargetFieldIds: [tables.lookupBId],
      linkFieldId: tables.linkId,
      propagationMode: 'linkTraversal',
      order: 2,
    },
    {
      fromTableId: tables.customers.id(),
      toTableId: tables.invoices.id(),
      fromFieldId: tables.lookupRoundId,
      toFieldId: tables.invoiceLookupId,
      propagationSourceFieldIds: [tables.lookupRoundId],
      propagationTargetFieldIds: [tables.invoiceLookupId],
      linkFieldId: tables.invoiceLinkId,
      propagationMode: 'linkTraversal',
      order: 3,
    },
  ],
  estimatedComplexity: 4,
  changeType: 'update',
  sameTableBatches: [],
});

describe('value-gated link propagation', () => {
  let data: PGliteTestDb | undefined;

  afterEach(async () => {
    if (data) {
      await data.db.destroy();
      data = undefined;
    }
  });

  it('does not dirty a lookup when ROUND is unchanged', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, roundedId, lookupId, linkId, xId } = createLinkedTables();
    await data.pglite.exec(createSchemaSql());
    const orderId = rec('1');
    const customerId = rec('4');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES ('${orderId}', 1, 1.4, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}"
        VALUES ('${customerId}', 1, 'c1', NULL, '${orderId}', '1'::jsonb);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [roundedId], level: 0 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 1 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: roundedId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [roundedId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };
    await data.db.transaction().execute(async (trx) => {
      const result = await createUpdater(trx, [orders, customers]).execute(
        plan,
        { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
        undefined,
        { collectChanges: true }
      );
      expect(result.isOk()).toBe(true);
    });

    const order = (
      await data.pglite.query(
        `SELECT col_rounded FROM "${BASE_ID}"."${ORDERS_ID}" WHERE __id = '${orderId}'`
      )
    ).rows[0] as { col_rounded: number };
    expect(order.col_rounded).toBe(1);
    const customer = (
      await data.pglite.query(
        `SELECT __version, col_lookup FROM "${BASE_ID}"."${CUSTOMERS_ID}" WHERE __id = '${customerId}'`
      )
    ).rows[0] as { __version: number; col_lookup: unknown };
    expect(customer.__version).toBe(1);
    expect((await data.pglite.query('SELECT * FROM customer_updates')).rows).toEqual([]);
  });

  it('dirties only linked targets of orders whose ROUND changed', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, roundedId, lookupId, linkId, xId } = createLinkedTables();
    await data.pglite.exec(createSchemaSql());
    const orderIds = [rec('1'), rec('2'), rec('3')];
    const customerIds = [rec('4'), rec('5'), rec('6')];
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES
        ('${orderIds[0]}', 1, 1.4, 1),
        ('${orderIds[1]}', 1, 2.4, 1),
        ('${orderIds[2]}', 1, 1.2, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}" VALUES
        ('${customerIds[0]}', 1, 'c1', NULL, '${orderIds[0]}', '1'::jsonb),
        ('${customerIds[1]}', 1, 'c2', NULL, '${orderIds[1]}', '1'::jsonb),
        ('${customerIds[2]}', 1, 'c3', NULL, '${orderIds[2]}', '1'::jsonb);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: orderIds.map((id) => RecordId.create(id)._unsafeUnwrap()),
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [roundedId], level: 0 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 1 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: roundedId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [roundedId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    await data.db.transaction().execute(async (trx) => {
      (
        await createUpdater(trx, [orders, customers]).execute(
          plan,
          { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
          undefined,
          { collectChanges: true }
        )
      )._unsafeUnwrap();
    });

    const orderRows = (
      await data.pglite.query(
        `SELECT __id, col_rounded FROM "${BASE_ID}"."${ORDERS_ID}" ORDER BY __id`
      )
    ).rows as Array<{ __id: string; col_rounded: number }>;
    expect(orderRows.map((row) => [row.__id, row.col_rounded])).toEqual([
      [orderIds[0], 1],
      [orderIds[1], 2],
      [orderIds[2], 1],
    ]);
    const rows = (
      await data.pglite.query(
        `SELECT __id, __version FROM "${BASE_ID}"."${CUSTOMERS_ID}" ORDER BY __id`
      )
    ).rows as Array<{ __id: string; __version: number }>;
    expect(rows.filter((row) => row.__version === 2).map((row) => row.__id)).toEqual([
      customerIds[1],
    ]);
    expect(rows.filter((row) => row.__version === 1)).toHaveLength(2);
  });

  it('eager-propagates NOW() formulas that do not support the value frontier', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, nowId, lookupId, linkId, xId } = createLinkedTables({
      withNow: true,
    });
    await data.pglite.exec(createSchemaSql({ withNow: true }));
    const orderId = rec('1');
    const customerId = rec('4');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES ('${orderId}', 1, 1.4, NOW());
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}"
        VALUES ('${customerId}', 1, 'c1', NULL, '${orderId}', NULL);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [nowId], level: 0 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 1 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: nowId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [nowId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    await data.db.transaction().execute(async (trx) => {
      const preparedResult = await createUpdater(trx, [orders, customers]).prepareDirtyState(
        plan,
        { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
        { deferValueGatedEdges: true }
      );
      expect(preparedResult.isOk()).toBe(true);
      const prepared = preparedResult._unsafeUnwrap();
      expect(
        prepared.dirtyStats.some(
          (stat) => stat.tableId === customers.id().toString() && stat.recordCount > 0
        )
      ).toBe(true);
    });
  });

  it('still computes same-table B=A+X when A is unchanged and skips lookup of A', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, roundedId, bId, lookupId, linkId, xId } = createLinkedTables(
      {
        withB: true,
      }
    );
    await data.pglite.exec(createSchemaSql({ withB: true }));
    const orderId = rec('1');
    const customerId = rec('4');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES ('${orderId}', 1, 1.4, 1, 2.2);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}"
        VALUES ('${customerId}', 1, 'c1', NULL, '${orderId}', '1'::jsonb);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [roundedId], level: 0 },
        { tableId: orders.id(), fieldIds: [bId], level: 1 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 2 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: roundedId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [roundedId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 3,
      changeType: 'update',
      sameTableBatches: [],
    };

    await data.db.transaction().execute(async (trx) => {
      (
        await createUpdater(trx, [orders, customers]).execute(
          plan,
          { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
          undefined,
          { collectChanges: true }
        )
      )._unsafeUnwrap();
    });

    const order = (
      await data.pglite.query(
        `SELECT col_rounded, col_b FROM "${BASE_ID}"."${ORDERS_ID}" WHERE __id = '${orderId}'`
      )
    ).rows[0] as { col_rounded: number; col_b: number };
    expect(order.col_rounded).toBe(1);
    expect(order.col_b).toBe(2.4);

    const customer = (
      await data.pglite.query(
        `SELECT __version FROM "${BASE_ID}"."${CUSTOMERS_ID}" WHERE __id = '${customerId}'`
      )
    ).rows[0] as { __version: number };
    expect(customer.__version).toBe(1);
    expect((await data.pglite.query('SELECT * FROM customer_updates')).rows).toEqual([]);
  });

  it('continues A.formula → B.lookup → C.lookup after a delayed A→B flush', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, roundedId, lookupId, linkId, xId } = createLinkedTables();
    const invoicesId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
    const invoiceLinkId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
    const invoiceLookupId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
    const invoiceNameId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
    const invoiceFk = `__fk_${invoiceLinkId.toString()}`;
    const customerLookupResult = customers.getField((field) => field.id().equals(lookupId));
    expect(
      customerLookupResult.isOk() ? 'ok' : customerLookupResult._unsafeUnwrapErr().message
    ).toBe('ok');
    const customerLookup = customerLookupResult._unsafeUnwrap();
    const invoiceLinkConfigResult = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: CUSTOMERS_ID,
      lookupFieldId: lookupId.toString(),
      fkHostTableName: `${BASE_ID}.${invoicesId.toString()}`,
      selfKeyName: '__id',
      foreignKeyName: invoiceFk,
    });
    expect(
      invoiceLinkConfigResult.isOk() ? 'ok' : invoiceLinkConfigResult._unsafeUnwrapErr().message
    ).toBe('ok');
    const invoiceLinkConfig = invoiceLinkConfigResult._unsafeUnwrap();
    const invoiceLookupOptionsResult = LookupOptions.create({
      linkFieldId: invoiceLinkId.toString(),
      lookupFieldId: lookupId.toString(),
      foreignTableId: CUSTOMERS_ID,
    });
    expect(
      invoiceLookupOptionsResult.isOk()
        ? 'ok'
        : invoiceLookupOptionsResult._unsafeUnwrapErr().message
    ).toBe('ok');
    const invoiceLookupOptions = invoiceLookupOptionsResult._unsafeUnwrap();
    const invoicesBuilder = Table.builder()
      .withId(invoicesId)
      .withBaseId(baseId)
      .withName(TableName.create('Invoices')._unsafeUnwrap())
      .withDbTableName(
        DbTableName.rehydrate(`${BASE_ID}.${invoicesId.toString()}`)._unsafeUnwrap()
      );
    invoicesBuilder
      .field()
      .singleLineText()
      .withId(invoiceNameId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    invoicesBuilder
      .field()
      .link()
      .withId(invoiceLinkId)
      .withName(FieldName.create('Customer')._unsafeUnwrap())
      .withConfig(invoiceLinkConfig)
      .done();
    invoicesBuilder
      .field()
      .lookup()
      .withId(invoiceLookupId)
      .withName(FieldName.create('RoundedViaCustomer')._unsafeUnwrap())
      .withLookupOptions(invoiceLookupOptions)
      .withInnerField(customerLookup)
      .done();
    invoicesBuilder.view().defaultGrid().done();
    const invoicesResult = invoicesBuilder.build();
    expect(invoicesResult.isOk() ? 'ok' : invoicesResult._unsafeUnwrapErr().message).toBe('ok');
    const invoices = invoicesResult._unsafeUnwrap();
    invoices
      .getField((field) => field.id().equals(invoiceNameId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    invoices
      .getField((field) => field.id().equals(invoiceLinkId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
      ._unsafeUnwrap();
    invoices
      .getField((field) => field.id().equals(invoiceLookupId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_lookup')._unsafeUnwrap())
      ._unsafeUnwrap();

    await data.pglite.exec(createSchemaSql());
    await data.pglite.exec(`
      CREATE TABLE "${BASE_ID}"."${invoicesId.toString()}" (
        __id text PRIMARY KEY,
        __version integer NOT NULL,
        col_name text,
        col_link jsonb,
        "${invoiceFk}" text,
        col_lookup jsonb
      );
    `);
    const orderId = rec('1');
    const customerId = rec('4');
    const invoiceId = rec('7');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES ('${orderId}', 1, 2.4, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}"
        VALUES ('${customerId}', 1, 'c1', NULL, '${orderId}', '1'::jsonb);
      INSERT INTO "${BASE_ID}"."${invoicesId.toString()}"
        VALUES ('${invoiceId}', 1, 'inv', NULL, '${customerId}', '1'::jsonb);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [roundedId], level: 0 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 1 },
        { tableId: invoices.id(), fieldIds: [invoiceLookupId], level: 2 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: roundedId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [roundedId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
        {
          fromTableId: customers.id(),
          toTableId: invoices.id(),
          fromFieldId: lookupId,
          toFieldId: invoiceLookupId,
          propagationSourceFieldIds: [lookupId],
          propagationTargetFieldIds: [invoiceLookupId],
          linkFieldId: invoiceLinkId,
          propagationMode: 'linkTraversal',
          order: 1,
        },
      ],
      estimatedComplexity: 3,
      changeType: 'update',
      sameTableBatches: [],
    };

    await data.db.transaction().execute(async (trx) => {
      (
        await createUpdater(trx, [orders, customers, invoices]).execute(
          plan,
          { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
          undefined,
          { collectChanges: true }
        )
      )._unsafeUnwrap();
    });

    const customer = (
      await data.pglite.query(
        `SELECT __version FROM "${BASE_ID}"."${CUSTOMERS_ID}" WHERE __id = '${customerId}'`
      )
    ).rows[0] as { __version: number };
    const invoice = (
      await data.pglite.query(
        `SELECT __version FROM "${BASE_ID}"."${invoicesId.toString()}" WHERE __id = '${invoiceId}'`
      )
    ).rows[0] as { __version: number };
    expect(customer.__version).toBe(2);
    expect(invoice.__version).toBe(2);
  });

  it('rolls back abort-budget formula writes then retries lookups in the same transaction', async () => {
    data = await createPGliteDb();
    const { baseId, orders, customers, roundedId, lookupId, linkId, xId } = createLinkedTables();
    await data.pglite.exec(createSchemaSql());
    const orderId = rec('1');
    const customerIds = [rec('4'), rec('5'), rec('6')];
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}" VALUES ('${orderId}', 1, 2.4, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}" VALUES
        ('${customerIds[0]}', 1, 'c1', NULL, '${orderId}', '1'::jsonb),
        ('${customerIds[1]}', 1, 'c2', NULL, '${orderId}', '1'::jsonb),
        ('${customerIds[2]}', 1, 'c3', NULL, '${orderId}', '1'::jsonb);
    `);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: orders.id(),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [
        { tableId: orders.id(), fieldIds: [roundedId], level: 0 },
        { tableId: customers.id(), fieldIds: [lookupId], level: 1 },
      ],
      edges: [
        {
          fromTableId: orders.id(),
          toTableId: customers.id(),
          fromFieldId: roundedId,
          toFieldId: lookupId,
          propagationSourceFieldIds: [roundedId],
          propagationTargetFieldIds: [lookupId],
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 2,
      changeType: 'update',
      sameTableBatches: [],
    };

    await data.db.transaction().execute(async (trx) => {
      const updater = createUpdater(trx, [orders, customers]);
      const actor = { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() };
      const abort = await updater.execute(plan, actor, undefined, {
        collectChanges: true,
        maxDirtyRecords: 2,
        dirtyBudgetMode: 'abort',
      });
      expect(abort.isOk()).toBe(true);
      expect(abort._unsafeUnwrap().dirtyBudget?.status).toBe('exceeded');
      expect(abort._unsafeUnwrap().changesByStep).toEqual([]);
      const roundedAfterAbort = await sql<{ col_rounded: number }>`
        SELECT col_rounded FROM ${sql.raw(`"${BASE_ID}"."${ORDERS_ID}"`)}
        WHERE __id = ${orderId}
      `.execute(trx);
      expect(roundedAfterAbort.rows[0]?.col_rounded).toBe(1);
      const lookupsAfterAbort = await sql<{ __version: number }>`
        SELECT __version FROM ${sql.raw(`"${BASE_ID}"."${CUSTOMERS_ID}"`)} ORDER BY __id
      `.execute(trx);
      expect(lookupsAfterAbort.rows.map((row) => row.__version)).toEqual([1, 1, 1]);

      (await updater.execute(plan, actor, undefined, { collectChanges: true }))._unsafeUnwrap();
    });

    const roundedAfterRetry = (
      await data.pglite.query(
        `SELECT col_rounded FROM "${BASE_ID}"."${ORDERS_ID}" WHERE __id = '${orderId}'`
      )
    ).rows[0] as { col_rounded: number };
    expect(roundedAfterRetry.col_rounded).toBe(2);
    const lookupVersionsAfterRetry = (
      await data.pglite.query(`SELECT __version FROM "${BASE_ID}"."${CUSTOMERS_ID}" ORDER BY __id`)
    ).rows as { __version: number }[];
    expect(lookupVersionsAfterRetry.map((row) => row.__version)).toEqual([2, 2, 2]);
  });

  it('keeps L_round and L2 still when ROUND is unchanged while B and NOW still propagate', async () => {
    data = await createPGliteDb();
    const tables = createCascadeTables();
    await data.pglite.exec(createCascadeSchemaSql());
    const orderId = rec('1');
    const customerIds = [rec('4'), rec('5'), rec('6')];
    const invoiceId = rec('7');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}"
        VALUES ('${orderId}', 1, 1.4, 1, NULL, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}" VALUES
        ('${customerIds[0]}', 1, 'c1', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb),
        ('${customerIds[1]}', 1, 'c2', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb),
        ('${customerIds[2]}', 1, 'c3', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb);
      INSERT INTO "${BASE_ID}"."${INVOICES_ID}"
        VALUES ('${invoiceId}', 1, 'inv', NULL, '${customerIds[0]}', '1'::jsonb);
    `);

    const plan = {
      ...cascadePlan(tables),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
    };
    await data.db.transaction().execute(async (trx) => {
      (
        await createUpdater(trx, [tables.orders, tables.customers, tables.invoices]).execute(
          plan,
          { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
          undefined,
          { collectChanges: true }
        )
      )._unsafeUnwrap();
    });

    const order = (
      await data.pglite.query(
        `SELECT col_rounded, col_b, col_now FROM "${BASE_ID}"."${ORDERS_ID}" WHERE __id = '${orderId}'`
      )
    ).rows[0] as { col_rounded: number; col_b: number; col_now: unknown };
    expect(order.col_rounded).toBe(1);
    expect(order.col_b).toBe(2.4);
    expect(order.col_now).not.toBeNull();
    const afterCustomers = (
      await data.pglite.query(
        `SELECT col_lookup_round, col_lookup_b, col_lookup_now FROM "${BASE_ID}"."${CUSTOMERS_ID}" ORDER BY __id`
      )
    ).rows as Array<{
      col_lookup_round: unknown;
      col_lookup_b: unknown;
      col_lookup_now: unknown;
    }>;
    expect(afterCustomers.map((row) => lookupNumber(row.col_lookup_round))).toEqual([1, 1, 1]);
    expect(afterCustomers.map((row) => lookupNumber(row.col_lookup_b))).toEqual([2.4, 2.4, 2.4]);
    expect(afterCustomers.every((row) => row.col_lookup_now != null)).toBe(true);
    const afterInvoice = (
      await data.pglite.query(`SELECT col_lookup FROM "${BASE_ID}"."${INVOICES_ID}"`)
    ).rows[0] as { col_lookup: unknown };
    expect(lookupNumber(afterInvoice.col_lookup)).toBe(1);
  });

  it('updates L_round fan-out and L2 when ROUND changes', async () => {
    data = await createPGliteDb();
    const tables = createCascadeTables();
    await data.pglite.exec(createCascadeSchemaSql());
    const orderId = rec('1');
    const customerIds = [rec('4'), rec('5'), rec('6')];
    const invoiceId = rec('7');
    await data.pglite.exec(`
      INSERT INTO "${BASE_ID}"."${ORDERS_ID}"
        VALUES ('${orderId}', 1, 2.4, 1, NULL, 1);
      INSERT INTO "${BASE_ID}"."${CUSTOMERS_ID}" VALUES
        ('${customerIds[0]}', 1, 'c1', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb),
        ('${customerIds[1]}', 1, 'c2', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb),
        ('${customerIds[2]}', 1, 'c3', NULL, '${orderId}', '1'::jsonb, NULL, '1'::jsonb);
      INSERT INTO "${BASE_ID}"."${INVOICES_ID}"
        VALUES ('${invoiceId}', 1, 'inv', NULL, '${customerIds[0]}', '1'::jsonb);
    `);

    const plan = {
      ...cascadePlan(tables),
      seedRecordIds: [RecordId.create(orderId)._unsafeUnwrap()],
    };
    await data.db.transaction().execute(async (trx) => {
      (
        await createUpdater(trx, [tables.orders, tables.customers, tables.invoices]).execute(
          plan,
          { actorId: ActorId.create(ACTOR_ID)._unsafeUnwrap() },
          undefined,
          { collectChanges: true }
        )
      )._unsafeUnwrap();
    });

    const order = (
      await data.pglite.query(
        `SELECT col_rounded, col_b FROM "${BASE_ID}"."${ORDERS_ID}" WHERE __id = '${orderId}'`
      )
    ).rows[0] as { col_rounded: number; col_b: number };
    expect(order.col_rounded).toBe(2);
    expect(order.col_b).toBe(4.4);
    const afterCustomers = (
      await data.pglite.query(
        `SELECT col_lookup_round FROM "${BASE_ID}"."${CUSTOMERS_ID}" ORDER BY __id`
      )
    ).rows as Array<{ col_lookup_round: unknown }>;
    expect(afterCustomers).toHaveLength(3);
    expect(afterCustomers.map((row) => lookupNumber(row.col_lookup_round))).toEqual([2, 2, 2]);
    const afterInvoice = (
      await data.pglite.query(`SELECT col_lookup FROM "${BASE_ID}"."${INVOICES_ID}"`)
    ).rows[0] as { col_lookup: unknown };
    expect(lookupNumber(afterInvoice.col_lookup)).toBe(2);
  });
});

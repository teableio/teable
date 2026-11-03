/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createV2PostgresPgliteDb,
  registerV2PostgresPgliteDb,
  v2DataDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  DeleteTableCommand,
  FieldId,
  type LinkField,
  Table,
  TableId,
  type CreateTableResult,
  type DeleteTableResult,
  type ICommandBus,
  type ITableMapper,
  type ITableRepository,
  type ITableSchemaRepository,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureV1MetaSchema } from '../../../../adapter-repository-postgres/src/db/schema';
import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const relationExists = async (
  db: Kysely<V1TeableDatabase>,
  qualifiedName: string
): Promise<boolean> => {
  const [schema, tableName] = qualifiedName.split('.');
  const result = await sql<{ exists: boolean }>`
    SELECT to_regclass(${`"${schema}"."${tableName}"`}) IS NOT NULL AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
};

describe('DeleteTableHandler (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it.each([
    { relationship: 'manyMany', isOneWay: false, label: 'symmetric many-many' },
    { relationship: 'oneMany', isOneWay: true, label: 'one-way one-many' },
  ] as const)(
    'permanently deletes a table with a self $label link and its owned junction',
    async ({ relationship, isOneWay }) => {
      const { container, baseId } = getV2NodeTestContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
      const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

      const unrelatedResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          name: 'Unrelated table',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      );
      const unrelatedTable = unrelatedResult._unsafeUnwrap().table;

      const tableId = TableId.generate()._unsafeUnwrap();
      const primaryFieldId = FieldId.generate()._unsafeUnwrap();
      const selfLinkFieldId = FieldId.generate()._unsafeUnwrap();
      const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId: tableId.toString(),
          name: 'Self links',
          fields: [
            {
              type: 'singleLineText',
              id: primaryFieldId.toString(),
              name: 'Name',
              isPrimary: true,
            },
            {
              type: 'link',
              id: selfLinkFieldId.toString(),
              name: 'Related records',
              options: {
                relationship,
                foreignTableId: tableId.toString(),
                lookupFieldId: primaryFieldId.toString(),
                isOneWay,
              },
            },
          ],
        })._unsafeUnwrap()
      );
      const table = createResult._unsafeUnwrap().table;
      const selfLink = table
        .getField((field) => field.id().equals(selfLinkFieldId))
        ._unsafeUnwrap();
      expect(selfLink.type().toString()).toBe('link');
      const junctionName = (selfLink as LinkField).fkHostTableNameString()._unsafeUnwrap();
      const tableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
      const unrelatedTableName = unrelatedTable
        .dbTableName()
        ._unsafeUnwrap()
        .value()
        ._unsafeUnwrap();

      expect(await relationExists(db, tableName)).toBe(true);
      expect(await relationExists(db, junctionName)).toBe(true);
      expect(await relationExists(db, unrelatedTableName)).toBe(true);

      const deleteResult = await commandBus.execute<DeleteTableCommand, DeleteTableResult>(
        context,
        DeleteTableCommand.create({
          baseId: baseId.toString(),
          tableId: tableId.toString(),
          mode: 'permanent',
        })._unsafeUnwrap()
      );
      deleteResult._unsafeUnwrap();

      expect(await relationExists(db, tableName)).toBe(false);
      expect(await relationExists(db, junctionName)).toBe(false);
      expect(await relationExists(db, unrelatedTableName)).toBe(true);
    }
  );

  it('refuses to cascade from owned junction storage into an external view', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const tableId = TableId.generate()._unsafeUnwrap();
    const primaryFieldId = FieldId.generate()._unsafeUnwrap();
    const selfLinkFieldId = FieldId.generate()._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        tableId: tableId.toString(),
        name: 'Protected self links',
        fields: [
          {
            type: 'singleLineText',
            id: primaryFieldId.toString(),
            name: 'Name',
            isPrimary: true,
          },
          {
            type: 'link',
            id: selfLinkFieldId.toString(),
            name: 'Related records',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableId.toString(),
              lookupFieldId: primaryFieldId.toString(),
              isOneWay: true,
            },
          },
        ],
      })._unsafeUnwrap()
    );
    const table = createResult._unsafeUnwrap().table;
    const selfLink = table
      .getField((field) => field.id().equals(selfLinkFieldId))
      ._unsafeUnwrap() as LinkField;
    const junctionName = selfLink.fkHostTableNameString()._unsafeUnwrap();
    const tableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const [junctionSchema, junctionTable] = junctionName.split('.');
    const externalViewName = `external_${tableId.toString()}`;
    await sql
      .raw(
        `CREATE VIEW "${junctionSchema}"."${externalViewName}" AS SELECT * FROM "${junctionSchema}"."${junctionTable}"`
      )
      .execute(db);
    const externalView = `${junctionSchema}.${externalViewName}`;

    const incomingLinkId = FieldId.generate()._unsafeUnwrap();
    const referencingResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Incoming reference',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: incomingLinkId.toString(),
            name: 'Protected target',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableId.toString(),
              lookupFieldId: primaryFieldId.toString(),
              isOneWay: true,
            },
          },
        ],
      })._unsafeUnwrap()
    );
    const referencingTable = referencingResult._unsafeUnwrap().table;
    const incomingLink = referencingTable
      .getField((field) => field.id().equals(incomingLinkId))
      ._unsafeUnwrap() as LinkField;
    const incomingJunction = incomingLink.fkHostTableNameString()._unsafeUnwrap();
    const referencingPhysicalTable = referencingTable
      .dbTableName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const mapper = container.resolve<ITableMapper>(v2CoreTokens.tableMapper);
    const referencingSpec = Table.specs(baseId).byId(referencingTable.id()).build()._unsafeUnwrap();
    const readReferencingField = async () => {
      const currentTable = (
        await tableRepository.findOne(context, referencingSpec)
      )._unsafeUnwrap();
      return mapper
        .toDTO(currentTable)
        ._unsafeUnwrap()
        .fields.find((field) => field.id === incomingLinkId.toString());
    };
    const readIncomingStorage = async () => {
      const fieldRow = await db
        .selectFrom('field')
        .select(['type', 'options', 'meta', 'db_field_name', 'db_field_type'])
        .where('id', '=', incomingLinkId.toString())
        .executeTakeFirstOrThrow();
      const [tableSchema, physicalTableName] = referencingPhysicalTable.split('.');
      const column = await sql<{ data_type: string }>`
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = ${tableSchema}
          AND table_name = ${physicalTableName}
          AND column_name = ${fieldRow.db_field_name}
      `.execute(db);
      return { fieldRow, column: column.rows[0] };
    };
    const beforeField = await readReferencingField();
    const beforeStorage = await readIncomingStorage();
    expect(beforeField).toMatchObject({
      type: 'link',
      options: {
        foreignTableId: tableId.toString(),
        relationship: 'manyMany',
        isOneWay: true,
      },
    });
    expect(beforeStorage.fieldRow).toMatchObject({ type: 'link', db_field_type: 'JSON' });
    expect(beforeStorage.column).toEqual({ data_type: 'jsonb' });
    expect(await relationExists(db, referencingPhysicalTable)).toBe(true);
    expect(await relationExists(db, incomingJunction)).toBe(true);

    const deleteResult = await commandBus.execute<DeleteTableCommand, DeleteTableResult>(
      context,
      DeleteTableCommand.create({
        baseId: baseId.toString(),
        tableId: tableId.toString(),
        mode: 'permanent',
      })._unsafeUnwrap()
    );

    expect(deleteResult.isErr()).toBe(true);
    expect(await relationExists(db, tableName)).toBe(true);
    expect(await relationExists(db, junctionName)).toBe(true);
    expect(await relationExists(db, externalView)).toBe(true);
    expect(await readReferencingField()).toEqual(beforeField);
    expect(await readIncomingStorage()).toEqual(beforeStorage);
    expect(await relationExists(db, referencingPhysicalTable)).toBe(true);
    expect(await relationExists(db, incomingJunction)).toBe(true);
  });

  it('rolls back earlier inbound conversions when a later junction drop fails in split databases', async () => {
    await getV2NodeTestContainer().dispose();
    const test = await createV2NodeTestContainer({
      connectionString: 'memory://',
      registerDb: async (container, config) => {
        await registerV2PostgresPgliteDb(container, config);
        const dataDb = await createV2PostgresPgliteDb(config);
        // The canonical test schema also installs the data-plane outbox tables.
        await ensureV1MetaSchema(dataDb);
        // Distinct identities are required: equal configs deliberately share a
        // transaction even when the adapter receives different DB objects.
        const dataConfig = { ...config, pg: { ...config.pg, connectionString: 'memory://data' } };
        container.registerInstance(v2DataDbTokens.db, dataDb);
        container.registerInstance(v2DataDbTokens.config, dataConfig);
        container.registerInstance(v2PostgresDbTokens.db, dataDb);
        container.registerInstance(v2PostgresDbTokens.config, dataConfig);
      },
    });
    setV2NodeTestContainer(test);
    const { container, baseId, metaDb, dataDb } = test;
    expect(metaDb).not.toBe(dataDb);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const schemaRepository = container.resolve<ITableSchemaRepository>(
      v2CoreTokens.tableSchemaRepository
    );
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const targetResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'A',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      })._unsafeUnwrap()
    );
    expect(targetResult.isErr() ? targetResult.error : undefined).toBeUndefined();
    const target = targetResult._unsafeUnwrap().table;
    const references = [];
    for (const name of ['B', 'C']) {
      const fieldId = FieldId.generate()._unsafeUnwrap();
      const tableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          name,
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: fieldId.toString(),
              name: 'A link',
              options: {
                relationship: 'manyMany',
                foreignTableId: target.id().toString(),
                lookupFieldId: target.primaryFieldId().toString(),
                isOneWay: true,
              },
            },
          ],
        })._unsafeUnwrap()
      );
      expect(tableResult.isErr() ? tableResult.error : undefined).toBeUndefined();
      const table = tableResult._unsafeUnwrap().table;
      const link = table
        .getField((field) => field.id().equals(fieldId))
        ._unsafeUnwrap() as LinkField;
      references.push({
        table,
        fieldId,
        junction: link.fkHostTableNameString()._unsafeUnwrap(),
        physicalTable: table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap(),
      });
    }
    const [first, second] = references;
    const [junctionSchema, junctionTable] = second.junction.split('.');
    const viewName = `external_${target.id().toString()}`;
    await sql`CREATE VIEW ${sql.id(junctionSchema, viewName)} AS SELECT * FROM ${sql.id(junctionSchema, junctionTable)}`.execute(
      dataDb
    );

    // Query ordering is not a storage contract. Pin B before C while retaining
    // the real repository query and the real metadata/schema conversion paths.
    const find = tableRepository.find.bind(tableRepository);
    vi.spyOn(tableRepository, 'find').mockImplementation(async (...args) =>
      (await find(...args)).map((tables) =>
        [...tables].sort((left, right) =>
          left.name().toString().localeCompare(right.name().toString())
        )
      )
    );
    const conversions: Array<{ tableId: string; succeeded: boolean }> = [];
    const update = schemaRepository.update.bind(schemaRepository);
    vi.spyOn(schemaRepository, 'update').mockImplementation(async (...args) => {
      const result = await update(...args);
      conversions.push({ tableId: args[1].id().toString(), succeeded: result.isOk() });
      return result;
    });
    const readStorage = async () => {
      const snapshots = [];
      for (const reference of references) {
        const field = await metaDb
          .selectFrom('field')
          .select(['type', 'options', 'meta', 'db_field_name', 'db_field_type'])
          .where('id', '=', reference.fieldId.toString())
          .executeTakeFirstOrThrow();
        const [schema, table] = reference.physicalTable.split('.');
        const columns = await sql<{ data_type: string }>`
          SELECT data_type FROM information_schema.columns
          WHERE table_schema = ${schema} AND table_name = ${table}
            AND column_name = ${field.db_field_name}
        `.execute(dataDb);
        snapshots.push({ field, column: columns.rows[0] });
      }
      return snapshots;
    };
    const before = await readStorage();
    for (const snapshot of before) {
      expect(snapshot.field).toMatchObject({ type: 'link', db_field_type: 'JSON' });
      expect(snapshot.column).toEqual({ data_type: 'jsonb' });
    }
    const deleteCommand = DeleteTableCommand.create({
      baseId: baseId.toString(),
      tableId: target.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();
    const failedDelete = await commandBus.execute(context, deleteCommand);
    expect(failedDelete.isErr()).toBe(true);
    expect(conversions).toEqual([
      { tableId: first.table.id().toString(), succeeded: true },
      { tableId: second.table.id().toString(), succeeded: false },
    ]);
    expect(await readStorage()).toEqual(before);
    const targetPhysical = target.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    expect(await relationExists(dataDb, targetPhysical)).toBe(true);
    expect(await relationExists(dataDb, `${junctionSchema}.${viewName}`)).toBe(true);
    for (const reference of references) {
      expect(await relationExists(dataDb, reference.physicalTable)).toBe(true);
      expect(await relationExists(dataDb, reference.junction)).toBe(true);
    }

    await sql`DROP VIEW ${sql.id(junctionSchema, viewName)}`.execute(dataDb);
    expect(await readStorage()).toEqual(before);
    for (const reference of references) {
      expect(await relationExists(dataDb, reference.junction)).toBe(true);
    }
    const rejectDeleteFunction = `reject_delete_${target.id().toString()}`;
    const rejectDeleteTrigger = `reject_delete_trigger_${target.id().toString()}`;
    await sql`
      CREATE FUNCTION ${sql.id(rejectDeleteFunction)}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture target metadata delete failure'; END;
      $$
    `.execute(metaDb);
    await sql`
      CREATE TRIGGER ${sql.id(rejectDeleteTrigger)}
      BEFORE DELETE ON table_meta
      FOR EACH ROW WHEN (OLD.id = ${sql.lit(target.id().toString())})
      EXECUTE FUNCTION ${sql.id(rejectDeleteFunction)}()
    `.execute(metaDb);
    try {
      const rejectedMetadataDelete = await commandBus.execute(context, deleteCommand);
      expect(rejectedMetadataDelete.isErr()).toBe(true);
      expect(await readStorage()).toEqual(before);
      expect(await relationExists(dataDb, targetPhysical)).toBe(true);
      for (const reference of references) {
        expect(await relationExists(dataDb, reference.physicalTable)).toBe(true);
        expect(await relationExists(dataDb, reference.junction)).toBe(true);
      }
    } finally {
      await sql`DROP TRIGGER ${sql.id(rejectDeleteTrigger)} ON table_meta`.execute(metaDb);
      await sql`DROP FUNCTION ${sql.id(rejectDeleteFunction)}()`.execute(metaDb);
    }
    const retry = await commandBus.execute(context, deleteCommand);
    expect(retry.isErr() ? retry.error : undefined).toBeUndefined();
    expect(await relationExists(dataDb, targetPhysical)).toBe(false);
    for (const snapshot of await readStorage()) {
      expect(snapshot.field).toMatchObject({ type: 'singleLineText', db_field_type: 'TEXT' });
      expect(snapshot.column).toEqual({ data_type: 'text' });
    }
    for (const reference of references) {
      expect(await relationExists(dataDb, reference.physicalTable)).toBe(true);
      expect(await relationExists(dataDb, reference.junction)).toBe(false);
    }
  });
});

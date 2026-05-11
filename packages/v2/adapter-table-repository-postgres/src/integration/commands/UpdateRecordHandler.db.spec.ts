/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type UpdateRecordResult,
  FieldKeyType,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

describe('UpdateRecordHandler (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  const createContext = () => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap() };
  };

  const createTestTable = async (
    commandBus: ICommandBus,
    baseId: string,
    tableName: string
  ): Promise<CreateTableResult> => {
    const command = CreateTableCommand.create({
      baseId,
      name: tableName,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
        { type: 'checkbox', name: 'Approved' },
      ],
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      command
    );

    return result._unsafeUnwrap();
  };

  it('updates a record in the database', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Update Records');
    const tableId = table.id().toString();

    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const amountField = fields.find((f) => f.name().toString() === 'Amount');

    expect(titleField).toBeDefined();
    expect(amountField).toBeDefined();
    if (!titleField || !amountField) return;

    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleField.id().toString()]: 'Original',
        [amountField.id().toString()]: 10,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    const updateRecordCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fields: {
        [titleField.id().toString()]: 'Updated',
        [amountField.id().toString()]: 99,
      },
    })._unsafeUnwrap();

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateRecordCommand
    );
    updateResult._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    const titleDbField = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const amountDbField = amountField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    expect(row[titleDbField]).toBe('Updated');
    expect(row[amountDbField]).toBe(99);
    expect(row['__version']).toBe(2);
  });

  it('normalizes checkbox false to null for name keys', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const { table } = await createTestTable(commandBus, baseId.toString(), 'Checkbox Compat');
    const tableId = table.id().toString();

    const fields = table.getFields();
    const titleField = fields.find((f) => f.name().toString() === 'Title');
    const approvedField = fields.find((f) => f.name().toString() === 'Approved');

    expect(titleField).toBeDefined();
    expect(approvedField).toBeDefined();
    if (!titleField || !approvedField) return;

    const createRecordCommand = CreateRecordCommand.create({
      tableId,
      fields: {
        [titleField.id().toString()]: 'Original',
        [approvedField.id().toString()]: true,
      },
    })._unsafeUnwrap();

    const createResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      createRecordCommand
    );
    const { record } = createResult._unsafeUnwrap();

    const updateRecordCommand = UpdateRecordCommand.create({
      tableId,
      recordId: record.id().toString(),
      fieldKeyType: FieldKeyType.Name,
      fields: {
        [titleField.name().toString()]: 'Updated',
        [approvedField.name().toString()]: false,
      },
    })._unsafeUnwrap();

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      updateRecordCommand
    );
    updateResult._unsafeUnwrap();

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .where('__id', '=', record.id().toString())
      .execute();

    expect(rows.length).toBe(1);
    const row = rows[0];
    const approvedDbField = approvedField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();

    expect(row[approvedDbField]).toBeNull();
  });

  it('recomputes a formula that formats a date lookup after a direct dependency update', async () => {
    const { container, baseId, processOutbox } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<DynamicDb>>(v2PostgresDbTokens.db);

    const contractBaseId = `bse${'h'.repeat(16)}`;
    const contractSpaceId = `spc${'h'.repeat(16)}`;
    await db
      .insertInto('space')
      .values({ id: contractSpaceId, name: 'Formula Lookup Space', created_by: 'system' })
      .execute();
    await db
      .insertInto('base')
      .values({
        id: contractBaseId,
        space_id: contractSpaceId,
        name: 'Formula Lookup Base',
        order: 2,
        created_by: 'system',
      })
      .execute();

    const contractNameFieldId = `fld${'a'.repeat(16)}`;
    const contractDateFieldId = `fld${'b'.repeat(16)}`;
    const contractTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      CreateTableCommand.create({
        baseId: contractBaseId,
        name: 'Formula Lookup Contract',
        fields: [
          { type: 'singleLineText', id: contractNameFieldId, name: 'Name', isPrimary: true },
          { type: 'date', id: contractDateFieldId, name: 'Start Date' },
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    const contractTable = contractTableResult._unsafeUnwrap().table;

    const projectNameFieldId = `fld${'c'.repeat(16)}`;
    const projectCategoryFieldId = `fld${'d'.repeat(16)}`;
    const projectLinkFieldId = `fld${'e'.repeat(16)}`;
    const projectLookupFieldId = `fld${'f'.repeat(16)}`;
    const projectFormulaFieldId = `fld${'g'.repeat(16)}`;
    const projectTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Formula Lookup Project',
        fields: [
          { type: 'singleLineText', id: projectNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: projectCategoryFieldId, name: 'Category' },
          {
            type: 'link',
            id: projectLinkFieldId,
            name: 'Contract',
            options: {
              relationship: 'manyOne',
              foreignTableId: contractTable.id().toString(),
              lookupFieldId: contractNameFieldId,
            },
          },
          {
            type: 'lookup',
            id: projectLookupFieldId,
            name: 'Contract Start',
            options: {
              linkFieldId: projectLinkFieldId,
              foreignTableId: contractTable.id().toString(),
              lookupFieldId: contractDateFieldId,
            },
          },
          {
            type: 'formula',
            id: projectFormulaFieldId,
            name: 'Path',
            options: {
              expression: `DATETIME_FORMAT({${projectLookupFieldId}}, "YYYYMMDD") & "-" & {${projectCategoryFieldId}} & "-" & {${projectLinkFieldId}}`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    const projectTable = projectTableResult._unsafeUnwrap().table;

    const contractResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      CreateRecordCommand.create({
        tableId: contractTable.id().toString(),
        fields: {
          [contractNameFieldId]: 'Education Service',
          [contractDateFieldId]: '2025-06-30T16:00:00.000Z',
        },
      })._unsafeUnwrap()
    );
    const contractRecord = contractResult._unsafeUnwrap().record;

    const projectResult = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      createContext(),
      CreateRecordCommand.create({
        tableId: projectTable.id().toString(),
        fields: {
          [projectNameFieldId]: 'Project A',
          [projectLinkFieldId]: { id: contractRecord.id().toString() },
        },
      })._unsafeUnwrap()
    );
    const projectRecord = projectResult._unsafeUnwrap().record;

    await processOutbox();
    await processOutbox();

    await db
      .updateTable('field')
      .set({ has_error: true })
      .where('id', 'in', [projectLinkFieldId, projectLookupFieldId])
      .execute();

    const updateResult = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      createContext(),
      UpdateRecordCommand.create({
        tableId: projectTable.id().toString(),
        recordId: projectRecord.id().toString(),
        fields: {
          [projectCategoryFieldId]: 'Other',
        },
      })._unsafeUnwrap()
    );
    updateResult._unsafeUnwrap();
    await processOutbox();
    await processOutbox();

    const projectDbTableName = projectTable.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const formulaDbField = projectTable
      .getFields()
      .find((f) => f.id().toString() === projectFormulaFieldId)
      ?.dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
    expect(formulaDbField).toBeDefined();
    if (!formulaDbField) return;

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(projectDbTableName)
      .select([formulaDbField])
      .where('__id', '=', projectRecord.id().toString())
      .execute();

    expect(rows[0]?.[formulaDbField]).toBe('20250701-Other-Education Service');
  });
});

import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  type CreateFieldResult,
  type CreateTableResult,
  DuplicateFieldCommand,
  type DuplicateFieldResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('DuplicateFieldHandler (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('respects viewId and updates duplicated field order in target view meta', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const createTableCommand = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Duplicate Field Order',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'Source' },
        { type: 'singleLineText', name: 'Tail' },
      ],
    })._unsafeUnwrap();

    const createTableResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableCommand
    );
    const table = createTableResult._unsafeUnwrap().table;

    const sourceField = table.getFields().find((field) => field.name().toString() === 'Source');
    const tailField = table.getFields().find((field) => field.name().toString() === 'Tail');
    const targetView = table.views()[0];
    expect(sourceField).toBeTruthy();
    expect(tailField).toBeTruthy();
    expect(targetView).toBeTruthy();
    if (!sourceField || !tailField || !targetView) return;

    const duplicateCommand = DuplicateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: table.id().toString(),
      fieldId: sourceField.id().toString(),
      includeRecordValues: true,
      newFieldName: 'Source (copy)',
      viewId: targetView.id().toString(),
    })._unsafeUnwrap();

    const duplicateResult = await commandBus.execute<DuplicateFieldCommand, DuplicateFieldResult>(
      context,
      duplicateCommand
    );
    const duplicated = duplicateResult._unsafeUnwrap().newField;

    const viewRow = await db
      .selectFrom('view')
      .select(['column_meta'])
      .where('id', '=', targetView.id().toString())
      .executeTakeFirst();
    expect(viewRow).toBeTruthy();
    if (!viewRow) return;

    const columnMeta = JSON.parse(viewRow.column_meta ?? '{}') as Record<
      string,
      { order?: number }
    >;
    const sourceOrder = columnMeta[sourceField.id().toString()]?.order;
    const tailOrder = columnMeta[tailField.id().toString()]?.order;
    const duplicatedOrder = columnMeta[duplicated.id().toString()]?.order;

    expect(typeof sourceOrder).toBe('number');
    expect(typeof tailOrder).toBe('number');
    expect(typeof duplicatedOrder).toBe('number');
    expect((duplicatedOrder as number) > (sourceOrder as number)).toBe(true);
    expect((duplicatedOrder as number) < (tailOrder as number)).toBe(true);
  });

  it('rebuilds duplicated lookup single-select choices from the foreign target field', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2PostgresDbTokens.db);

    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const foreignPrimaryFieldId = `fld${'a'.repeat(16)}`;
    const foreignStatusFieldId = `fld${'b'.repeat(16)}`;
    const expectedChoices = [
      { id: 'choDupCore', name: '核心', color: 'blueBright' },
      { id: 'choDupImportant', name: '重要', color: 'greenBright' },
      { id: 'choDupReference', name: '参考', color: 'orangeBright' },
    ];

    const createForeignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Duplicate Lookup Foreign',
      fields: [
        {
          type: 'singleLineText',
          id: foreignPrimaryFieldId,
          name: 'Title',
        },
        {
          type: 'singleSelect',
          id: foreignStatusFieldId,
          name: 'Status',
          options: {
            choices: expectedChoices,
          },
        },
      ],
    })._unsafeUnwrap();
    const foreignTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(context, createForeignResult)
    )._unsafeUnwrap().table;

    const createHostResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Duplicate Lookup Host',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    })._unsafeUnwrap();
    const hostTable = (
      await commandBus.execute<CreateTableCommand, CreateTableResult>(context, createHostResult)
    )._unsafeUnwrap().table;

    const linkFieldId = `fld${'c'.repeat(16)}`;
    const symmetricLinkId = `fld${'d'.repeat(16)}`;
    const lookupFieldId = `fld${'e'.repeat(16)}`;

    const createLinkResult = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: hostTable.id().toString(),
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Related Manual',
        options: {
          relationship: 'manyMany',
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignPrimaryFieldId,
          symmetricFieldId: symmetricLinkId,
        },
      },
    })._unsafeUnwrap();
    await commandBus.execute<CreateFieldCommand, CreateFieldResult>(context, createLinkResult);

    const createLookupResult = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: hostTable.id().toString(),
      field: {
        type: 'lookup',
        id: lookupFieldId,
        name: 'Status Lookup',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignStatusFieldId,
        },
      },
    })._unsafeUnwrap();
    await commandBus.execute<CreateFieldCommand, CreateFieldResult>(context, createLookupResult);

    const brokenChoices = {
      choices: [
        { id: 'choBroken1', name: 'Option 1', color: 'blueBright' },
        { id: 'choBroken2', name: 'Option 2', color: 'greenBright' },
      ],
    };
    await db
      .updateTable('field')
      .set({
        options: JSON.stringify(brokenChoices),
      })
      .where('id', '=', lookupFieldId)
      .executeTakeFirst();

    const duplicateCommand = DuplicateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: hostTable.id().toString(),
      fieldId: lookupFieldId,
      includeRecordValues: false,
      newFieldName: 'Status Lookup (copy)',
    })._unsafeUnwrap();

    const duplicateResult = await commandBus.execute<DuplicateFieldCommand, DuplicateFieldResult>(
      context,
      duplicateCommand
    );
    const duplicatedField = duplicateResult._unsafeUnwrap().newField;

    const duplicatedRow = await db
      .selectFrom('field')
      .select(['options'])
      .where('id', '=', duplicatedField.id().toString())
      .executeTakeFirst();
    expect(duplicatedRow).toBeTruthy();
    if (!duplicatedRow) return;

    expect(JSON.parse(duplicatedRow.options ?? '{}')).toEqual({
      choices: expectedChoices,
    });
  });
});

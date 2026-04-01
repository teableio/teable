/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  DeleteFieldCommand,
  FieldDeleted,
  type CreateFieldResult,
  type CreateTableResult,
  type DeleteFieldResult,
  type ICommandBus,
  type LinkField,
  type LookupField,
  v2CoreTokens,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeUnitTestContainer } from '../testkit/v2NodeUnitTestContainer';

describe('DeleteFieldHandler', () => {
  it('deletes a field and publishes FieldDeleted', async () => {
    const { container, tableRepository, eventBus, baseId } = getV2NodeUnitTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Tasks',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    createTableResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const created = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    created._unsafeUnwrap();

    const tableId = created._unsafeUnwrap().table.id().toString();
    const fieldId = `fld${'d'.repeat(16)}`;

    const createFieldResult = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId,
      field: { type: 'singleLineText', id: fieldId, name: 'Status' },
    });
    createFieldResult._unsafeUnwrap();

    const fieldCreated = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      createFieldResult._unsafeUnwrap()
    );
    fieldCreated._unsafeUnwrap();

    const deleteCommandResult = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId,
      fieldId,
    });
    deleteCommandResult._unsafeUnwrap();

    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      deleteCommandResult._unsafeUnwrap()
    );
    deleteResult._unsafeUnwrap();

    const updated = deleteResult._unsafeUnwrap().table;
    expect(updated.getFields().some((field) => field.id().toString() === fieldId)).toBe(false);
    expect(eventBus.events().some((event) => event instanceof FieldDeleted)).toBe(true);

    const specResult = updated.specs().byId(updated.id()).build();
    specResult._unsafeUnwrap();

    const saved = await tableRepository.findOne(context, specResult._unsafeUnwrap());
    saved._unsafeUnwrap();
    expect(
      saved
        ._unsafeUnwrap()
        .getFields()
        .some((field) => field.id().toString() === fieldId)
    ).toBe(false);
  });

  it('removes symmetric link fields in foreign tables', async () => {
    const { container, tableRepository, baseId } = getV2NodeUnitTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const hostResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Host',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    hostResult._unsafeUnwrap();

    const foreignResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Foreign',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    foreignResult._unsafeUnwrap();

    const hostCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      hostResult._unsafeUnwrap()
    );
    hostCreated._unsafeUnwrap();
    const hostTable = hostCreated._unsafeUnwrap().table;

    const foreignCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      foreignResult._unsafeUnwrap()
    );
    foreignCreated._unsafeUnwrap();
    const foreignTable = foreignCreated._unsafeUnwrap().table;

    const linkFieldId = `fld${'l'.repeat(16)}`;
    const linkResult = CreateFieldCommand.create({
      baseId: baseId.toString(),
      tableId: hostTable.id().toString(),
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignTable.primaryFieldId().toString(),
        },
      },
    });
    linkResult._unsafeUnwrap();

    const linkCreated = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      linkResult._unsafeUnwrap()
    );
    linkCreated._unsafeUnwrap();

    const linkField = linkCreated
      ._unsafeUnwrap()
      .table.getFields()
      .find((field) => field.id().toString() === linkFieldId) as LinkField | undefined;
    expect(linkField).toBeTruthy();
    if (!linkField) return;

    const symmetricFieldId = linkField.symmetricFieldId();
    expect(symmetricFieldId).toBeTruthy();
    if (!symmetricFieldId) return;

    const foreignSpecResult = foreignTable.specs().byId(foreignTable.id()).build();
    foreignSpecResult._unsafeUnwrap();
    const foreignLoaded = await tableRepository.findOne(context, foreignSpecResult._unsafeUnwrap());
    foreignLoaded._unsafeUnwrap();
    const foreignUpdated = foreignLoaded._unsafeUnwrap();
    expect(foreignUpdated.getFields().some((field) => field.id().equals(symmetricFieldId))).toBe(
      true
    );

    const deleteCommandResult = DeleteFieldCommand.create({
      baseId: baseId.toString(),
      tableId: hostTable.id().toString(),
      fieldId: linkFieldId,
    });
    deleteCommandResult._unsafeUnwrap();

    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      deleteCommandResult._unsafeUnwrap()
    );
    deleteResult._unsafeUnwrap();

    const foreignAfter = await tableRepository.findOne(context, foreignSpecResult._unsafeUnwrap());
    foreignAfter._unsafeUnwrap();
    expect(
      foreignAfter
        ._unsafeUnwrap()
        .getFields()
        .some((field) => field.id().equals(symmetricFieldId))
    ).toBe(false);
  });

  it('marks dependent lookup field as errored when foreign lookup target is deleted', async () => {
    const { container, tableRepository, baseId } = getV2NodeUnitTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const hostCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Host',
        fields: [{ type: 'singleLineText', name: 'Title' }],
      })._unsafeUnwrap()
    );
    hostCreated._unsafeUnwrap();
    const hostTable = hostCreated._unsafeUnwrap().table;

    const foreignCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Foreign',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      })._unsafeUnwrap()
    );
    foreignCreated._unsafeUnwrap();
    const foreignTable = foreignCreated._unsafeUnwrap().table;

    const foreignStatusFieldId = `fld${'s'.repeat(16)}`;
    const foreignStatusResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: foreignTable.id().toString(),
        field: {
          type: 'singleLineText',
          id: foreignStatusFieldId,
          name: 'Status',
        },
      })._unsafeUnwrap()
    );
    foreignStatusResult._unsafeUnwrap();

    const linkFieldId = `fld${'l'.repeat(16)}`;
    const linkResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: hostTable.id().toString(),
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: foreignTable.primaryFieldId().toString(),
          },
        },
      })._unsafeUnwrap()
    );
    linkResult._unsafeUnwrap();

    const lookupFieldId = `fld${'k'.repeat(16)}`;
    const lookupResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: hostTable.id().toString(),
        field: {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Lookup Status',
          options: {
            foreignTableId: foreignTable.id().toString(),
            linkFieldId,
            lookupFieldId: foreignStatusFieldId,
          },
        },
      })._unsafeUnwrap()
    );
    lookupResult._unsafeUnwrap();

    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      DeleteFieldCommand.create({
        baseId: baseId.toString(),
        tableId: foreignTable.id().toString(),
        fieldId: foreignStatusFieldId,
      })._unsafeUnwrap()
    );
    deleteResult._unsafeUnwrap();

    const hostSpecResult = hostTable.specs().byId(hostTable.id()).build();
    hostSpecResult._unsafeUnwrap();
    const hostAfterResult = await tableRepository.findOne(context, hostSpecResult._unsafeUnwrap());
    hostAfterResult._unsafeUnwrap();

    const lookupField = hostAfterResult
      ._unsafeUnwrap()
      .getFields()
      .find((field) => field.id().toString() === lookupFieldId) as LookupField | undefined;
    expect(lookupField).toBeDefined();
    if (!lookupField) return;

    expect(lookupField.hasError().isError()).toBe(true);
  });

  it('deletes a foreign lookup target used by a link show-by field without returning not found', async () => {
    const { container, tableRepository, baseId } = getV2NodeUnitTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const hostCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Host',
        fields: [{ type: 'singleLineText', name: 'Title' }],
      })._unsafeUnwrap()
    );
    hostCreated._unsafeUnwrap();
    const hostTable = hostCreated._unsafeUnwrap().table;

    const foreignCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Foreign',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      })._unsafeUnwrap()
    );
    foreignCreated._unsafeUnwrap();
    const foreignTable = foreignCreated._unsafeUnwrap().table;

    const foreignDisplayFieldId = `fld${'d'.repeat(16)}`;
    await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: foreignTable.id().toString(),
        field: {
          type: 'singleLineText',
          id: foreignDisplayFieldId,
          name: 'Display',
        },
      })._unsafeUnwrap()
    );

    const linkFieldId = `fld${'z'.repeat(16)}`;
    const linkCreated = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId: hostTable.id().toString(),
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Foreign Link',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: foreignDisplayFieldId,
            isOneWay: true,
          },
        },
      })._unsafeUnwrap()
    );
    linkCreated._unsafeUnwrap();

    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      DeleteFieldCommand.create({
        baseId: baseId.toString(),
        tableId: foreignTable.id().toString(),
        fieldId: foreignDisplayFieldId,
      })._unsafeUnwrap()
    );
    deleteResult._unsafeUnwrap();

    const hostSpecResult = hostTable.specs().byId(hostTable.id()).build();
    hostSpecResult._unsafeUnwrap();
    const hostAfterResult = await tableRepository.findOne(context, hostSpecResult._unsafeUnwrap());
    hostAfterResult._unsafeUnwrap();

    const linkField = hostAfterResult
      ._unsafeUnwrap()
      .getFields()
      .find((field) => field.id().toString() === linkFieldId) as LinkField | undefined;
    expect(linkField).toBeDefined();
  });
});

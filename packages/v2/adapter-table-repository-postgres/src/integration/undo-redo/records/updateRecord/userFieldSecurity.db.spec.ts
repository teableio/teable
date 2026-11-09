/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  UpdateRecordsCommand,
  type CreateRecordResult,
  type CreateTableResult,
  type UpdateRecordResult,
  type UpdateRecordsResult,
} from '@teable/v2-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createUndoRedoDbHarness,
  disposeHarness,
  fetchRowById,
  findField,
  getFieldDbName,
  type UndoRedoDbHarness,
} from '../../shared/undoRedoDbTestKit';

const historicalMember = {
  id: 'usrUndoRedoHistoricalMember',
  name: 'Historical Member',
  email: 'undo-redo-historical-member@example.invalid',
};

describe('undo-redo/updateRecord user field security (db)', () => {
  let harness: UndoRedoDbHarness | undefined;

  beforeEach(async () => {
    harness = await createUndoRedoDbHarness();
  });

  afterEach(async () => {
    await disposeHarness(harness);
    harness = undefined;
  });

  it('restores a stored historical member after revocation while rejecting a public structured spoof', async () => {
    if (!harness) throw new Error('Missing harness');

    await harness.db.insertInto('users').values(historicalMember).execute();
    await harness.db
      .insertInto('collaborator')
      .values({
        id: 'colUndoRedoHistoricalMember',
        resource_type: 'base',
        resource_id: harness.testContainer.baseId.toString(),
        principal_id: historicalMember.id,
        principal_type: 'user',
      })
      .execute();

    const table = (
      await harness.execute<CreateTableCommand, CreateTableResult>(
        CreateTableCommand.create({
          baseId: harness.testContainer.baseId.toString(),
          name: 'Undo User History Security',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    ).table;
    const titleField = findField(table, 'Title');
    const ownerField = findField(table, 'Owner');
    const ownerDbName = getFieldDbName(table, 'Owner');

    const created = await harness.execute<CreateRecordCommand, CreateRecordResult>(
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Historical owner',
          [ownerField.id().toString()]: { id: historicalMember.id },
        },
      })._unsafeUnwrap()
    );

    await harness.execute<UpdateRecordCommand, UpdateRecordResult>(
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: created.record.id().toString(),
        fields: { [ownerField.id().toString()]: null },
      })._unsafeUnwrap()
    );

    await harness.db
      .deleteFrom('collaborator')
      .where('principal_id', '=', historicalMember.id)
      .execute();

    const spoofResult = await harness.commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
      harness.context,
      UpdateRecordCommand.create({
        tableId: table.id().toString(),
        recordId: created.record.id().toString(),
        fields: {
          [ownerField.id().toString()]: {
            id: historicalMember.id,
            title: 'Spoofed Historical Member',
          },
        },
      })._unsafeUnwrap()
    );

    expect(spoofResult.isErr()).toBe(true);
    if (spoofResult.isErr()) {
      expect(spoofResult.error.code).toBe('validation.field.user_not_found');
    }

    const clearedRow = await fetchRowById(harness.db, table, created.record.id().toString());
    expect(clearedRow?.[ownerDbName]).toBeNull();

    await harness.undo(table.id().toString());

    const restoredRow = await fetchRowById(harness.db, table, created.record.id().toString());
    expect(restoredRow?.[ownerDbName]).toMatchObject({
      id: historicalMember.id,
      title: historicalMember.name,
      email: historicalMember.email,
    });
  });

  it('restores stored historical members through bulk replay after revocation and soft deletion', async () => {
    if (!harness) throw new Error('Missing harness');

    await harness.db.insertInto('users').values(historicalMember).execute();
    await harness.db
      .insertInto('collaborator')
      .values({
        id: 'colUndoRedoHistoricalMember',
        resource_type: 'base',
        resource_id: harness.testContainer.baseId.toString(),
        principal_id: historicalMember.id,
        principal_type: 'user',
      })
      .execute();

    const table = (
      await harness.execute<CreateTableCommand, CreateTableResult>(
        CreateTableCommand.create({
          baseId: harness.testContainer.baseId.toString(),
          name: 'Bulk Undo User History Security',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'user', name: 'Owner', options: { isMultiple: false } },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      )
    ).table;
    const titleField = findField(table, 'Title');
    const ownerField = findField(table, 'Owner');
    const ownerDbName = getFieldDbName(table, 'Owner');

    const records: CreateRecordResult[] = [];
    for (const title of ['First historical owner', 'Second historical owner']) {
      records.push(
        await harness.execute<CreateRecordCommand, CreateRecordResult>(
          CreateRecordCommand.create({
            tableId: table.id().toString(),
            fields: {
              [titleField.id().toString()]: title,
              [ownerField.id().toString()]: { id: historicalMember.id },
            },
          })._unsafeUnwrap()
        )
      );
    }

    await harness.execute<UpdateRecordsCommand, UpdateRecordsResult>(
      UpdateRecordsCommand.create({
        tableId: table.id().toString(),
        records: records.map(({ record }) => ({
          id: record.id().toString(),
          fields: { [ownerField.id().toString()]: null },
        })),
      })._unsafeUnwrap()
    );

    await harness.db
      .deleteFrom('collaborator')
      .where('principal_id', '=', historicalMember.id)
      .execute();
    await harness.db
      .updateTable('users')
      .set({ deleted_time: new Date() })
      .where('id', '=', historicalMember.id)
      .execute();

    await harness.undo(table.id().toString());

    for (const { record } of records) {
      const restoredRow = await fetchRowById(harness.db, table, record.id().toString());
      expect(restoredRow?.[ownerDbName]).toMatchObject({
        id: historicalMember.id,
        title: historicalMember.name,
        email: historicalMember.email,
      });
    }
  });
});

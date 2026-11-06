/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

const selectableCollaborator = {
  id: 'usrT8238Selectable',
  name: 'Synthetic Selectable T8238',
  email: 'selectable-t8238@example.invalid',
};

const textOutsider = {
  id: 'usrT8238TextOutsider',
  name: 'Synthetic Outsider T8238',
  email: 'text-outsider-t8238@example.invalid',
};

const numericNameOutsider = {
  id: 'usrT8238NumericOutsider',
  name: '82380017',
  email: 'numeric-outsider-t8238@example.invalid',
};

const syntheticUserIds = [selectableCollaborator.id, textOutsider.id, numericNameOutsider.id];

describe('update-field: text → user collaborator scope (PGlite)', () => {
  let ctx: SharedTestContext;

  const removeSyntheticAccounts = async () => {
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('principal_id', 'in', syntheticUserIds)
      .execute();
    await ctx.testContainer.db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
  };

  const requireFieldId = (fields: ReadonlyArray<{ id: string; name: string }>, name: string) => {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Missing field: ${name}`);
    return field.id;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    await removeSyntheticAccounts();

    await ctx.testContainer.db
      .insertInto('users')
      .values([selectableCollaborator, textOutsider, numericNameOutsider])
      .execute();

    // Only this account is selectable in tables belonging to the test base. The
    // other synthetic platform accounts intentionally have no base/space membership.
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values({
        id: 'colT8238Selectable',
        resource_type: 'base',
        resource_id: ctx.baseId,
        principal_id: selectableCollaborator.id,
        principal_type: 'user',
      })
      .execute();
  });

  afterAll(async () => {
    if (!ctx) return;
    await removeSyntheticAccounts();
  });

  test('singleLineText and longText resolve collaborators but ignore platform outsiders', async () => {
    let tableId: string | undefined;

    try {
      const singleLineFieldName = 'Single line candidate';
      const longTextFieldName = 'Long text candidate';
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Text to User Collaborator Scope',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: singleLineFieldName },
          { type: 'longText', name: longTextFieldName },
        ],
      });
      tableId = table.id;

      const primaryFieldId = requireFieldId(table.fields, 'Name');
      const singleLineFieldId = requireFieldId(table.fields, singleLineFieldName);
      const longTextFieldId = requireFieldId(table.fields, longTextFieldName);

      const collaboratorRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'eligible collaborator',
        [singleLineFieldId]: selectableCollaborator.name,
        [longTextFieldId]: selectableCollaborator.name,
      });
      const outsiderRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'non-collaborators',
        [singleLineFieldId]: textOutsider.name,
        [longTextFieldId]: numericNameOutsider.name,
      });

      await ctx.updateField({
        tableId: table.id,
        fieldId: singleLineFieldId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });
      await ctx.updateField({
        tableId: table.id,
        fieldId: longTextFieldId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });

      const records = await ctx.listRecordsWithoutDrain(table.id);
      const convertedCollaborator = records.find((record) => record.id === collaboratorRecord.id);
      const convertedOutsider = records.find((record) => record.id === outsiderRecord.id);

      expect(convertedCollaborator?.fields[singleLineFieldId]).toMatchObject({
        id: selectableCollaborator.id,
        title: selectableCollaborator.name,
        email: selectableCollaborator.email,
      });
      expect(convertedCollaborator?.fields[longTextFieldId]).toMatchObject({
        id: selectableCollaborator.id,
        title: selectableCollaborator.name,
        email: selectableCollaborator.email,
      });
      expect(convertedOutsider?.fields[singleLineFieldId]).toBeNull();
      expect(convertedOutsider?.fields[longTextFieldId]).toBeNull();
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });

  test('JSON-shaped text cannot inject non-collaborators into single or multiple user fields', async () => {
    let tableId: string | undefined;

    try {
      const singleFieldName = 'Single JSON candidate';
      const multipleFieldName = 'Multiple JSON candidate';
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'JSON Text to User Collaborator Scope',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: singleFieldName },
          { type: 'singleLineText', name: multipleFieldName },
        ],
      });
      tableId = table.id;

      const primaryFieldId = requireFieldId(table.fields, 'Name');
      const singleFieldId = requireFieldId(table.fields, singleFieldName);
      const multipleFieldId = requireFieldId(table.fields, multipleFieldName);
      const record = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'JSON-shaped outsider snapshots',
        // An id-only snapshot previously survived conversion and could be enriched
        // with the synthetic platform account's email while reading the user cell.
        [singleFieldId]: JSON.stringify({ id: textOutsider.id }),
        [multipleFieldId]: JSON.stringify([
          { id: textOutsider.id },
          { id: numericNameOutsider.id, email: numericNameOutsider.email },
        ]),
      });

      await ctx.updateField({
        tableId: table.id,
        fieldId: singleFieldId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });
      await ctx.updateField({
        tableId: table.id,
        fieldId: multipleFieldId,
        field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
      });

      const records = await ctx.listRecordsWithoutDrain(table.id);
      const converted = records.find((candidate) => candidate.id === record.id);
      expect(converted?.fields[singleFieldId]).toBeNull();
      expect(converted?.fields[multipleFieldId]).toBeNull();
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });

  test('mixed text rows preserve only collaborators for single and multiple user fields', async () => {
    let tableId: string | undefined;

    try {
      const singleFieldName = 'Mixed single candidate';
      const multipleFieldName = 'Mixed multiple candidate';
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Mixed Text to User Collaborator Scope',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: singleFieldName },
          { type: 'singleLineText', name: multipleFieldName },
        ],
      });
      tableId = table.id;

      const primaryFieldId = requireFieldId(table.fields, 'Name');
      const singleFieldId = requireFieldId(table.fields, singleFieldName);
      const multipleFieldId = requireFieldId(table.fields, multipleFieldName);
      const collaboratorRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'eligible collaborator',
        [singleFieldId]: selectableCollaborator.id,
        [multipleFieldId]: selectableCollaborator.email,
      });
      const jsonRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'JSON-shaped outsiders',
        [singleFieldId]: JSON.stringify({ id: textOutsider.id }),
        [multipleFieldId]: JSON.stringify([
          { id: textOutsider.id },
          { id: numericNameOutsider.id, email: numericNameOutsider.email },
        ]),
      });
      const unmatchedRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'ordinary unmatched text',
        [singleFieldId]: 'not-a-user',
        [multipleFieldId]: 'not-a-user, still-not-a-user',
      });
      const emptyRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'empty text',
        [singleFieldId]: '',
        [multipleFieldId]: '',
      });
      const delimiterRecord = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'delimiter-only text',
        [singleFieldId]: ',, ,',
        [multipleFieldId]: ',, ,',
      });

      await ctx.updateField({
        tableId: table.id,
        fieldId: singleFieldId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });
      await ctx.updateField({
        tableId: table.id,
        fieldId: multipleFieldId,
        field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
      });

      const recordsById = new Map(
        (await ctx.listRecordsWithoutDrain(table.id)).map((record) => [record.id, record])
      );
      const convertedCollaborator = recordsById.get(collaboratorRecord.id);
      expect(convertedCollaborator?.fields[singleFieldId]).toMatchObject({
        id: selectableCollaborator.id,
        title: selectableCollaborator.name,
        email: selectableCollaborator.email,
      });
      expect(convertedCollaborator?.fields[multipleFieldId]).toEqual([
        expect.objectContaining({
          id: selectableCollaborator.id,
          title: selectableCollaborator.name,
          email: selectableCollaborator.email,
        }),
      ]);

      for (const rejectedRecord of [jsonRecord, unmatchedRecord, emptyRecord, delimiterRecord]) {
        const converted = recordsById.get(rejectedRecord.id);
        expect(converted?.fields[singleFieldId]).toBeNull();
        expect(converted?.fields[multipleFieldId]).toBeNull();
      }
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });

  test('number → user currently clears a numeric value even when a platform user has that name', async () => {
    let tableId: string | undefined;

    try {
      const numberFieldName = 'Numeric candidate';
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Number to User Current Behavior',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: numberFieldName },
        ],
      });
      tableId = table.id;

      const primaryFieldId = requireFieldId(table.fields, 'Name');
      const numberFieldId = requireFieldId(table.fields, numberFieldName);
      const record = await ctx.createRecord(table.id, {
        [primaryFieldId]: 'numeric source',
        [numberFieldId]: Number(numericNameOutsider.name),
      });

      await ctx.updateField({
        tableId: table.id,
        fieldId: numberFieldId,
        field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
      });

      const records = await ctx.listRecordsWithoutDrain(table.id);
      expect(
        records.find((candidate) => candidate.id === record.id)?.fields[numberFieldId]
      ).toBeNull();
    } finally {
      if (tableId) await ctx.deleteTable(tableId);
    }
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: button v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const getButtonStorage = async (tableId: string, fieldId: string) => {
    const fieldResult = await sql<{ db_field_name: string | null; db_field_type: string | null }>`
      SELECT "db_field_name", "db_field_type"
      FROM "field"
      WHERE "id" = ${fieldId}
    `.execute(ctx.testContainer.db);
    const field = fieldResult.rows.at(0);
    if (!field?.db_field_name || !field.db_field_type) {
      throw new Error(`Missing button storage metadata for ${fieldId}`);
    }

    return {
      dbFieldName: field.db_field_name,
      dbFieldType: field.db_field_type,
      tableName: `${ctx.baseId}.${tableId}`,
    };
  };

  const setButtonValue = async (tableId: string, fieldId: string, recordId: string) => {
    const storage = await getButtonStorage(tableId, fieldId);
    const value = JSON.stringify({ count: 3 });
    if (storage.dbFieldType === 'JSON') {
      await sql`
        UPDATE ${sql.table(storage.tableName)}
        SET ${sql.ref(storage.dbFieldName)} = ${value}::jsonb
        WHERE "__id" = ${recordId}
      `.execute(ctx.testContainer.db);
    } else {
      await sql`
        UPDATE ${sql.table(storage.tableName)}
        SET ${sql.ref(storage.dbFieldName)} = ${value}
        WHERE "__id" = ${recordId}
      `.execute(ctx.testContainer.db);
    }
  };

  const getButtonValue = async (tableId: string, fieldId: string, recordId: string) => {
    const storage = await getButtonStorage(tableId, fieldId);
    const result = await sql<{ value: unknown }>`
      SELECT ${sql.ref(storage.dbFieldName)} AS "value"
      FROM ${sql.table(storage.tableName)}
      WHERE "__id" = ${recordId}
    `.execute(ctx.testContainer.db);
    const value = result.rows.at(0)?.value;
    return typeof value === 'string' ? JSON.parse(value) : value;
  };

  test('button field resetCount=true is persisted in field options', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-button'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const updated = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'button',
          name: 'Button',
          options: {
            label: 'Button',
            color: 'teal',
            resetCount: true,
            workflow: {
              id: 'wfl00000000000000001',
              name: 'Workflow',
              isActive: true,
            },
          },
        },
      });
      const buttonField = updated.fields.find((f) => f.name === 'Button') as
        | { id: string; options?: { resetCount?: boolean } }
        | undefined;
      if (!buttonField) throw new Error('Missing button field');
      expect(buttonField.options?.resetCount).toBe(true);

      const refreshed = await ctx.getTableById(table.id);
      const refreshedButton = refreshed.fields.find((f) => f.id === buttonField.id) as
        | { options?: { resetCount?: boolean } }
        | undefined;
      expect(refreshedButton?.options?.resetCount).toBe(true);
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('button field confirm config is persisted when updating field options', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-update-reg-button-confirm'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withButton = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'button',
          name: 'Button',
          options: {
            label: 'Send',
            color: 'teal',
            workflow: {
              id: 'wfl00000000000000001',
              name: 'Workflow',
              isActive: true,
            },
          },
        },
      });

      const buttonField = withButton.fields.find((f) => f.name === 'Button') as
        | { id: string }
        | undefined;
      if (!buttonField) throw new Error('Missing button field');

      const updated = await ctx.updateField({
        tableId,
        fieldId: buttonField.id,
        field: {
          type: 'button',
          options: {
            label: 'Send',
            color: 'teal',
            workflow: {
              id: 'wfl00000000000000001',
              name: 'Workflow',
              isActive: true,
            },
            confirm: {
              title: 'Y',
              description: '123',
              confirmText: 'Y',
            },
          },
        },
      });

      const updatedButton = updated.fields.find((f) => f.id === buttonField.id) as
        | {
            options?: {
              confirm?: {
                title?: string;
                description?: string;
                confirmText?: string;
              };
            };
          }
        | undefined;

      expect(updatedButton?.options?.confirm).toEqual({
        title: 'Y',
        description: '123',
        confirmText: 'Y',
      });

      const refreshed = await ctx.getTableById(table.id);
      const refreshedButton = refreshed.fields.find((f) => f.id === buttonField.id) as
        | {
            options?: {
              confirm?: {
                title?: string;
                description?: string;
                confirmText?: string;
              };
            };
          }
        | undefined;

      expect(refreshedButton?.options?.confirm).toEqual({
        title: 'Y',
        description: '123',
        confirmText: 'Y',
      });
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('button display and confirmation updates preserve click counts', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-update-button-metadata'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const withButton = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'button',
          name: 'Button',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 5,
            resetCount: false,
            workflow: {
              id: 'wflButtonMetadataTest',
              name: 'Workflow',
              isActive: true,
            },
          },
        },
      });
      const buttonField = withButton.fields.find((field) => field.name === 'Button');
      if (!buttonField) throw new Error('Missing button field');

      const record = await ctx.createRecord(table.id, {});
      await setButtonValue(table.id, buttonField.id, record.id);

      await ctx.updateField({
        tableId: table.id,
        fieldId: buttonField.id,
        field: {
          type: 'button',
          options: {
            label: 'Launch',
            color: 'blue',
            maxCount: 8,
            resetCount: true,
            workflow: {
              id: 'wflButtonMetadataTest',
              name: 'Renamed workflow',
              isActive: false,
            },
            confirm: {
              title: 'Confirm launch',
              description: 'Launch now?',
              confirmText: 'Launch',
            },
          },
        },
      });

      expect(await getButtonValue(table.id, buttonField.id, record.id)).toEqual({ count: 3 });
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });
});

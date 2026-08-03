/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: button v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

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
});

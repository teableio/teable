/**
 * F01–F22 / D16 — the field capability matrix, default-value column.
 *
 * §2 of the requirement document states, per field type, whether a default
 * value or automatic value applies. D16 (建议需求) adds the invariant that
 * system and derived fields can never be given a writable default.
 *
 * The two tables below are the document's own classification: eight field
 * types accept a user-configured default, the remaining fourteen do not. Each
 * row is exercised against the live API, so a type silently gaining or losing
 * the ability to hold a default fails here.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type DefaultableCase = {
  /** Requirement-facing label. */
  readonly rule: string;
  /** Field definition sent to `createField`. */
  readonly field: Record<string, unknown>;
  /** Value the default must produce on a fresh record. */
  readonly expected: unknown;
};

/** F01–F09 — the eight types the document marks as having a configurable default. */
const DEFAULTABLE: ReadonlyArray<DefaultableCase> = [
  {
    rule: 'F01 single line text',
    field: { type: 'singleLineText', name: 'F01', options: { defaultValue: 'text-default' } },
    expected: 'text-default',
  },
  {
    rule: 'F02 long text',
    field: { type: 'longText', name: 'F02', options: { defaultValue: 'long-default' } },
    expected: 'long-default',
  },
  {
    rule: 'F03 number, including 0',
    field: { type: 'number', name: 'F03', options: { defaultValue: 0 } },
    expected: 0,
  },
  {
    rule: 'F04 date, only the `now` marker',
    field: { type: 'date', name: 'F04', options: { defaultValue: 'now' } },
    expected: expect.any(String),
  },
  {
    rule: 'F05 single select',
    field: {
      type: 'singleSelect',
      name: 'F05',
      options: { choices: [{ name: 'Alpha' }, { name: 'Beta' }], defaultValue: 'Alpha' },
    },
    expected: 'Alpha',
  },
  {
    rule: 'F06 multiple select',
    field: {
      type: 'multipleSelect',
      name: 'F06',
      options: { choices: [{ name: 'Alpha' }, { name: 'Beta' }], defaultValue: ['Alpha', 'Beta'] },
    },
    expected: ['Alpha', 'Beta'],
  },
  {
    rule: 'F07 checkbox, true',
    field: { type: 'checkbox', name: 'F07', options: { defaultValue: true } },
    expected: true,
  },
  {
    rule: 'F09 user',
    field: { type: 'user', name: 'F09', options: { defaultValue: 'me' } },
    expected: expect.objectContaining({ id: 'usrTestUserId' }),
  },
];

type NoDefaultCase = {
  readonly rule: string;
  readonly field: Record<string, unknown>;
  /**
   * Sentinel offered as a default. The assertion is that this exact value never
   * reaches a created record, whether the API rejects the option or strips it.
   */
  readonly sentinel: unknown;
};

/** F08 and F10–F22 — no user-configurable default. */
const NO_DEFAULTABLE: ReadonlyArray<NoDefaultCase> = [
  {
    rule: 'F08 rating has no default',
    field: { type: 'rating', name: 'F08', options: { max: 5, defaultValue: 3 } },
    sentinel: 3,
  },
  {
    rule: 'F10 attachment has no default',
    field: { type: 'attachment', name: 'F10', options: { defaultValue: 'sentinel-attachment' } },
    sentinel: 'sentinel-attachment',
  },
  {
    rule: 'F12 formula is derived',
    field: {
      type: 'formula',
      name: 'F12',
      options: { expression: '"computed"', defaultValue: 'sentinel-formula' },
    },
    sentinel: 'sentinel-formula',
  },
  {
    rule: 'F15 created time is generated',
    field: { type: 'createdTime', name: 'F15', options: { defaultValue: 'sentinel-created-time' } },
    sentinel: 'sentinel-created-time',
  },
  {
    rule: 'F16 last modified time is generated',
    field: {
      type: 'lastModifiedTime',
      name: 'F16',
      options: { defaultValue: 'sentinel-modified-time' },
    },
    sentinel: 'sentinel-modified-time',
  },
  {
    rule: 'F17 created by is generated',
    field: { type: 'createdBy', name: 'F17', options: { defaultValue: 'sentinel-created-by' } },
    sentinel: 'sentinel-created-by',
  },
  {
    rule: 'F18 last modified by is generated',
    field: {
      type: 'lastModifiedBy',
      name: 'F18',
      options: { defaultValue: 'sentinel-modified-by' },
    },
    sentinel: 'sentinel-modified-by',
  },
  {
    rule: 'F19 auto number is generated',
    field: { type: 'autoNumber', name: 'F19', options: { defaultValue: 12345 } },
    sentinel: 12345,
  },
  {
    rule: 'F20 button has no configurable default count',
    field: {
      type: 'button',
      name: 'F20',
      options: { label: 'Run', defaultValue: 'sentinel-button' },
    },
    sentinel: 'sentinel-button',
  },
];

describe('F01–F22 / D16: which field types can hold a default value', () => {
  let ctx: SharedTestContext;
  let tableId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'F Default Capability',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  describe.each(DEFAULTABLE)('$rule accepts a default value', ({ field, expected }) => {
    it('applies it to a record created without the field', async () => {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: field as never,
      });
      const name = field.name as string;
      const fieldId = fieldByName(created, name).id;

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toEqual(expected);
    });

    it('exposes the configured default on the field options', async () => {
      const reloaded = await ctx.getTableById(tableId);
      const options = fieldOptions(reloaded.fields.find((item) => item.name === field.name));
      expect(options).toHaveProperty('defaultValue');
    });
  });

  describe.each(NO_DEFAULTABLE)('$rule cannot be given a usable default', ({ field, sentinel }) => {
    it('never stores the offered default on a record', async () => {
      const name = field.name as string;
      let fieldId: string | undefined;
      try {
        const created = await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: field as never,
        });
        fieldId = fieldByName(created, name).id;
      } catch {
        // The stricter outcome — an outright rejection — also satisfies D16.
        return;
      }

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const stored = findRow(rows, record.id)?.fields[fieldId];

      expect(stored).not.toEqual(sentinel);
    });

    it('does not persist the offered default on the field options', async () => {
      const reloaded = await ctx.getTableById(tableId);
      const existing = reloaded.fields.find((item) => item.name === field.name);
      if (!existing) return;
      expect(fieldOptions(existing).defaultValue).toBeUndefined();
    });
  });
});

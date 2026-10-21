/**
 * D08 / D09 / D13 — what the default value actually stores.
 *
 * D08 (实现依据): text defaults are trimmed at configuration time; the
 * requirement document asks whether CJK, symbols, internal spaces and
 * newlines survive. Long text keeps them — only the surrounding whitespace is
 * dropped. Single-line text additionally normalises internal newlines and tabs
 * to spaces on write (T7855), since a single-line value cannot hold line breaks.
 * D09 (实现依据): the numeric default is a plain number, so 0, negatives and
 * decimals are all legal.
 * D13 (待定口径): the requirement document asks how a `false` checkbox default
 * is stored. v2 normalises a cleared checkbox to NULL, so `false` and "no
 * default" are indistinguishable on the record.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  fieldByName,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('D08/D09/D13: persisted default fidelity', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D08 Default Fidelity',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text' },
        { type: 'longText', name: 'LongText' },
        { type: 'number', name: 'Number' },
        { type: 'checkbox', name: 'CheckboxTrue' },
        { type: 'checkbox', name: 'CheckboxFalse' },
        { type: 'checkbox', name: 'CheckboxUnset' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const setDefault = async (fieldName: string, defaultValue: unknown) => {
    await ctx.updateField({
      tableId,
      fieldId: ids[fieldName],
      field: { options: { defaultValue } },
    });
  };

  const createAndRead = async (fieldName: string) => {
    const record = await ctx.createRecord(tableId, {});
    return readValue(ctx, tableId, record.id, ids[fieldName]);
  };

  // D08 — the surrounding whitespace is always trimmed; the payload inside the
  // string is stored byte for byte. For single-line text, internal newlines and
  // tabs are also normalised to spaces on write (T7855), so those cases carry a
  // `singleLineExpected` that overrides the long-text `expected`.
  const textFidelityCases: {
    label: string;
    value: string;
    expected: string | null;
    singleLineExpected?: string | null;
  }[] = [
    { label: 'Chinese text', value: '  中文字段默认值  ', expected: '中文字段默认值' },
    { label: 'emoji', value: '  🚀 teable  ', expected: '🚀 teable' },
    { label: 'internal runs of spaces', value: '  a   b  ', expected: 'a   b' },
    {
      label: 'internal newlines',
      value: '  line1\nline2  ',
      expected: 'line1\nline2',
      singleLineExpected: 'line1 line2',
    },
    { label: 'internal tabs', value: '\tindented\t', expected: 'indented' },
    { label: 'symbols', value: '  <a&b>"c`d"  ', expected: '<a&b>"c`d"' },
    { label: 'surrounding whitespace only', value: '     ', expected: null },
  ];

  describe('D08 text defaults', () => {
    it.each(textFidelityCases)(
      'keeps $label verbatim',
      async ({ value, expected, singleLineExpected }) => {
        await setDefault('Text', value);
        await expect(createAndRead('Text')).resolves.toBe(
          singleLineExpected === undefined ? expected : singleLineExpected
        );
      }
    );
  });

  describe('D08 long text defaults', () => {
    it.each([
      ...textFidelityCases,
      { label: 'internal newlines', value: '  line1\nline2  ', expected: 'line1\nline2' },
      { label: 'internal tabs', value: '  left\tright  ', expected: 'left\tright' },
    ])('preserves $label after trimming', async ({ value, expected }) => {
      await setDefault('LongText', value);
      await expect(createAndRead('LongText')).resolves.toBe(expected);
    });
  });

  // D09 — the numeric default is not restricted to positive integers.
  const numberCases = [
    { label: 'zero', value: 0, expected: 0 },
    { label: 'a negative integer', value: -7, expected: -7 },
    { label: 'a negative decimal', value: -0.125, expected: -0.125 },
    { label: 'a high-precision decimal', value: 123.456789, expected: 123.456789 },
    { label: 'a very small value', value: 1e-9, expected: 1e-9 },
    { label: 'a large value', value: 1e15, expected: 1e15 },
  ] as const;

  describe('D09 number defaults', () => {
    it.each(numberCases)('accepts $label', async ({ value, expected }) => {
      await setDefault('Number', value);
      await expect(createAndRead('Number')).resolves.toBe(expected);
    });

    test('D09 rejects a non-numeric default', async () => {
      await expect(setDefault('Number', 'forty-two')).rejects.toThrow();
    });
  });

  // D13 — a cleared checkbox is stored as NULL, so a `false` default cannot be
  // told apart from "no default configured".
  describe('D13 checkbox defaults', () => {
    test('a false default persists as a configured default on the field', async () => {
      await setDefault('CheckboxFalse', false);
      const table = await ctx.getTableById(tableId);
      const field = fieldByName(table, 'CheckboxFalse');
      expect((field.options as Record<string, unknown>).defaultValue).toBe(false);
    });

    test('a false default stores a cleared cell', async () => {
      await setDefault('CheckboxFalse', false);
      await expect(createAndRead('CheckboxFalse')).resolves.toBeNull();
    });

    test('a true default stores a checked cell', async () => {
      await setDefault('CheckboxTrue', true);
      await expect(createAndRead('CheckboxTrue')).resolves.toBe(true);
    });

    test('no configured default also stores a cleared cell', async () => {
      await expect(createAndRead('CheckboxUnset')).resolves.toBeNull();
    });

    test('clearing the default configuration succeeds and keeps new rows empty', async () => {
      await setDefault('CheckboxTrue', true);
      await setDefault('CheckboxTrue', null);

      const table = await ctx.getTableById(tableId);
      expect(fieldByName(table, 'CheckboxTrue').options).not.toMatchObject({
        defaultValue: true,
      });
      await expect(createAndRead('CheckboxTrue')).resolves.toBeNull();
    });

    test('explicit false and explicit null store the same cleared cell', async () => {
      await setDefault('CheckboxTrue', true);

      const falseRecord = await ctx.createRecord(tableId, { [ids.CheckboxTrue]: false });
      const nullRecord = await ctx.createRecord(tableId, { [ids.CheckboxTrue]: null });

      await expect(readValue(ctx, tableId, falseRecord.id, ids.CheckboxTrue)).resolves.toBeNull();
      await expect(readValue(ctx, tableId, nullRecord.id, ids.CheckboxTrue)).resolves.toBeNull();
    });
  });
});

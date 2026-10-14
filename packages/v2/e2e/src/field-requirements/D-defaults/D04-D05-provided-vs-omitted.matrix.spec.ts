/**
 * D04 / D05 / D10 — default values are create-time fills, not overrides.
 *
 * D04 (待定口径): the requirement document asks which of "key omitted", explicit
 * `null`, `''`, `0`, `false` and `[]` trigger the configured default. The
 * case table below characterises the current v2 answer so the open question
 * can be decided against observed behaviour.
 *
 * D05 (建议需求): a default value must never override a valid explicit input.
 *
 * D10 (实现依据): the date `now` default is evaluated per record at creation
 * time, never frozen when the field configuration is saved.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import {
  asInstant,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

type ProvidedCase = {
  /** Requirement-facing label used in the test title. */
  readonly label: string;
  /** Value sent for the field key; `undefined` means "key omitted". */
  readonly provided: unknown;
  /** Raw stored value expected afterwards. */
  readonly expected: unknown;
};

/** `JSON.stringify` drops `undefined`, so compare through a marker. */
const OMITTED = Symbol('omitted');

describe('D04/D05: default value applies only to an omitted key', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D04 Default Semantics',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Text', options: { defaultValue: 'DEFAULT' } },
        { type: 'longText', name: 'LongText', options: { defaultValue: 'DEFAULT' } },
        { type: 'number', name: 'Number', options: { defaultValue: 42 } },
        { type: 'checkbox', name: 'CheckboxTrue', options: { defaultValue: true } },
        { type: 'checkbox', name: 'CheckboxFalse', options: { defaultValue: false } },
        {
          type: 'singleSelect',
          name: 'Select',
          options: { choices: [{ name: 'A' }, { name: 'B' }], defaultValue: 'A' },
        },
        {
          type: 'multipleSelect',
          name: 'MultiSelect',
          options: { choices: [{ name: 'A' }, { name: 'B' }], defaultValue: ['A', 'B'] },
        },
        { type: 'date', name: 'Date', options: { defaultValue: 'now' } },
        { type: 'user', name: 'User', options: { defaultValue: 'me' } },
        { type: 'rating', name: 'Rating', options: { max: 5 } },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const createAndRead = async (fieldName: string, provided: unknown) => {
    const fieldId = ids[fieldName];
    const fields = provided === OMITTED ? {} : { [fieldId]: provided };
    const record = await ctx.createRecord(tableId, fields);
    return readValue(ctx, tableId, record.id, fieldId);
  };

  const describeCase = (fieldName: string, cases: ReadonlyArray<ProvidedCase>) => {
    describe(fieldName, () => {
      it.each(cases)('D04 $label', async ({ provided, expected }) => {
        await expect(createAndRead(fieldName, provided)).resolves.toEqual(expected);
      });
    });
  };

  // D04/D05 — explicit valid input wins over the default.
  describeCase('Text', [
    { label: 'keeps the default when the key is omitted', provided: OMITTED, expected: 'DEFAULT' },
    { label: 'treats explicit null as a clear, not a default', provided: null, expected: null },
    // T6520: a cleared "" is stored as NULL, so it clears rather than defaulting.
    { label: 'treats an explicit empty string as a clear', provided: '', expected: null },
    { label: 'keeps an explicit value', provided: 'typed', expected: 'typed' },
  ]);

  describeCase('LongText', [
    { label: 'keeps the default when the key is omitted', provided: OMITTED, expected: 'DEFAULT' },
    { label: 'treats explicit null as a clear', provided: null, expected: null },
    { label: 'keeps an explicit value', provided: 'typed', expected: 'typed' },
  ]);

  // D05 core case: 0 is a valid explicit number and must not be replaced by 42.
  describeCase('Number', [
    { label: 'keeps the numeric default when the key is omitted', provided: OMITTED, expected: 42 },
    { label: 'keeps explicit 0 instead of the default', provided: 0, expected: 0 },
    { label: 'keeps an explicit negative value', provided: -7.5, expected: -7.5 },
    { label: 'treats explicit null as a clear', provided: null, expected: null },
  ]);

  // D05 core case: false is a valid explicit boolean.
  describeCase('CheckboxTrue', [
    { label: 'keeps the true default when the key is omitted', provided: OMITTED, expected: true },
    // T6520: checkbox false is stored as NULL, so it is indistinguishable
    // from a cleared cell.
    { label: 'stores explicit false as a cleared cell', provided: false, expected: null },
  ]);

  describeCase('Select', [
    { label: 'keeps the option default when the key is omitted', provided: OMITTED, expected: 'A' },
    { label: 'keeps a different explicit option', provided: 'B', expected: 'B' },
    { label: 'treats explicit null as a clear', provided: null, expected: null },
    // T6520: a cleared "" is a clear for every field type, select included.
    { label: 'treats an explicit empty string as a clear', provided: '', expected: null },
  ]);

  describeCase('MultiSelect', [
    {
      label: 'keeps the option-set default when the key is omitted',
      provided: OMITTED,
      expected: ['A', 'B'],
    },
    { label: 'keeps a single explicit option', provided: ['B'], expected: ['B'] },
    { label: 'treats explicit null as a clear', provided: null, expected: null },
    // T6520: an empty array is a clear, not the default.
    { label: 'treats an explicit empty array as a clear', provided: [], expected: null },
    { label: 'treats an explicit empty string as a clear', provided: '', expected: null },
  ]);

  describeCase('User', [
    {
      label: 'resolves the `me` default for the creating actor',
      provided: OMITTED,
      expected: expect.objectContaining({ id: 'usrTestUserId' }),
    },
    { label: 'treats explicit null as a clear', provided: null, expected: null },
  ]);

  describeCase('Rating', [
    // F08: rating has no configurable default, so an omitted key stays empty.
    { label: 'has no default value', provided: OMITTED, expected: null },
  ]);

  test('D04 every string-shaped cell reads a cleared "" the same way', async () => {
    // Regression guard for the one field type that used to reject the cleared
    // form: text, long text, single select and multiple select all normalise ""
    // to an empty cell rather than raising a validation error. Checkbox is not
    // string-shaped, so its clear form is `false`, not "".
    const record = await ctx.createRecord(tableId, {
      [ids.Text]: '',
      [ids.LongText]: '',
      [ids.Select]: '',
      [ids.MultiSelect]: '',
      [ids.CheckboxTrue]: false,
    });

    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = rows.find((candidate) => candidate.id === record.id);
    expect(row?.fields[ids.Text] ?? null).toBeNull();
    expect(row?.fields[ids.LongText] ?? null).toBeNull();
    expect(row?.fields[ids.Select] ?? null).toBeNull();
    expect(row?.fields[ids.MultiSelect] ?? null).toBeNull();
    expect(row?.fields[ids.CheckboxTrue] ?? null).toBeNull();
  });

  test('D10 date `now` is evaluated per record, not at field save time', async () => {
    const first = await createAndRead('Date', OMITTED);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await createAndRead('Date', OMITTED);

    const firstInstant = asInstant(first);
    const secondInstant = asInstant(second);

    expect(secondInstant).toBeGreaterThan(firstInstant);
    // Each record is stamped close to its own creation, not to the moment the
    // field configuration was saved.
    expect(Math.abs(Date.now() - secondInstant)).toBeLessThan(60_000);
  });
});

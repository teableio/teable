/**
 * D11 / D12 — select defaults must resolve to real options.
 *
 * D11 (建议需求): the default must correspond to a legal option. v2 answers this
 * strictly: the *name* has to match an option that exists at configuration
 * time, otherwise the field create/update is rejected with
 * `SelectField defaultValue must match an option name`. Option ids are not
 * accepted as defaults.
 *
 * D12 (待定口径): renaming or deleting an option must leave the default either
 * valid or explicitly invalid, never silently wrong. Because D11 validates at
 * configuration time, a rename that leaves the default dangling is refused.
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

type Choice = { id: string; name: string };

describe('D11/D12: select default validity', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'D11 Select Defaults',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const choicesByName = (names: ReadonlyArray<string>) => names.map((name) => ({ name }));
  const choicesOf = (field: unknown): Choice[] =>
    (fieldOptions(field as { options?: unknown }).choices ?? []) as Choice[];

  /**
   * The generated option type is a discriminated union over all 22 field
   * types, which cannot be narrowed from a runtime `type` variable. The
   * payloads below are validated by the live API instead.
   */
  type RawField = Parameters<SharedTestContext['createField']>[0]['field'];

  /** Creates a select field and returns the value a fresh record received. */
  const createSelect = async (
    type: 'singleSelect' | 'multipleSelect',
    names: ReadonlyArray<string>,
    defaultValue: unknown
  ) => {
    seq += 1;
    const name = `Sel-${type}-${seq}`;
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type, name, options: { choices: choicesByName(names), defaultValue } } as RawField,
    });
    const table = await ctx.getTableById(tableId);
    const field = fieldByName(table, name);
    const record = await ctx.createRecord(tableId, {});
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    return { field, storedValue: findRow(rows, record.id)?.fields[field.id] };
  };

  const expectSelectRejected = (
    type: 'singleSelect' | 'multipleSelect',
    names: ReadonlyArray<string>,
    defaultValue: unknown,
    message: RegExp
  ) => {
    seq += 1;
    return expect(
      ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type,
          name: `Sel-invalid-${seq}`,
          options: { choices: choicesByName(names), defaultValue },
        } as RawField,
      })
    ).rejects.toThrow(message);
  };

  describe('D11 a single select default must name an existing option', () => {
    it('applies a legal option name', async () => {
      const { storedValue } = await createSelect('singleSelect', ['Alpha', 'Beta'], 'Alpha');
      expect(storedValue).toBe('Alpha');
    });

    it('rejects a default that names no option', async () => {
      await expectSelectRejected(
        'singleSelect',
        ['Alpha', 'Beta'],
        'Gamma',
        /must match an option name/i
      );
    });

    it('rejects an array default on a single select', async () => {
      await expectSelectRejected(
        'singleSelect',
        ['Alpha', 'Beta'],
        ['Alpha'],
        /must be a single option/i
      );
    });

    it('rejects an option id used as a default, because the name is required', async () => {
      seq += 1;
      const name = `Sel-byId-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleSelect', name, options: { choices: choicesByName(['Alpha']) } },
      });
      const field = fieldByName(created, name);
      const alpha = choicesOf(field)[0];

      await expect(
        ctx.updateField({
          tableId,
          fieldId: field.id,
          field: { options: { choices: choicesOf(field), defaultValue: alpha.id } },
        })
      ).rejects.toThrow(/must match an option name/i);
    });

    it('rejects a field whose options carry duplicate names', async () => {
      await expectSelectRejected('singleSelect', ['Alpha', 'Alpha'], undefined, /must be unique/i);
    });
  });

  describe('D11 a multiple select default resolves option by option', () => {
    it('applies the declared option names', async () => {
      const { storedValue } = await createSelect(
        'multipleSelect',
        ['Alpha', 'Beta'],
        ['Alpha', 'Beta']
      );
      expect(storedValue).toEqual(['Alpha', 'Beta']);
    });

    it('keeps the order the default declares', async () => {
      const { storedValue } = await createSelect(
        'multipleSelect',
        ['Alpha', 'Beta', 'Gamma'],
        ['Gamma', 'Alpha']
      );
      expect(storedValue).toEqual(['Gamma', 'Alpha']);
    });

    it('keeps a repeated option name rather than de-duplicating it', async () => {
      // The configuration layer validates membership only, so the stored value
      // mirrors the configured list exactly, duplicates included.
      const { storedValue } = await createSelect(
        'multipleSelect',
        ['Alpha', 'Beta'],
        ['Alpha', 'Alpha']
      );
      expect(storedValue).toEqual(['Alpha', 'Alpha']);
    });

    it('rejects a default containing an unknown option name', async () => {
      await expectSelectRejected(
        'multipleSelect',
        ['Alpha', 'Beta'],
        ['Alpha', 'Gamma'],
        /must match an option name/i
      );
    });

    it('accepts an empty array default and leaves the record empty', async () => {
      const { storedValue } = await createSelect('multipleSelect', ['Alpha'], []);
      expect(storedValue).toBeNull();
    });
  });

  describe('D12 renaming an option keeps the default reachable', () => {
    it('accepts a rename that re-points the default in the same payload', async () => {
      seq += 1;
      const name = `Sel-rename-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleSelect',
          name,
          options: { choices: choicesByName(['Alpha', 'Beta']), defaultValue: 'Alpha' },
        },
      });
      const field = fieldByName(created, name);
      const [alpha, beta] = choicesOf(field);

      // The option rewrite and the default re-point are validated as a pair, so
      // the coherent rename is a single request.
      const updated = await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: {
          options: {
            choices: [{ id: alpha.id, name: 'Alpha renamed' }, beta],
            defaultValue: 'Alpha renamed',
          },
        },
      });
      expect(fieldOptions(fieldByName(updated, name)).defaultValue).toBe('Alpha renamed');

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[field.id]).toBe('Alpha renamed');
    });

    it('refuses a rename that would leave the default dangling', async () => {
      seq += 1;
      const name = `Sel-dangling-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleSelect',
          name,
          options: { choices: choicesByName(['Alpha', 'Beta']), defaultValue: 'Alpha' },
        },
      });
      const field = fieldByName(created, name);
      const [alpha, beta] = choicesOf(field);

      // Renaming without re-pointing the default must not be committed
      // silently: the configuration would be permanently unreachable.
      await expect(
        ctx.updateField({
          tableId,
          fieldId: field.id,
          field: {
            options: { choices: [{ id: alpha.id, name: 'Alpha renamed' }, beta] },
          },
        })
      ).rejects.toThrow(/must match an option name/i);

      // The field keeps the original, still-valid configuration.
      const reloaded = await ctx.getTableById(tableId);
      const reloadedField = reloaded.fields.find((item) => item.id === field.id);
      expect(fieldOptions(reloadedField).defaultValue).toBe('Alpha');
      expect(choicesOf(reloadedField).map((choice) => choice.name)).toEqual(['Alpha', 'Beta']);
    });

    it('refuses deleting the option a default points at', async () => {
      seq += 1;
      const name = `Sel-delete-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleSelect',
          name,
          options: { choices: choicesByName(['Alpha', 'Beta']), defaultValue: 'Alpha' },
        },
      });
      const field = fieldByName(created, name);
      const [, beta] = choicesOf(field);

      await expect(
        ctx.updateField({
          tableId,
          fieldId: field.id,
          field: { options: { choices: [beta] } },
        })
      ).rejects.toThrow(/must match an option name/i);
    });

    it('accepts deleting an option when the default moves in the same payload', async () => {
      seq += 1;
      const name = `Sel-delete-repoint-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleSelect',
          name,
          options: { choices: choicesByName(['Alpha', 'Beta']), defaultValue: 'Alpha' },
        },
      });
      const field = fieldByName(created, name);
      const [, beta] = choicesOf(field);

      await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: { options: { choices: [beta], defaultValue: 'Beta' } },
      });

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[field.id]).toBe('Beta');
    });

    it('accepts clearing the default and renaming the option in one payload', async () => {
      seq += 1;
      const name = `Sel-clear-rename-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleSelect',
          name,
          options: { choices: choicesByName(['Alpha', 'Beta']), defaultValue: 'Alpha' },
        },
      });
      const field = fieldByName(created, name);
      const [alpha, beta] = choicesOf(field);

      await ctx.updateField({
        tableId,
        fieldId: field.id,
        field: {
          options: {
            choices: [{ id: alpha.id, name: 'Alpha renamed' }, beta],
            defaultValue: null,
          },
        },
      });

      const reloaded = await ctx.getTableById(tableId);
      const reloadedField = reloaded.fields.find((item) => item.id === field.id);
      expect(fieldOptions(reloadedField).defaultValue).toBeUndefined();

      const record = await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[field.id]).toBeNull();
    });
  });
});

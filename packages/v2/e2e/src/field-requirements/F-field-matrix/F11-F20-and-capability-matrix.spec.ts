/**
 * F11 / F20 and the §2 capability matrix as a whole.
 *
 * §2 of the requirement document is a table keyed by field type. This spec keeps
 * the table honest in both directions: the registry must cover exactly the types
 * the field factory accepts, and the create API must accept every row with the
 * declared defaultability.
 *
 * F11 (实现依据): the four relationship kinds, and the single/multi constraint
 * each of them imposes.
 * F20 (实现依据): a button holds configuration, not a cell value, and offers no
 * user default.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { fieldTypeValues } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  firstGridId,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';
import {
  REGISTERED_FIELD_TYPES,
  USER_DEFAULTABLE_TYPES,
  AUTOMATIC_TYPES,
  NO_DEFAULT_TYPES,
  fieldTypeSpec,
} from '../shared/fieldTypes';

/** F11 — the four relationship kinds the document lists. */
const RELATIONSHIPS = ['oneOne', 'oneMany', 'manyOne', 'manyMany'] as const;

describe('F11/F20/§2: field capability matrix', () => {
  let ctx: SharedTestContext;
  let foreignTableId: string;
  let foreignPrimaryId: string;
  let tableId: string;
  const ids: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const foreign = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'F11 Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreign.id;
    foreignPrimaryId = fieldByName(foreign, 'Title').id;
    await ctx.createRecords(foreignTableId, [{ fields: {} }, { fields: {} }, { fields: {} }]);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'F20 Button',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'button', name: 'Run', options: { label: 'Run', color: 'blue' } },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    firstGridId(table);
    for (const field of table.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  describe('the §2 registry covers the field factory exactly', () => {
    it('registers one row per field type', () => {
      expect(REGISTERED_FIELD_TYPES).toHaveLength(22);
      expect(new Set(REGISTERED_FIELD_TYPES).size).toBe(22);
      expect([...fieldTypeValues].sort()).toEqual([...REGISTERED_FIELD_TYPES].sort());
    });

    it('carries a unique requirement id per row', () => {
      const requirements = REGISTERED_FIELD_TYPES.map((type) => fieldTypeSpec(type).requirement);
      expect(new Set(requirements).size).toBe(requirements.length);
    });

    it('splits the default kind into three disjoint groups', () => {
      const total =
        USER_DEFAULTABLE_TYPES.length + AUTOMATIC_TYPES.length + NO_DEFAULT_TYPES.length;
      expect(total).toBe(22);
      const overlap = new Set([...USER_DEFAULTABLE_TYPES, ...AUTOMATIC_TYPES, ...NO_DEFAULT_TYPES]);
      expect(overlap.size).toBe(22);
    });

    it('matches the eight types D01 lists as defaultable', () => {
      expect([...USER_DEFAULTABLE_TYPES].sort()).toEqual(
        [
          'checkbox',
          'date',
          'longText',
          'multipleSelect',
          'number',
          'singleLineText',
          'singleSelect',
          'user',
        ].sort()
      );
    });

    it('matches the five types the system fills in', () => {
      expect([...AUTOMATIC_TYPES].sort()).toEqual(
        ['autoNumber', 'createdBy', 'createdTime', 'lastModifiedBy', 'lastModifiedTime'].sort()
      );
    });
  });

  describe('F20 button configuration', () => {
    it('keeps the label and colour as configuration, not as a cell value', async () => {
      const reloaded = await ctx.getTableById(tableId);
      const button = fieldByName(reloaded, 'Run');
      expect(button.type).toBe('button');

      await ctx.createRecord(tableId, {});
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      // An untouched button has no count; display configuration remains separate.
      expect(rows).toHaveLength(1);
      expect(rows[0].fields[ids.Run] ?? null).toBeNull();
    });

    it('rejects malformed button values and persists explicit click counts', async () => {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'button',
          name: 'Run2',
          options: { label: 'Run', color: 'red', maxCount: 3 },
        },
      });
      const fieldId = fieldByName(created, 'Run2').id;

      await expect(ctx.createRecord(tableId, { [fieldId]: 'clicked' })).rejects.toThrow(
        'validation.field.invalid_value'
      );
      const record = await ctx.createRecord(tableId, { [fieldId]: { count: 3 } });
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toEqual({ count: 3 });
      expect(fieldOptions(fieldByName(created, 'Run2')).maxCount).toBe(3);
    });
  });

  describe('F11 the four link relationship kinds constrain cardinality', () => {
    const linkFieldOf = async (relationship: (typeof RELATIONSHIPS)[number]) => {
      seq += 1;
      const name = `Link-${relationship}-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'link',
          name,
          options: {
            relationship,
            foreignTableId,
            lookupFieldId: foreignPrimaryId,
            isOneWay: true,
          },
        },
      });
      return fieldByName(created, name);
    };

    it.each(RELATIONSHIPS)('round-trips the %s relationship', async (relationship) => {
      const field = await linkFieldOf(relationship);
      expect((fieldOptions(field).relationship as string) ?? 'manyMany').toBe(relationship);
      expect(fieldOptions(field).foreignTableId).toBe(foreignTableId);
    });

    it('rejects an unknown relationship kind', async () => {
      await expect(linkFieldOf('many' as never)).rejects.toThrow();
    });

    it('the many-to-many link accepts several foreign records on one host row', async () => {
      const field = await linkFieldOf('manyMany');
      const foreignRows = await ctx.listRecords(foreignTableId, { limit: 100 });
      const record = await ctx.createRecord(tableId, {
        [field.id]: foreignRows.slice(0, 3).map((row) => ({ id: row.id })),
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const linked = findRow(rows, record.id)?.fields[field.id];
      expect(Array.isArray(linked)).toBe(true);
      expect((linked as unknown[]).length).toBe(3);
    });

    it('the one-to-one link replaces the previous partner instead of holding two', async () => {
      const field = await linkFieldOf('oneOne');
      const foreignRows = await ctx.listRecords(foreignTableId, { limit: 100 });
      const record = await ctx.createRecord(tableId, {
        [field.id]: [{ id: foreignRows[0].id }],
      });

      // Replacing is legal for a 1:1 — it is the second host row that may not
      // point at an already-linked record.
      await ctx.updateRecord(tableId, record.id, {
        [field.id]: [{ id: foreignRows[1].id }],
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const linked = findRow(rows, record.id)?.fields[field.id];
      const linkedIds = Array.isArray(linked)
        ? (linked as Array<{ id: string }>).map((item) => item.id)
        : [(linked as { id: string } | null)?.id ?? null];
      expect(linkedIds).toEqual([foreignRows[1].id]);
    });

    it('a one-to-one link cannot be shared by two host rows', async () => {
      const field = await linkFieldOf('oneOne');
      const foreignRows = await ctx.listRecords(foreignTableId, { limit: 100 });
      const target = foreignRows[0].id;

      await ctx.createRecord(tableId, { [field.id]: [{ id: target }] });
      await expect(ctx.createRecord(tableId, { [field.id]: [{ id: target }] })).rejects.toThrow();
    });
  });
});

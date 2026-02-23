/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

type LinkValue = { id: string; title?: string };

const asLinkArray = (value: unknown): LinkValue[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value as LinkValue[];
  return [value as LinkValue];
};

const extractSymmetricFieldId = (field: { options?: unknown } | undefined): string | undefined => {
  const options = field?.options as Record<string, unknown> | undefined;
  return typeof options?.symmetricFieldId === 'string' ? options.symmetricFieldId : undefined;
};

describe('update-field: singleLineText → link conversion', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  test('should match by foreign primary value and drop unmatched tokens', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-mo-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-mo-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const hostPrimaryId = hostTable.fields.find((f) => f.isPrimary)?.id;
    const hostFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    const foreignPrimaryId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryId || !hostFieldId || !foreignPrimaryId) throw new Error('field id missing');

    const apple = await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'Apple' });
    await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'Banana' });
    const r1 = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'h1',
      [hostFieldId]: 'Apple',
    });
    const r2 = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'h2',
      [hostFieldId]: 'Cherry',
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: hostFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === hostFieldId);
    expect(updatedField?.type).toBe('link');
    expect(extractSymmetricFieldId(updatedField)).toBeUndefined();

    const rows = await ctx.listRecords(hostTable.id);
    expect(rows.find((r) => r.id === r1.id)?.fields[hostFieldId]).toEqual({
      id: apple.id,
      title: 'Apple',
    });
    expect(rows.find((r) => r.id === r2.id)?.fields[hostFieldId]).toBeNull();
  });

  test('should split comma-separated text for oneMany and keep only matched values', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-om-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-om-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const hostPrimaryId = hostTable.fields.find((f) => f.isPrimary)?.id;
    const hostFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    const foreignPrimaryId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryId || !hostFieldId || !foreignPrimaryId) throw new Error('field id missing');

    const a = await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'A' });
    const b = await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'B' });
    const c = await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'C' });
    const h = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'h',
      [hostFieldId]: 'A, B, Missing',
    });

    const updatedTable = await ctx.updateField({
      tableId: hostTable.id,
      fieldId: hostFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'oneMany',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryId,
          isOneWay: false,
        },
      },
    });
    await ctx.drainOutbox();

    const updatedField = updatedTable.fields.find((f) => f.id === hostFieldId);
    const symmetricFieldId = extractSymmetricFieldId(updatedField);
    expect(symmetricFieldId).toBeDefined();

    const hostRows = await ctx.listRecords(hostTable.id);
    const hostLinks = asLinkArray(hostRows.find((r) => r.id === h.id)?.fields[hostFieldId]);
    expect(hostLinks.map((v) => v.id)).toEqual([a.id, b.id]);
    expect(hostLinks.map((v) => v.title)).toEqual(['A', 'B']);

    const foreignRows = await ctx.listRecords(foreignTable.id);
    expect(foreignRows.find((r) => r.id === a.id)?.fields[symmetricFieldId!]).toMatchObject({
      id: h.id,
    });
    expect(foreignRows.find((r) => r.id === b.id)?.fields[symmetricFieldId!]).toMatchObject({
      id: h.id,
    });
    expect(foreignRows.find((r) => r.id === c.id)?.fields[symmetricFieldId!]).toBeNull();
  });

  test('should trim tokens but keep case-sensitive matching', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-trim-case-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-trim-case-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const hostPrimaryId = hostTable.fields.find((f) => f.isPrimary)?.id;
    const hostFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    const foreignPrimaryId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryId || !hostFieldId || !foreignPrimaryId) throw new Error('field id missing');

    const apple = await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'Apple' });
    const r1 = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'trim-match',
      [hostFieldId]: ' Apple ',
    });
    const r2 = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'case-miss',
      [hostFieldId]: 'apple',
    });

    await ctx.updateField({
      tableId: hostTable.id,
      fieldId: hostFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const rows = await ctx.listRecords(hostTable.id);
    expect(rows.find((r) => r.id === r1.id)?.fields[hostFieldId]).toEqual({
      id: apple.id,
      title: 'Apple',
    });
    expect(rows.find((r) => r.id === r2.id)?.fields[hostFieldId]).toBeNull();
  });

  test('should keep null-like source values as null links', async () => {
    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-null-host'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'ToConvert' },
      ],
    });
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('txt2link-null-foreign'),
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    });

    const hostPrimaryId = hostTable.fields.find((f) => f.isPrimary)?.id;
    const hostFieldId = hostTable.fields.find((f) => f.name === 'ToConvert')?.id;
    const foreignPrimaryId = foreignTable.fields.find((f) => f.isPrimary)?.id;
    if (!hostPrimaryId || !hostFieldId || !foreignPrimaryId) throw new Error('field id missing');

    await ctx.createRecord(foreignTable.id, { [foreignPrimaryId]: 'Apple' });
    const r1 = await ctx.createRecord(hostTable.id, { [hostPrimaryId]: 'null' });
    const r2 = await ctx.createRecord(hostTable.id, {
      [hostPrimaryId]: 'empty',
      [hostFieldId]: '',
    });

    await ctx.updateField({
      tableId: hostTable.id,
      fieldId: hostFieldId,
      field: {
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignPrimaryId,
          isOneWay: true,
        },
      },
    });
    await ctx.drainOutbox();

    const rows = await ctx.listRecords(hostTable.id);
    expect(rows.find((r) => r.id === r1.id)?.fields[hostFieldId]).toBeNull();
    expect(rows.find((r) => r.id === r2.id)?.fields[hostFieldId]).toBeNull();
  });
});

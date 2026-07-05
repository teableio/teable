import { FieldType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { resolveSpaceDataDbRelatedSpaces } from './space-data-db-related-spaces';

type IFakeField = {
  id: string;
  type: string;
  isLookup: boolean | null;
  isConditionalLookup: boolean | null;
  options: string | null;
  lookupOptions: string | null;
  tableId: string;
};

type IFakeDataset = {
  spaces: Array<{ id: string; name: string }>;
  tables: Array<{ id: string; spaceId: string; deleted?: boolean }>;
  fields: IFakeField[];
};

const linkField = (id: string, tableId: string, foreignTableId: string): IFakeField => ({
  id,
  type: FieldType.Link,
  isLookup: null,
  isConditionalLookup: null,
  options: JSON.stringify({ foreignTableId }),
  lookupOptions: null,
  tableId,
});

const matchesRelatedFieldTypes = (field: IFakeField) =>
  (field.type === FieldType.Link && field.isLookup !== true) ||
  field.type === FieldType.ConditionalRollup ||
  (field.isLookup === true && field.isConditionalLookup === true);

// Mirrors the SQL prefilter: every "foreignTableId":"..." occurrence counts.
const prefilterForeignTableIds = (field: IFakeField) => {
  const blob =
    field.isLookup === true && field.isConditionalLookup === true
      ? field.lookupOptions
      : field.options;
  return [...(blob?.matchAll(/"foreignTableId"\s*:\s*"([^"]+)"/g) ?? [])].map((match) => match[1]);
};

const createFakePrisma = (dataset: IFakeDataset) => {
  const liveTables = () => dataset.tables.filter((table) => !table.deleted);
  const spaceIdOfTable = (tableId: string) =>
    liveTables().find((table) => table.id === tableId)?.spaceId;
  const nestedFieldRow = (field: IFakeField) => ({
    ...field,
    table: { base: { spaceId: spaceIdOfTable(field.tableId)! } },
  });

  const queryRawUnsafe = vi.fn(
    async (_sql: string, _link: string, _condRollup: string, tableIds: string[]) =>
      dataset.fields
        .filter(matchesRelatedFieldTypes)
        .filter((field) => spaceIdOfTable(field.tableId))
        .filter((field) =>
          prefilterForeignTableIds(field).some((tableId) => tableIds.includes(tableId))
        )
        .map((field) => ({ ...field, spaceId: spaceIdOfTable(field.tableId)! }))
  );

  return {
    $queryRawUnsafe: queryRawUnsafe,
    field: {
      findMany: vi.fn(
        async ({ where }: { where: { table: { base: { spaceId: { in: string[] } } } } }) =>
          dataset.fields
            .filter(matchesRelatedFieldTypes)
            .filter((field) => {
              const spaceId = spaceIdOfTable(field.tableId);
              return !!spaceId && where.table.base.spaceId.in.includes(spaceId);
            })
            .map(nestedFieldRow)
      ),
    },
    tableMeta: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { id?: { in: string[] }; base?: { spaceId?: { in: string[] } } };
        }) =>
          liveTables()
            .filter((table) =>
              where.id
                ? where.id.in.includes(table.id)
                : where.base?.spaceId
                  ? where.base.spaceId.in.includes(table.spaceId)
                  : false
            )
            .map((table) => ({ id: table.id, base: { spaceId: table.spaceId } }))
      ),
    },
    space: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        dataset.spaces
          .filter((space) => where.id.in.includes(space.id))
          .map((space) => ({
            id: space.id,
            name: space.name,
            baseGroup: [
              {
                id: `bse-${space.id}`,
                tables: liveTables()
                  .filter((table) => table.spaceId === space.id)
                  .map((table) => ({ id: table.id })),
              },
            ],
          }))
      ),
    },
    spaceDataDbBinding: {
      findMany: vi.fn(async () => []),
    },
  };
};

describe('resolveSpaceDataDbRelatedSpaces', () => {
  it('returns a single-space component when links stay inside the space', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblA2', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB' },
      ],
      fields: [linkField('fldA', 'tblA1', 'tblA2')],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(false);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA']);
    expect(result.links).toEqual([]);
    expect(prisma.field.findMany).toHaveBeenCalledTimes(1);
  });

  it('discovers transitive outbound components across spaces', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
        { id: 'spcC', name: 'Gamma' },
        { id: 'spcD', name: 'Delta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB' },
        { id: 'tblC1', spaceId: 'spcC' },
        { id: 'tblD1', spaceId: 'spcD' },
      ],
      fields: [
        linkField('fldAB', 'tblA1', 'tblB1'),
        linkField('fldBC', 'tblB1', 'tblC1'),
        linkField('fldD', 'tblD1', 'tblD1'),
      ],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(true);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA', 'spcB', 'spcC']);
    expect(result.spaces[0]).toMatchObject({ spaceId: 'spcA', isPrimary: true });
    expect(result.links).toEqual([
      expect.objectContaining({ fromSpaceId: 'spcA', toSpaceId: 'spcB', fromFieldId: 'fldAB' }),
      expect.objectContaining({ fromSpaceId: 'spcB', toSpaceId: 'spcC', fromFieldId: 'fldBC' }),
    ]);
  });

  it('discovers inbound links pointing at the primary space', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB' },
      ],
      fields: [linkField('fldBA', 'tblB1', 'tblA1')],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(true);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA', 'spcB']);
    expect(result.links).toEqual([
      expect.objectContaining({ fromSpaceId: 'spcB', toSpaceId: 'spcA', fromFieldId: 'fldBA' }),
    ]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
  });

  it('resolves conditional lookups through lookupOptions', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB' },
      ],
      fields: [
        {
          id: 'fldLookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: null,
          lookupOptions: JSON.stringify({ foreignTableId: 'tblA1', linkFieldId: 'fldx' }),
          tableId: 'tblB1',
        },
      ],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA', 'spcB']);
    expect(result.links).toEqual([
      expect.objectContaining({ fromSpaceId: 'spcB', toSpaceId: 'spcA', fromFieldId: 'fldLookup' }),
    ]);
  });

  it('ignores prefilter false positives whose real edge does not touch the component', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcD', name: 'Delta' },
        { id: 'spcE', name: 'Echo' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblD1', spaceId: 'spcD' },
        { id: 'tblE1', spaceId: 'spcE' },
      ],
      fields: [
        {
          id: 'fldDE',
          type: FieldType.Link,
          isLookup: null,
          isConditionalLookup: null,
          // A nested filter mentions tblA1, so the coarse prefilter surfaces this row
          // for spcA even though its real (top-level) target is tblE1.
          options: `{"filter":{"foreignTableId":"tblA1"},"foreignTableId":"tblE1"}`,
          lookupOptions: null,
          tableId: 'tblD1',
        },
      ],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(false);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA']);
    expect(result.links).toEqual([]);
  });

  it('finds inbound links whose real target follows a nested foreignTableId occurrence', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB' },
      ],
      fields: [
        {
          id: 'fldBA',
          type: FieldType.Link,
          isLookup: null,
          isConditionalLookup: null,
          // The nested (non-frontier) occurrence comes first; a first-match-only
          // prefilter would drop this row and lose the real spcB -> spcA edge.
          options: `{"filter":{"foreignTableId":"tblSomewhereElse"},"foreignTableId":"tblA1"}`,
          lookupOptions: null,
          tableId: 'tblB1',
        },
      ],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(true);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA', 'spcB']);
    expect(result.links).toEqual([
      expect.objectContaining({ fromSpaceId: 'spcB', toSpaceId: 'spcA', fromFieldId: 'fldBA' }),
    ]);
  });

  it('skips links whose foreign table is deleted', async () => {
    const prisma = createFakePrisma({
      spaces: [
        { id: 'spcA', name: 'Alpha' },
        { id: 'spcB', name: 'Beta' },
      ],
      tables: [
        { id: 'tblA1', spaceId: 'spcA' },
        { id: 'tblB1', spaceId: 'spcB', deleted: true },
      ],
      fields: [linkField('fldAB', 'tblA1', 'tblB1')],
    });

    const result = await resolveSpaceDataDbRelatedSpaces(prisma as never, 'spcA');

    expect(result.hasCrossSpaceLinks).toBe(false);
    expect(result.spaces.map((space) => space.spaceId)).toEqual(['spcA']);
    expect(result.links).toEqual([]);
  });
});

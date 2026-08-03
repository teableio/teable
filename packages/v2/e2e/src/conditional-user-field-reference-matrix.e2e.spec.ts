/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type Multiplicity = 'single' | 'multiple';

interface MatrixCase {
  label: string;
  foreignMultiplicity: Multiplicity;
  hostMultiplicity: Multiplicity;
}

interface UserShapeSeed {
  label: string;
  userIds: string[];
  cellValue: { id: string; title: string } | Array<{ id: string; title: string }>;
}

const MATRIX_CASES: MatrixCase[] = [
  {
    label: 'foreign single user x host single user',
    foreignMultiplicity: 'single',
    hostMultiplicity: 'single',
  },
  {
    label: 'foreign single user x host multi user',
    foreignMultiplicity: 'single',
    hostMultiplicity: 'multiple',
  },
  {
    label: 'foreign multi user x host single user',
    foreignMultiplicity: 'multiple',
    hostMultiplicity: 'single',
  },
  {
    label: 'foreign multi user x host multi user',
    foreignMultiplicity: 'multiple',
    hostMultiplicity: 'multiple',
  },
];

const normalizeLookupValues = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.map((entry) => String(entry)).sort();
};

const normalizeUserIds = (userIds: string[]) => [...userIds].sort();

const isExactUserSetMatch = (leftIds: string[], rightIds: string[]) => {
  const normalizedLeft = normalizeUserIds(leftIds);
  const normalizedRight = normalizeUserIds(rightIds);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
};

const matchesUserReferenceIs = (
  foreignUserIds: string[],
  hostUserIds: string[],
  foreignMultiplicity: Multiplicity,
  hostMultiplicity: Multiplicity
) => {
  if (foreignMultiplicity === 'single' && hostMultiplicity === 'single') {
    return foreignUserIds[0] === hostUserIds[0];
  }

  if (foreignMultiplicity === 'single') {
    return hostUserIds.includes(foreignUserIds[0] ?? '');
  }

  if (hostMultiplicity === 'single') {
    return foreignUserIds.length === 1 && foreignUserIds[0] === hostUserIds[0];
  }

  return isExactUserSetMatch(foreignUserIds, hostUserIds);
};

describe('v2 conditional user field reference matrix (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const uniqueName = (prefix: string) => `${prefix}_${fieldIdCounter.toString(36)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test.each(MATRIX_CASES)(
    'covers $label for conditionalLookup and conditionalRollup',
    async ({ foreignMultiplicity, hostMultiplicity }) => {
      const aliceCell = { id: ctx.testUser.id, title: ctx.testUser.name };
      const bobCell = { id: 'usrConditionalUserMatrixBob', title: 'Bob' };

      await sql`
        insert into users (id, name, email)
        values (${bobCell.id}, ${bobCell.title}, ${'bob+conditional-user-matrix@e2e.com'})
        on conflict (id) do nothing
      `.execute(ctx.testContainer.db);

      const foreignNameFieldId = createFieldId();
      const foreignUserFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostUserFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();
      const conditionalRollupFieldId = createFieldId();

      const foreignUserSeeds: Array<{ label: string; amount: number; userIds: string[] }> =
        foreignMultiplicity === 'single'
          ? [
              { label: 'Task Alpha', amount: 10, userIds: [aliceCell.id] },
              { label: 'Task Beta', amount: 20, userIds: [aliceCell.id] },
              { label: 'Task Gamma', amount: 30, userIds: [bobCell.id] },
            ]
          : [
              { label: 'Task Alpha', amount: 10, userIds: [aliceCell.id] },
              { label: 'Task Beta', amount: 20, userIds: [aliceCell.id, bobCell.id] },
              { label: 'Task Gamma', amount: 30, userIds: [bobCell.id] },
            ];

      const toCellValue = (userIds: string[], multiplicity: Multiplicity) => {
        const users = userIds.map((userId) => (userId === aliceCell.id ? aliceCell : bobCell));
        return multiplicity === 'multiple' ? users : users[0];
      };

      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalUserMatrixForeign'),
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Task', isPrimary: true },
          {
            type: 'user',
            id: foreignUserFieldId,
            name: 'Match Users',
            options: { isMultiple: foreignMultiplicity === 'multiple' },
          },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        records: foreignUserSeeds.map((seed) => ({
          fields: {
            [foreignNameFieldId]: seed.label,
            [foreignUserFieldId]: toCellValue(seed.userIds, foreignMultiplicity),
            [foreignAmountFieldId]: seed.amount,
          },
        })),
        views: [{ type: 'grid' }],
      });

      const hostUserSeeds: UserShapeSeed[] =
        hostMultiplicity === 'single'
          ? [
              { label: 'Alice', userIds: [aliceCell.id], cellValue: aliceCell },
              { label: 'Bob', userIds: [bobCell.id], cellValue: bobCell },
            ]
          : [
              { label: 'Alice', userIds: [aliceCell.id], cellValue: [aliceCell] },
              { label: 'Bob', userIds: [bobCell.id], cellValue: [bobCell] },
              {
                label: 'Alice + Bob',
                userIds: [aliceCell.id, bobCell.id],
                cellValue: [aliceCell, bobCell],
              },
            ];

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalUserMatrixHost'),
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'user',
            id: hostUserFieldId,
            name: 'Reference Users',
            options: { isMultiple: hostMultiplicity === 'multiple' },
          },
        ],
        records: hostUserSeeds.map((seed) => ({
          fields: {
            [hostNameFieldId]: seed.label,
            [hostUserFieldId]: seed.cellValue,
          },
        })),
        views: [{ type: 'grid' }],
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'conditionalLookup',
          id: conditionalLookupFieldId,
          name: 'Matched Tasks',
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignUserFieldId,
                    operator: 'is',
                    value: hostUserFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'conditionalRollup',
          id: conditionalRollupFieldId,
          name: 'Matched Amount Sum',
          options: {
            expression: 'sum({values})',
          },
          config: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignAmountFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignUserFieldId,
                    operator: 'is',
                    value: hostUserFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecordsWithoutDrain(host.id);
      const hostRecordsByLabel = new Map(
        hostRecords.map((record) => [String(record.fields[hostNameFieldId]), record.fields])
      );

      for (const hostSeed of hostUserSeeds) {
        const matchingForeignRecords = foreignUserSeeds.filter((seed) =>
          matchesUserReferenceIs(
            seed.userIds,
            hostSeed.userIds,
            foreignMultiplicity,
            hostMultiplicity
          )
        );
        const expectedTitles = matchingForeignRecords.map((seed) => seed.label).sort();
        const expectedSum = matchingForeignRecords.reduce((sum, seed) => sum + seed.amount, 0);

        const hostFields = hostRecordsByLabel.get(hostSeed.label);
        expect(hostFields).toBeDefined();

        const actualTitles = normalizeLookupValues(hostFields?.[conditionalLookupFieldId]);
        const rawRollupValue = hostFields?.[conditionalRollupFieldId];
        const actualRollupValue =
          rawRollupValue == null ? 0 : Number.parseFloat(String(rawRollupValue));

        expect(actualTitles).toEqual(expectedTitles);
        expect(actualRollupValue).toBe(expectedSum);
      }
    }
  );
});

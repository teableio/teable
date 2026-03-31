/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type Multiplicity = 'single' | 'multiple';
type UserOperator =
  | 'isAnyOf'
  | 'isNoneOf'
  | 'hasAnyOf'
  | 'hasAllOf'
  | 'isExactly'
  | 'isNotExactly'
  | 'hasNoneOf';

const normalizeIds = (values: string[]) => [...values].sort();

const hasExactSet = (left: string[], right: string[]) => {
  const normalizedLeft = normalizeIds(left);
  const normalizedRight = normalizeIds(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
};

const matchesUserOperator = (operator: UserOperator, leftIds: string[], rightIds: string[]) => {
  switch (operator) {
    case 'isAnyOf':
    case 'hasAnyOf':
      return rightIds.some((value) => leftIds.includes(value));
    case 'isNoneOf':
    case 'hasNoneOf':
      return rightIds.every((value) => !leftIds.includes(value));
    case 'hasAllOf':
      return rightIds.every((value) => leftIds.includes(value));
    case 'isExactly':
      return hasExactSet(leftIds, rightIds);
    case 'isNotExactly':
      return !hasExactSet(leftIds, rightIds);
  }
};

const normalizeLookupValues = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.map((entry) => String(entry)).sort();
};

const buildUserCellValue = (
  userIds: string[],
  multiplicity: Multiplicity,
  aliceCell: { id: string; title: string },
  bobCell: { id: string; title: string }
) => {
  const users = userIds.map((userId) => (userId === aliceCell.id ? aliceCell : bobCell));
  return multiplicity === 'multiple' ? users : users[0];
};

describe('v2 conditional user field reference operators (e2e)', () => {
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

  describe('single user field operators', () => {
    const CASES: Array<{ hostMultiplicity: Multiplicity; operator: UserOperator }> = [
      { hostMultiplicity: 'single', operator: 'isAnyOf' },
      { hostMultiplicity: 'single', operator: 'isNoneOf' },
      { hostMultiplicity: 'multiple', operator: 'isAnyOf' },
      { hostMultiplicity: 'multiple', operator: 'isNoneOf' },
    ];

    test.each(CASES)(
      'foreign single x host $hostMultiplicity with $operator',
      async ({ hostMultiplicity, operator }) => {
        const aliceCell = { id: ctx.testUser.id, title: ctx.testUser.name };
        const bobCell = { id: 'usrConditionalUserOperatorsBob', title: 'Bob' };

        await sql`
          insert into users (id, name, email)
          values (${bobCell.id}, ${bobCell.title}, ${'bob+conditional-user-operators@e2e.com'})
          on conflict (id) do nothing
        `.execute(ctx.testContainer.db);

        const foreignNameFieldId = createFieldId();
        const foreignUserFieldId = createFieldId();
        const foreignAmountFieldId = createFieldId();
        const hostNameFieldId = createFieldId();
        const hostUserFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const rollupFieldId = createFieldId();

        const foreignSeeds = [
          { label: 'Task Alpha', amount: 10, userIds: [aliceCell.id] },
          { label: 'Task Beta', amount: 20, userIds: [aliceCell.id] },
          { label: 'Task Gamma', amount: 30, userIds: [bobCell.id] },
        ];

        const hostSeeds =
          hostMultiplicity === 'single'
            ? [
                { label: 'Alice', userIds: [aliceCell.id] },
                { label: 'Bob', userIds: [bobCell.id] },
              ]
            : [
                { label: 'Alice', userIds: [aliceCell.id] },
                { label: 'Bob', userIds: [bobCell.id] },
                { label: 'Alice + Bob', userIds: [aliceCell.id, bobCell.id] },
              ];

        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('ConditionalUserOperatorForeignSingle'),
          fields: [
            { type: 'singleLineText', id: foreignNameFieldId, name: 'Task', isPrimary: true },
            {
              type: 'user',
              id: foreignUserFieldId,
              name: 'Owner',
              options: { isMultiple: false },
            },
            { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
          ],
          records: foreignSeeds.map((seed) => ({
            fields: {
              [foreignNameFieldId]: seed.label,
              [foreignUserFieldId]: buildUserCellValue(seed.userIds, 'single', aliceCell, bobCell),
              [foreignAmountFieldId]: seed.amount,
            },
          })),
          views: [{ type: 'grid' }],
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('ConditionalUserOperatorHostSingle'),
          fields: [
            { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'user',
              id: hostUserFieldId,
              name: 'Reference Users',
              options: { isMultiple: hostMultiplicity === 'multiple' },
            },
          ],
          records: hostSeeds.map((seed) => ({
            fields: {
              [hostNameFieldId]: seed.label,
              [hostUserFieldId]: buildUserCellValue(
                seed.userIds,
                hostMultiplicity,
                aliceCell,
                bobCell
              ),
            },
          })),
          views: [{ type: 'grid' }],
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: lookupFieldId,
            name: `Tasks_${operator}`,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignNameFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignUserFieldId,
                      operator,
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
            id: rollupFieldId,
            name: `Amount_${operator}`,
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignUserFieldId,
                      operator,
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

        for (const hostSeed of hostSeeds) {
          const expectedForeignRecords = foreignSeeds.filter((seed) =>
            matchesUserOperator(operator, seed.userIds, hostSeed.userIds)
          );
          const expectedTitles = expectedForeignRecords.map((seed) => seed.label).sort();
          const expectedSum = expectedForeignRecords.reduce((sum, seed) => sum + seed.amount, 0);

          const hostFields = hostRecordsByLabel.get(hostSeed.label);
          expect(hostFields).toBeDefined();
          expect(normalizeLookupValues(hostFields?.[lookupFieldId])).toEqual(expectedTitles);
          const rollupValue = hostFields?.[rollupFieldId];
          expect(rollupValue == null ? 0 : Number(rollupValue)).toBe(expectedSum);
        }
      }
    );
  });

  describe('multiple user field operators', () => {
    const CASES: Array<{ hostMultiplicity: Multiplicity; operator: UserOperator }> = [
      { hostMultiplicity: 'single', operator: 'hasAnyOf' },
      { hostMultiplicity: 'single', operator: 'hasAllOf' },
      { hostMultiplicity: 'single', operator: 'isExactly' },
      { hostMultiplicity: 'single', operator: 'isNotExactly' },
      { hostMultiplicity: 'single', operator: 'hasNoneOf' },
      { hostMultiplicity: 'multiple', operator: 'hasAnyOf' },
      { hostMultiplicity: 'multiple', operator: 'hasAllOf' },
      { hostMultiplicity: 'multiple', operator: 'isExactly' },
      { hostMultiplicity: 'multiple', operator: 'isNotExactly' },
      { hostMultiplicity: 'multiple', operator: 'hasNoneOf' },
    ];

    test.each(CASES)(
      'foreign multiple x host $hostMultiplicity with $operator',
      async ({ hostMultiplicity, operator }) => {
        const aliceCell = { id: ctx.testUser.id, title: ctx.testUser.name };
        const bobCell = { id: 'usrConditionalUserOperatorsBob', title: 'Bob' };

        await sql`
          insert into users (id, name, email)
          values (${bobCell.id}, ${bobCell.title}, ${'bob+conditional-user-operators@e2e.com'})
          on conflict (id) do nothing
        `.execute(ctx.testContainer.db);

        const foreignNameFieldId = createFieldId();
        const foreignUserFieldId = createFieldId();
        const foreignAmountFieldId = createFieldId();
        const hostNameFieldId = createFieldId();
        const hostUserFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const rollupFieldId = createFieldId();

        const foreignSeeds = [
          { label: 'Task Alpha', amount: 10, userIds: [aliceCell.id] },
          { label: 'Task Beta', amount: 20, userIds: [aliceCell.id, bobCell.id] },
          { label: 'Task Gamma', amount: 30, userIds: [bobCell.id] },
        ];

        const hostSeeds =
          hostMultiplicity === 'single'
            ? [
                { label: 'Alice', userIds: [aliceCell.id] },
                { label: 'Bob', userIds: [bobCell.id] },
              ]
            : [
                { label: 'Alice', userIds: [aliceCell.id] },
                { label: 'Bob', userIds: [bobCell.id] },
                { label: 'Alice + Bob', userIds: [aliceCell.id, bobCell.id] },
              ];

        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('ConditionalUserOperatorForeignMulti'),
          fields: [
            { type: 'singleLineText', id: foreignNameFieldId, name: 'Task', isPrimary: true },
            {
              type: 'user',
              id: foreignUserFieldId,
              name: 'Assignees',
              options: { isMultiple: true },
            },
            { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
          ],
          records: foreignSeeds.map((seed) => ({
            fields: {
              [foreignNameFieldId]: seed.label,
              [foreignUserFieldId]: buildUserCellValue(
                seed.userIds,
                'multiple',
                aliceCell,
                bobCell
              ),
              [foreignAmountFieldId]: seed.amount,
            },
          })),
          views: [{ type: 'grid' }],
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: uniqueName('ConditionalUserOperatorHostMulti'),
          fields: [
            { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
            {
              type: 'user',
              id: hostUserFieldId,
              name: 'Reference Users',
              options: { isMultiple: hostMultiplicity === 'multiple' },
            },
          ],
          records: hostSeeds.map((seed) => ({
            fields: {
              [hostNameFieldId]: seed.label,
              [hostUserFieldId]: buildUserCellValue(
                seed.userIds,
                hostMultiplicity,
                aliceCell,
                bobCell
              ),
            },
          })),
          views: [{ type: 'grid' }],
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: lookupFieldId,
            name: `Tasks_${operator}`,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignNameFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignUserFieldId,
                      operator,
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
            id: rollupFieldId,
            name: `Amount_${operator}`,
            options: { expression: 'sum({values})' },
            config: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignAmountFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [
                    {
                      fieldId: foreignUserFieldId,
                      operator,
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

        for (const hostSeed of hostSeeds) {
          const expectedForeignRecords = foreignSeeds.filter((seed) =>
            matchesUserOperator(operator, seed.userIds, hostSeed.userIds)
          );
          const expectedTitles = expectedForeignRecords.map((seed) => seed.label).sort();
          const expectedSum = expectedForeignRecords.reduce((sum, seed) => sum + seed.amount, 0);

          const hostFields = hostRecordsByLabel.get(hostSeed.label);
          expect(hostFields).toBeDefined();
          expect(normalizeLookupValues(hostFields?.[lookupFieldId])).toEqual(expectedTitles);
          const rollupValue = hostFields?.[rollupFieldId];
          expect(rollupValue == null ? 0 : Number(rollupValue)).toBe(expectedSum);
        }
      }
    );
  });
});

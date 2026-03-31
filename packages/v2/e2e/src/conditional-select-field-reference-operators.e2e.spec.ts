/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type SingleSelectOperator = 'is' | 'isNot' | 'isAnyOf' | 'isNoneOf';
type MultipleSelectOperator = 'hasAnyOf' | 'hasAllOf' | 'isExactly' | 'isNotExactly' | 'hasNoneOf';

const CHOICES = [
  { id: 'Alpha', name: 'Alpha', color: 'blue' },
  { id: 'Beta', name: 'Beta', color: 'green' },
  { id: 'Gamma', name: 'Gamma', color: 'red' },
] as const;

const normalizeLookupValues = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) return [String(value)];
  return value.map((entry) => String(entry)).sort();
};

const normalizeSet = (values: string[]) => [...values].sort();

const hasExactSet = (left: string[], right: string[]) => {
  const normalizedLeft = normalizeSet(left);
  const normalizedRight = normalizeSet(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
};

const matchesSingleSelectOperator = (
  operator: SingleSelectOperator,
  leftValue: string,
  rightValues: string[]
) => {
  switch (operator) {
    case 'is':
      return leftValue === rightValues[0];
    case 'isNot':
      return leftValue !== rightValues[0];
    case 'isAnyOf':
      return rightValues.includes(leftValue);
    case 'isNoneOf':
      return !rightValues.includes(leftValue);
  }
};

const matchesMultipleSelectOperator = (
  operator: MultipleSelectOperator,
  leftValues: string[],
  rightValues: string[]
) => {
  switch (operator) {
    case 'hasAnyOf':
      return rightValues.some((value) => leftValues.includes(value));
    case 'hasAllOf':
      return rightValues.every((value) => leftValues.includes(value));
    case 'isExactly':
      return hasExactSet(leftValues, rightValues);
    case 'isNotExactly':
      return !hasExactSet(leftValues, rightValues);
    case 'hasNoneOf':
      return rightValues.every((value) => !leftValues.includes(value));
  }
};

describe('v2 conditional select field reference operators (e2e)', () => {
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

  describe('singleSelect field-reference operators', () => {
    const CASES: Array<{ operator: SingleSelectOperator }> = [
      { operator: 'is' },
      { operator: 'isNot' },
      { operator: 'isAnyOf' },
      { operator: 'isNoneOf' },
    ];

    test.each(CASES)('singleSelect x singleSelect with $operator', async ({ operator }) => {
      const foreignNameFieldId = createFieldId();
      const foreignSelectFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostSelectFieldId = createFieldId();
      const lookupFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      const foreignSeeds = [
        { label: 'Task Alpha', amount: 10, value: 'Alpha' },
        { label: 'Task Beta', amount: 20, value: 'Alpha' },
        { label: 'Task Gamma', amount: 30, value: 'Beta' },
      ];

      const hostSeeds = [
        { label: 'Host Alpha', values: ['Alpha'] },
        { label: 'Host Beta', values: ['Beta'] },
        { label: 'Host Gamma', values: ['Gamma'] },
      ];

      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalSelectOperatorForeignSingle'),
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Task', isPrimary: true },
          {
            type: 'singleSelect',
            id: foreignSelectFieldId,
            name: 'Tier',
            options: { choices: [...CHOICES] },
          },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        records: foreignSeeds.map((seed) => ({
          fields: {
            [foreignNameFieldId]: seed.label,
            [foreignSelectFieldId]: seed.value,
            [foreignAmountFieldId]: seed.amount,
          },
        })),
        views: [{ type: 'grid' }],
      });

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalSelectOperatorHostSingle'),
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: hostSelectFieldId,
            name: 'Reference Tier',
            options: { choices: [...CHOICES] },
          },
        ],
        records: hostSeeds.map((seed) => ({
          fields: {
            [hostNameFieldId]: seed.label,
            [hostSelectFieldId]: seed.values[0],
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
                    fieldId: foreignSelectFieldId,
                    operator,
                    value: hostSelectFieldId,
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
                    fieldId: foreignSelectFieldId,
                    operator,
                    value: hostSelectFieldId,
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
          matchesSingleSelectOperator(operator, seed.value, hostSeed.values)
        );
        const expectedTitles = expectedForeignRecords.map((seed) => seed.label).sort();
        const expectedSum = expectedForeignRecords.reduce((sum, seed) => sum + seed.amount, 0);

        const hostFields = hostRecordsByLabel.get(hostSeed.label);
        expect(hostFields).toBeDefined();
        expect(normalizeLookupValues(hostFields?.[lookupFieldId])).toEqual(expectedTitles);
        const rollupValue = hostFields?.[rollupFieldId];
        expect(rollupValue == null ? 0 : Number(rollupValue)).toBe(expectedSum);
      }
    });
  });

  describe('multipleSelect field-reference operators', () => {
    const CASES: Array<{ operator: MultipleSelectOperator }> = [
      { operator: 'hasAnyOf' },
      { operator: 'hasAllOf' },
      { operator: 'isExactly' },
      { operator: 'isNotExactly' },
      { operator: 'hasNoneOf' },
    ];

    test.each(CASES)('multipleSelect x multipleSelect with $operator', async ({ operator }) => {
      const foreignNameFieldId = createFieldId();
      const foreignSelectFieldId = createFieldId();
      const foreignAmountFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const hostSelectFieldId = createFieldId();
      const lookupFieldId = createFieldId();
      const rollupFieldId = createFieldId();

      const foreignSeeds = [
        { label: 'Task Alpha', amount: 10, values: ['Alpha'] },
        { label: 'Task Beta', amount: 20, values: ['Alpha', 'Beta'] },
        { label: 'Task Gamma', amount: 30, values: ['Beta'] },
      ];

      const hostSeeds = [
        { label: 'Host Alpha', values: ['Alpha'] },
        { label: 'Host Beta', values: ['Beta'] },
        { label: 'Host Alpha + Beta', values: ['Alpha', 'Beta'] },
        { label: 'Host Gamma', values: ['Gamma'] },
      ];

      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalSelectOperatorForeignMulti'),
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Task', isPrimary: true },
          {
            type: 'multipleSelect',
            id: foreignSelectFieldId,
            name: 'Tags',
            options: { choices: [...CHOICES] },
          },
          { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
        ],
        records: foreignSeeds.map((seed) => ({
          fields: {
            [foreignNameFieldId]: seed.label,
            [foreignSelectFieldId]: seed.values,
            [foreignAmountFieldId]: seed.amount,
          },
        })),
        views: [{ type: 'grid' }],
      });

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: uniqueName('ConditionalSelectOperatorHostMulti'),
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'multipleSelect',
            id: hostSelectFieldId,
            name: 'Reference Tags',
            options: { choices: [...CHOICES] },
          },
        ],
        records: hostSeeds.map((seed) => ({
          fields: {
            [hostNameFieldId]: seed.label,
            [hostSelectFieldId]: seed.values,
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
                    fieldId: foreignSelectFieldId,
                    operator,
                    value: hostSelectFieldId,
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
                    fieldId: foreignSelectFieldId,
                    operator,
                    value: hostSelectFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(host.id);
      const hostRecordsByLabel = new Map(
        hostRecords.map((record) => [String(record.fields[hostNameFieldId]), record.fields])
      );

      for (const hostSeed of hostSeeds) {
        const expectedForeignRecords = foreignSeeds.filter((seed) =>
          matchesMultipleSelectOperator(operator, seed.values, hostSeed.values)
        );
        const expectedTitles = expectedForeignRecords.map((seed) => seed.label).sort();
        const expectedSum = expectedForeignRecords.reduce((sum, seed) => sum + seed.amount, 0);

        const hostFields = hostRecordsByLabel.get(hostSeed.label);
        expect(hostFields).toBeDefined();
        expect(normalizeLookupValues(hostFields?.[lookupFieldId])).toEqual(expectedTitles);
        const rollupValue = hostFields?.[rollupFieldId];
        expect(rollupValue == null ? 0 : Number(rollupValue)).toBe(expectedSum);
      }
    });
  });
});

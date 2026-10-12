import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

// T7513: neutral scalar source -> two-way manyMany lookup -> parent aggregation.
// Compare singleton lookups with identically scoped scalar fields before exercising
// multi-element lookups, shared-source edits, reassignment, and unlinking.
describe('rollup lookup values (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;
  const runId = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const createFieldId = () => `fld${runId}${(fieldIdCounter++).toString(36).padStart(10, '0')}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  test.each(['rollup', 'conditionalRollup'] as const)(
    '%s flattens lookup leaves and preserves native array values through updates',
    { timeout: 180_000 },
    async (type) => {
      const tableIds: string[] = [];
      const sourceName = createFieldId();
      const sourceText = createFieldId();
      const sourceNumber = createFieldId();
      const sourceBoolean = createFieldId();
      const childName = createFieldId();
      const childKey = createFieldId();
      const flagA = createFieldId();
      const flagB = createFieldId();
      const sourceLink = createFieldId();
      const parentKey = createFieldId();
      const childLink = createFieldId();
      const columns = [
        { key: 'text', cellValueType: 'string', source: sourceText },
        { key: 'number', cellValueType: 'number', source: sourceNumber },
        { key: 'boolean', cellValueType: 'boolean', source: sourceBoolean },
      ].map((column) => ({ ...column, lookup: createFieldId(), scalar: createFieldId() }));
      const textColumn = columns[0]!;
      const numberColumn = columns[1]!;
      const booleanColumn = columns[2]!;
      const specs = [
        { name: 'text join', column: textColumn, expression: 'array_join({values})' },
        { name: 'text concatenate', column: textColumn, expression: 'concatenate({values})' },
        { name: 'number unique', column: numberColumn, expression: 'array_unique({values})' },
        { name: 'number compact', column: numberColumn, expression: 'array_compact({values})' },
        { name: 'boolean unique', column: booleanColumn, expression: 'array_unique({values})' },
        { name: 'boolean compact', column: booleanColumn, expression: 'array_compact({values})' },
      ].map((spec) => ({ ...spec, lookupResult: createFieldId(), scalarResult: createFieldId() }));
      const sumId = createFieldId();

      try {
        const source = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Lookup leaves ${type} ${runId}`,
          fields: [
            { type: 'singleLineText', id: sourceName, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: sourceText, name: 'Label' },
            {
              type: 'number',
              id: sourceNumber,
              name: 'Amount',
              options: { formatting: { type: 'decimal', precision: 2 } },
            },
            { type: 'checkbox', id: sourceBoolean, name: 'Checked' },
          ],
        });
        tableIds.push(source.id);
        const child = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Lookup branches ${type} ${runId}`,
          fields: [
            { type: 'singleLineText', id: childName, name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: childKey, name: 'Group' },
            { type: 'checkbox', id: flagA, name: 'Include A' },
            { type: 'checkbox', id: flagB, name: 'Include B' },
            { type: 'singleLineText', id: textColumn.scalar, name: 'Scalar label' },
            { type: 'number', id: numberColumn.scalar, name: 'Scalar amount' },
            { type: 'checkbox', id: booleanColumn.scalar, name: 'Scalar checked' },
            {
              type: 'link',
              id: sourceLink,
              name: 'Leaves',
              options: {
                relationship: 'manyMany',
                foreignTableId: source.id,
                lookupFieldId: sourceName,
                isOneWay: false,
              },
            },
            ...columns.map((column) => ({
              type: 'lookup' as const,
              id: column.lookup,
              name: `Lookup ${column.key}`,
              options: {
                linkFieldId: sourceLink,
                foreignTableId: source.id,
                lookupFieldId: column.source,
              },
            })),
          ],
        });
        tableIds.push(child.id);
        const parent = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Lookup summary ${type} ${runId}`,
          fields: [
            { type: 'singleLineText', id: parentKey, name: 'Group', isPrimary: true },
            {
              type: 'link',
              id: childLink,
              name: 'Branches',
              options: {
                relationship: 'manyMany',
                foreignTableId: child.id,
                lookupFieldId: childName,
                isOneWay: false,
              },
            },
          ],
        });
        tableIds.push(parent.id);
        const condition = {
          filter: {
            conjunction: 'and' as const,
            filterSet: [
              { fieldId: childKey, operator: 'is', value: parentKey, isSymbol: true },
              {
                conjunction: 'or' as const,
                filterSet: [
                  { fieldId: flagA, operator: 'is', value: true },
                  { fieldId: flagB, operator: 'is', value: true },
                ],
              },
            ],
          },
          sort: { fieldId: childName, order: 'asc' as const },
        };
        const aggregates = specs.flatMap((spec) => [
          {
            id: spec.lookupResult,
            name: spec.name,
            expression: spec.expression,
            source: spec.column.lookup,
          },
          {
            id: spec.scalarResult,
            name: `Scalar ${spec.name}`,
            expression: spec.expression,
            source: spec.column.scalar,
          },
        ]);
        aggregates.push({
          id: sumId,
          name: 'Lookup sum',
          expression: 'sum({values})',
          source: numberColumn.lookup,
        });
        for (const aggregate of aggregates) {
          const common = {
            id: aggregate.id,
            name: aggregate.name,
            options: { expression: aggregate.expression },
          };
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: parent.id,
            field:
              type === 'rollup'
                ? {
                    ...common,
                    type,
                    config: {
                      foreignTableId: child.id,
                      lookupFieldId: aggregate.source,
                      linkFieldId: childLink,
                    },
                  }
                : {
                    ...common,
                    type,
                    config: {
                      foreignTableId: child.id,
                      lookupFieldId: aggregate.source,
                      condition,
                    },
                  },
          });
        }

        const createLeaf = (
          name: string,
          text: string | null,
          number: number | null,
          checked: boolean | null
        ) =>
          ctx.createRecord(source.id, {
            [sourceName]: name,
            [sourceText]: text,
            [sourceNumber]: number,
            [sourceBoolean]: checked,
          });
        const amber = await createLeaf('Leaf one', 'Amber', 2.25, true);
        const birch = await createLeaf('Leaf two', 'Birch', 0, false);
        const cedar = await createLeaf('Leaf three', 'Cedar', 4.5, true);
        const blank = await createLeaf('Blank leaf', '', null, null);
        const absent = await createLeaf('Null leaf', null, null, null);
        const createBranch = (
          name: string,
          leafId: string,
          text: string | null,
          number: number | null,
          checked: boolean | null,
          key = 'Included',
          includeA = true,
          includeB = false
        ) =>
          ctx.createRecord(child.id, {
            [childName]: name,
            [childKey]: key,
            [flagA]: includeA,
            [flagB]: includeB,
            [sourceLink]: [{ id: leafId }],
            [textColumn.scalar]: text,
            [numberColumn.scalar]: number,
            [booleanColumn.scalar]: checked,
          });
        const first = await createBranch('01 first', amber.id, 'Amber', 2.25, true);
        const second = await createBranch(
          '02 second',
          birch.id,
          'Birch',
          0,
          false,
          'Included',
          false,
          true
        );
        const duplicate = await createBranch(
          '03 duplicate',
          amber.id,
          'Amber',
          2.25,
          true,
          'Included',
          true,
          true
        );
        // These distinguish the nested OR from both a flattened OR and an AND.
        await createBranch('90 wrong group', cedar.id, 'Cedar', 4.5, true, 'Other', false, true);
        await createBranch('91 excluded', cedar.id, 'Cedar', 4.5, true, 'Included', false, false);
        const included = await ctx.createRecord(parent.id, {
          [parentKey]: 'Included',
          [childLink]: [{ id: first.id }, { id: second.id }, { id: duplicate.id }],
        });
        const noMatch = await ctx.createRecord(parent.id, { [parentKey]: 'No match' });

        const readParent = async (id: string) => {
          await ctx.drainOutbox();
          const record = (await ctx.listRecords(parent.id)).find((row) => row.id === id);
          if (!record) throw new Error(`Missing summary record ${id}`);
          return record.fields;
        };
        const assertValues = async (stage: string, expected: unknown[], sum: number) => {
          const fields = await readParent(included.id);
          for (const [index, spec] of specs.entries()) {
            expect
              .soft(fields[spec.lookupResult], `${type}: ${stage}: ${spec.name}`)
              .toEqual(expected[index]);
          }
          expect.soft(fields[sumId], `${type}: ${stage}: nested OR sum`).toBe(sum);
          return fields;
        };
        const assertScalarParity = (fields: Record<string, unknown>, stage: string) => {
          for (const spec of specs) {
            expect
              .soft(fields[spec.lookupResult], `${type}: ${stage}: scalar parity ${spec.name}`)
              .toEqual(fields[spec.scalarResult]);
          }
        };

        const childMeta = await ctx.getTableById(child.id);
        for (const column of columns) {
          expect(childMeta.fields.find((field) => field.id === column.lookup)).toMatchObject({
            cellValueType: column.cellValueType,
            isMultipleCellValue: true,
            dbFieldType: 'JSON',
          });
        }
        const parentMeta = await ctx.getTableById(parent.id);
        for (const spec of specs) {
          const field = parentMeta.fields.find((candidate) => candidate.id === spec.lookupResult);
          expect.soft(field?.cellValueType, spec.name).toBe(spec.column.cellValueType);
          expect
            .soft(Boolean(field?.isMultipleCellValue), spec.name)
            .toBe(spec.column.key !== 'text');
        }
        // Checkbox false and blank text normalize to null on write; zero does not.
        const sourceRows = await ctx.listRecords(source.id);
        expect(
          sourceRows.find((row) => row.id === birch.id)?.fields[sourceBoolean] ?? null
        ).toBeNull();
        expect(sourceRows.find((row) => row.id === birch.id)?.fields[sourceNumber]).toBe(0);
        expect(
          sourceRows.find((row) => row.id === blank.id)?.fields[sourceText] ?? null
        ).toBeNull();
        const singleton = await assertValues(
          'singleton',
          [
            'Amber, Birch, Amber',
            'Amber, Birch, Amber',
            [2.25, 0],
            [2.25, 0, 2.25],
            [true],
            [true, true],
          ],
          4.5
        );
        assertScalarParity(singleton, 'singleton');
        const isolatedBefore = await readParent(noMatch.id);
        expect.soft(isolatedBefore[sumId]).toBe(0);

        await ctx.updateRecord(child.id, second.id, {
          [sourceLink]: [{ id: birch.id }, { id: cedar.id }],
        });
        await assertValues(
          'multiple leaves',
          [
            'Amber, Birch, Cedar, Amber',
            'Amber, Birch, Cedar, Amber',
            [2.25, 0, 4.5],
            [2.25, 0, 4.5, 2.25],
            [true],
            [true, true, true],
          ],
          9
        );

        await ctx.updateRecord(source.id, amber.id, {
          [sourceText]: 'Apricot',
          [sourceNumber]: 3.75,
          [sourceBoolean]: false,
        });
        await assertValues(
          'shared source edit',
          [
            'Apricot, Birch, Cedar, Apricot',
            'Apricot, Birch, Cedar, Apricot',
            [3.75, 0, 4.5],
            [3.75, 0, 4.5, 3.75],
            [true],
            [true],
          ],
          12
        );

        await ctx.updateRecord(child.id, first.id, { [sourceLink]: [{ id: cedar.id }] });
        await assertValues(
          'reassigned source',
          [
            'Cedar, Birch, Cedar, Apricot',
            'Cedar, Birch, Cedar, Apricot',
            [4.5, 0, 3.75],
            [4.5, 0, 4.5, 3.75],
            [true],
            [true, true],
          ],
          12.75
        );
        await ctx.updateRecord(child.id, duplicate.id, { [sourceLink]: null });
        await assertValues(
          'unlinked source',
          [
            'Cedar, Birch, Cedar',
            'Cedar, Birch, Cedar',
            [4.5, 0],
            [4.5, 0, 4.5],
            [true],
            [true, true],
          ],
          9
        );

        // Restore singleton scope, including empty source values, so direct scalar
        // aggregates define the established blank/null behavior without guessing it.
        await ctx.updateRecord(child.id, first.id, {
          [textColumn.scalar]: 'Cedar',
          [numberColumn.scalar]: 4.5,
          [booleanColumn.scalar]: true,
        });
        await ctx.updateRecord(child.id, second.id, { [sourceLink]: [{ id: birch.id }] });
        await ctx.updateRecord(child.id, duplicate.id, {
          [textColumn.scalar]: null,
          [numberColumn.scalar]: null,
          [booleanColumn.scalar]: null,
        });
        const blankBranch = await createBranch('04 blank', blank.id, '', null, null);
        const nullBranch = await createBranch('05 null', absent.id, null, null, null);
        await ctx.updateRecord(parent.id, included.id, {
          [childLink]: [first, second, duplicate, blankBranch, nullBranch].map((row) => ({
            id: row.id,
          })),
        });
        const withEmpties = await readParent(included.id);
        assertScalarParity(withEmpties, 'blank and null sources');
        expect.soft(withEmpties[specs[2]!.lookupResult]).toEqual([4.5, 0]);
        expect.soft(withEmpties[specs[3]!.lookupResult]).toEqual([4.5, 0]);
        expect.soft(withEmpties[specs[4]!.lookupResult]).toEqual([true]);
        expect.soft(withEmpties[specs[5]!.lookupResult]).toEqual([true]);
        expect.soft(withEmpties[sumId]).toBe(4.5);
        const isolatedAfter = await readParent(noMatch.id);
        for (const aggregate of aggregates) {
          expect
            .soft(isolatedAfter[aggregate.id], `no-match isolation: ${aggregate.name}`)
            .toEqual(isolatedBefore[aggregate.id]);
        }
      } finally {
        for (const tableId of tableIds.reverse()) {
          await ctx.deleteTable(tableId).catch(() => undefined);
        }
      }
    }
  );
});

/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized, structure-equivalent coverage for T7066.
 *
 * Retained structure:
 * - two-way oneMany parent → child link
 * - child scalar singleSelect source (Todo, then Done)
 * - existing parent rollups: array_join / array_unique / array_compact
 * - API creates children first, then parent, then patches both links
 * - first persisted unique must follow link first-appearance order
 *
 * No customer identifiers or record values.
 */
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 rollup ARRAYUNIQUE first-appearance order on API create (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  const setupRollupTables = async () => {
    const childNameFieldId = createFieldId();
    const childStatusFieldId = createFieldId();
    const parentNameFieldId = createFieldId();
    const parentLinkFieldId = createFieldId();
    const joinFieldId = createFieldId();
    const uniqueFieldId = createFieldId();
    const compactFieldId = createFieldId();

    const childTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Unique Order Child',
      fields: [
        {
          type: 'singleLineText',
          id: childNameFieldId,
          name: 'Name',
          isPrimary: true,
        },
        {
          type: 'singleSelect',
          id: childStatusFieldId,
          name: 'Status',
          options: {
            choices: [
              { name: 'Todo', color: 'blue' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
      ],
    });

    const parentTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rollup Unique Order Parent',
      fields: [
        {
          type: 'singleLineText',
          id: parentNameFieldId,
          name: 'Name',
          isPrimary: true,
        },
      ],
    });

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: parentTable.id,
      field: {
        type: 'link',
        id: parentLinkFieldId,
        name: 'Children',
        options: {
          relationship: 'oneMany',
          foreignTableId: childTable.id,
          lookupFieldId: childNameFieldId,
        },
      },
    });

    for (const spec of [
      { id: joinFieldId, expression: 'array_join({values})', name: 'Status Join' },
      { id: uniqueFieldId, expression: 'array_unique({values})', name: 'Status Unique' },
      { id: compactFieldId, expression: 'array_compact({values})', name: 'Status Compact' },
    ] as const) {
      await ctx.createField({
        baseId: ctx.baseId,
        tableId: parentTable.id,
        field: {
          type: 'rollup',
          id: spec.id,
          name: spec.name,
          options: { expression: spec.expression },
          config: {
            linkFieldId: parentLinkFieldId,
            foreignTableId: childTable.id,
            lookupFieldId: childStatusFieldId,
          },
        },
      });
    }

    return {
      childTable,
      parentTable,
      childNameFieldId,
      childStatusFieldId,
      parentNameFieldId,
      parentLinkFieldId,
      joinFieldId,
      uniqueFieldId,
      compactFieldId,
    };
  };

  const expectTodoThenDone = (
    fields: Record<string, unknown> | undefined,
    joinFieldId: string,
    uniqueFieldId: string,
    compactFieldId: string
  ) => {
    expect(fields?.[joinFieldId]).toBe('Todo, Done');
    expect(fields?.[compactFieldId]).toEqual(['Todo', 'Done']);
    expect(fields?.[uniqueFieldId]).toEqual(['Todo', 'Done']);
  };

  const expectPersistedTodoThenDone = async (params: {
    parentTableId: string;
    parentRecordId: string;
    joinFieldId: string;
    uniqueFieldId: string;
    compactFieldId: string;
  }) => {
    const immediate = (await ctx.listRecordsWithoutDrain(params.parentTableId)).find(
      (record) => record.id === params.parentRecordId
    );
    expectTodoThenDone(
      immediate?.fields,
      params.joinFieldId,
      params.uniqueFieldId,
      params.compactFieldId
    );

    await ctx.drainOutbox();
    const parentRecord = (await ctx.listRecords(params.parentTableId)).find(
      (record) => record.id === params.parentRecordId
    );
    expectTodoThenDone(
      parentRecord?.fields,
      params.joinFieldId,
      params.uniqueFieldId,
      params.compactFieldId
    );
  };

  test('keeps Todo before Done when API creates parent then patches both links', async () => {
    const schema = await setupRollupTables();
    try {
      const childTodo = await ctx.createRecord(schema.childTable.id, {
        [schema.childNameFieldId]: 'C1',
        [schema.childStatusFieldId]: 'Todo',
      });
      const childDone = await ctx.createRecord(schema.childTable.id, {
        [schema.childNameFieldId]: 'C2',
        [schema.childStatusFieldId]: 'Done',
      });

      const parent = await ctx.createRecord(schema.parentTable.id, {
        [schema.parentNameFieldId]: 'P',
      });
      const updated = await ctx.updateRecord(schema.parentTable.id, parent.id, {
        [schema.parentLinkFieldId]: [{ id: childTodo.id }, { id: childDone.id }],
      });
      expectTodoThenDone(
        updated.fields,
        schema.joinFieldId,
        schema.uniqueFieldId,
        schema.compactFieldId
      );

      await expectPersistedTodoThenDone({
        parentTableId: schema.parentTable.id,
        parentRecordId: parent.id,
        joinFieldId: schema.joinFieldId,
        uniqueFieldId: schema.uniqueFieldId,
        compactFieldId: schema.compactFieldId,
      });
    } finally {
      await ctx.deleteTable(schema.parentTable.id).catch(() => undefined);
      await ctx.deleteTable(schema.childTable.id).catch(() => undefined);
    }
  });

  test('keeps Todo before Done when API creates parent with both links in one request', async () => {
    const schema = await setupRollupTables();
    try {
      const childTodo = await ctx.createRecord(schema.childTable.id, {
        [schema.childNameFieldId]: 'C1',
        [schema.childStatusFieldId]: 'Todo',
      });
      const childDone = await ctx.createRecord(schema.childTable.id, {
        [schema.childNameFieldId]: 'C2',
        [schema.childStatusFieldId]: 'Done',
      });

      const parent = await ctx.createRecord(schema.parentTable.id, {
        [schema.parentNameFieldId]: 'P',
        [schema.parentLinkFieldId]: [{ id: childTodo.id }, { id: childDone.id }],
      });
      expectTodoThenDone(
        parent.fields,
        schema.joinFieldId,
        schema.uniqueFieldId,
        schema.compactFieldId
      );

      await expectPersistedTodoThenDone({
        parentTableId: schema.parentTable.id,
        parentRecordId: parent.id,
        joinFieldId: schema.joinFieldId,
        uniqueFieldId: schema.uniqueFieldId,
        compactFieldId: schema.compactFieldId,
      });
    } finally {
      await ctx.deleteTable(schema.parentTable.id).catch(() => undefined);
      await ctx.deleteTable(schema.childTable.id).catch(() => undefined);
    }
  });
});

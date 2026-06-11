/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  deleteFieldOkResponseSchema,
  type ITableDto,
} from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http deleteField (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    const primaryField = table.fields.find((field) => field.isPrimary);
    if (!primaryField) throw new Error('Missing primary field');

    return { tableId: table.id, primaryFieldId: primaryField.id };
  };

  const sortedFieldIds = (fields: ITableDto['fields']) => fields.map((field) => field.id).sort();

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('deletes a field and returns FieldDeleted events', async () => {
    const { tableId } = await createTable('Delete Field');
    const fieldId = createFieldId();

    const createFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          id: fieldId,
          name: 'Status',
        },
      }),
    });

    expect(createFieldResponse.status).toBe(200);
    const createFieldRaw = await createFieldResponse.json();
    const createFieldParsed = createFieldOkResponseSchema.safeParse(createFieldRaw);
    expect(createFieldParsed.success).toBe(true);
    if (!createFieldParsed.success || !createFieldParsed.data.ok) return;

    const deleteResponse = await fetch(`${ctx.baseUrl}/tables/deleteField`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        fieldId,
      }),
    });

    expect(deleteResponse.status).toBe(200);
    const rawBody = await deleteResponse.json();
    const parsed = deleteFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const body = parsed.data;
    expect(body.data.table.fields.some((field) => field.id === fieldId)).toBe(false);
    expect(body.data.events.some((event) => event.name === 'FieldDeleted')).toBe(true);

    const refreshed = await ctx.getTableById(tableId);
    expect(refreshed.fields.some((field) => field.id === fieldId)).toBe(false);
  });

  it('removes symmetric link fields when deleting links', async () => {
    const host = await createTable('Host');
    const foreign = await createTable('Foreign');
    const linkFieldId = createFieldId();

    const createdTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: host.tableId,
      field: {
        type: 'link',
        id: linkFieldId,
        name: 'Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: foreign.tableId,
          lookupFieldId: foreign.primaryFieldId,
        },
      },
    });

    const linkField = createdTable.fields.find((field) => field.id === linkFieldId);
    expect(linkField?.type).toBe('link');
    if (!linkField || linkField.type !== 'link') return;

    const symmetricFieldId = linkField.options.symmetricFieldId;
    expect(symmetricFieldId).toBeTruthy();
    if (!symmetricFieldId) return;

    const foreignBefore = await ctx.getTableById(foreign.tableId);
    expect(foreignBefore.fields.some((field) => field.id === symmetricFieldId)).toBe(true);

    await ctx.deleteField({ tableId: host.tableId, fieldId: linkFieldId });

    const foreignAfter = await ctx.getTableById(foreign.tableId);
    expect(foreignAfter.fields.some((field) => field.id === symmetricFieldId)).toBe(false);
  });

  describe('link fields', () => {
    const relationshipCases = [
      { relationship: 'oneOne', symmetricRelationship: 'oneOne' },
      { relationship: 'manyMany', symmetricRelationship: 'manyMany' },
      { relationship: 'oneMany', symmetricRelationship: 'manyOne' },
      { relationship: 'manyOne', symmetricRelationship: 'oneMany' },
    ] as const;

    const directionCases = [
      { isOneWay: false, direction: 'two-way', expectSymmetric: true },
      { isOneWay: true, direction: 'one-way', expectSymmetric: false },
    ] as const;

    const targetCases = [{ target: 'foreign' }, { target: 'self' }] as const;

    const linkCases = targetCases.flatMap((targetCase) =>
      directionCases.flatMap((directionCase) =>
        relationshipCases.map((relationshipCase) => ({
          ...relationshipCase,
          ...directionCase,
          target: targetCase.target,
          caseLabel: `${targetCase.target}-${directionCase.direction}-${relationshipCase.relationship}`,
        }))
      )
    );

    it.each(linkCases)('deletes link fields for $caseLabel', async (entry) => {
      const host = await createTable(`Delete Link Host ${entry.caseLabel}`);
      const foreign =
        entry.target === 'self'
          ? host
          : await createTable(`Delete Link Foreign ${entry.caseLabel}`);
      const linkFieldId = createFieldId();
      const foreignTableId = entry.target === 'self' ? host.tableId : foreign.tableId;
      const lookupFieldId = entry.target === 'self' ? host.primaryFieldId : foreign.primaryFieldId;

      const hostTable = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.tableId,
        field: {
          type: 'link',
          id: linkFieldId,
          name: `Link ${entry.caseLabel} ${linkFieldId}`,
          options: {
            relationship: entry.relationship,
            foreignTableId,
            lookupFieldId,
            isOneWay: entry.isOneWay,
          },
        },
      });

      const linkField = hostTable.fields.find((field) => field.id === linkFieldId);
      expect(linkField?.type).toBe('link');
      if (!linkField || linkField.type !== 'link') return;
      expect(linkField.options.relationship).toBe(entry.relationship);
      expect(linkField.options.foreignTableId).toBe(foreignTableId);
      expect(linkField.options.lookupFieldId).toBe(lookupFieldId);
      expect(linkField.options.isOneWay ?? false).toBe(entry.isOneWay);

      const hostBefore = await ctx.getTableById(host.tableId);
      const targetBefore =
        entry.target === 'self' ? hostBefore : await ctx.getTableById(foreign.tableId);
      const symmetricLinksBefore = targetBefore.fields.filter(
        (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
      );

      if (entry.expectSymmetric) {
        expect(symmetricLinksBefore).toHaveLength(1);
      } else {
        expect(symmetricLinksBefore).toHaveLength(0);
      }

      const symmetricFieldId = symmetricLinksBefore[0]?.id;
      await ctx.deleteField({ tableId: host.tableId, fieldId: linkFieldId });

      const hostAfter = await ctx.getTableById(host.tableId);
      const targetAfter =
        entry.target === 'self' ? hostAfter : await ctx.getTableById(foreign.tableId);
      const removedFieldIds = new Set([linkFieldId]);
      if (symmetricFieldId) removedFieldIds.add(symmetricFieldId);

      const expectedHostAfterIds = sortedFieldIds(hostBefore.fields).filter(
        (fieldId) => !removedFieldIds.has(fieldId)
      );
      const expectedTargetAfterIds = sortedFieldIds(targetBefore.fields).filter(
        (fieldId) => !removedFieldIds.has(fieldId)
      );

      expect(sortedFieldIds(hostAfter.fields)).toEqual(expectedHostAfterIds);
      expect(sortedFieldIds(targetAfter.fields)).toEqual(expectedTargetAfterIds);
      expect(hostAfter.fields.some((field) => field.id === host.primaryFieldId)).toBe(true);
      if (entry.target === 'foreign') {
        expect(targetAfter.fields.some((field) => field.id === foreign.primaryFieldId)).toBe(true);
      }
    });
  });

  describe('[V1 PARITY] delete field coverage backlog', () => {
    type LegacyFilterItem = {
      fieldId: string;
      operator: string;
      value?: unknown;
    };

    type LegacyFilterGroup = {
      conjunction: 'and' | 'or';
      filterSet: Array<LegacyFilterItem | LegacyFilterGroup>;
    };

    type LegacySortPayload = {
      sortObjs: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
      manualSort?: boolean;
    };

    const parseJson = <T>(raw: string | null): T | null => {
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    };

    const countReferenceRowsFrom = async (fieldId: string): Promise<number> => {
      const result = await sql<{ count: string | number }>`
        SELECT COUNT(*)::int AS count
        FROM "reference"
        WHERE from_field_id = ${fieldId}
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0);
    };

    const countReferenceRowsTo = async (fieldId: string): Promise<number> => {
      const result = await sql<{ count: string | number }>`
        SELECT COUNT(*)::int AS count
        FROM "reference"
        WHERE to_field_id = ${fieldId}
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0);
    };

    const countReferenceRowsTouching = async (fieldId: string): Promise<number> => {
      const result = await sql<{ count: string | number }>`
        SELECT COUNT(*)::int AS count
        FROM "reference"
        WHERE from_field_id = ${fieldId} OR to_field_id = ${fieldId}
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0);
    };

    const hasColumnInBaseTable = async (tableId: string, columnName: string): Promise<boolean> => {
      const result = await sql<{ count: string | number }>`
        SELECT COUNT(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = ${ctx.baseId}
          AND table_name = ${tableId}
          AND column_name = ${columnName}
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0) > 0;
    };

    const hasTableInBase = async (tableName: string): Promise<boolean> => {
      const result = await sql<{ count: string | number }>`
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = ${ctx.baseId}
          AND table_name = ${tableName}
      `.execute(ctx.testContainer.db);
      return Number(result.rows[0]?.count ?? 0) > 0;
    };

    const findJunctionTableByFieldId = async (fieldId: string): Promise<string | undefined> => {
      const result = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${ctx.baseId}
          AND table_name LIKE ${`junction_${fieldId}%`}
      `.execute(ctx.testContainer.db);
      return result.rows[0]?.table_name;
    };

    const safeDeleteTable = async (tableId: string | undefined) => {
      if (!tableId) return;
      await ctx.deleteTable(tableId).catch(() => undefined);
    };

    const makeCondition = (fieldId: string, value: unknown) => ({
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId, operator: 'is', value }],
      },
    });

    const getFieldDbName = async (fieldId: string): Promise<string> => {
      const row = await ctx.testContainer.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', fieldId)
        .executeTakeFirst();
      const dbFieldName = row?.db_field_name;
      if (!dbFieldName) {
        throw new Error(`Missing db field name for field ${fieldId}`);
      }
      return dbFieldName;
    };

    const getStoredCellValue = async (
      tableId: string,
      recordId: string,
      dbFieldName: string
    ): Promise<unknown> => {
      const result = await sql<{ value: unknown }>`
        SELECT ${sql.ref(dbFieldName)} as value
        FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
        WHERE "__id" = ${recordId}
      `.execute(ctx.testContainer.db);
      return result.rows[0]?.value;
    };

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/share.e2e-spec.ts
     *   case: should clean link options after filtering field is deleted
     */
    it('[V1 PARITY] clears link filter and visible fields when referenced foreign field is deleted', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreignFilterFieldId = createFieldId();
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Link Filter Foreign',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: foreignFilterFieldId, name: 'Status' },
          ],
        });
        foreignTableId = foreign.id;
        const foreignPrimaryFieldId = foreign.fields.find((field) => field.isPrimary)?.id;
        if (!foreignPrimaryFieldId) throw new Error('Missing foreign primary field');

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Link Filter Host',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        });
        hostTableId = host.id;

        const linkFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: linkFieldId,
            name: 'Filtered Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignFilterFieldId, operator: 'is', value: 'x' }],
              },
              visibleFieldIds: [foreignFilterFieldId],
            },
          },
        });

        const beforeDelete = await ctx.getTableById(host.id);
        const linkFieldBefore = beforeDelete.fields.find((field) => field.id === linkFieldId);
        expect(linkFieldBefore?.type).toBe('link');
        if (!linkFieldBefore || linkFieldBefore.type !== 'link') return;
        expect(linkFieldBefore.options.filter).toEqual({
          conjunction: 'and',
          filterSet: [{ fieldId: foreignFilterFieldId, operator: 'is', value: 'x' }],
        });
        expect(linkFieldBefore.options.visibleFieldIds).toEqual([foreignFilterFieldId]);

        await ctx.deleteField({ tableId: foreign.id, fieldId: foreignFilterFieldId });
        await ctx.drainOutbox();

        const afterDelete = await ctx.getTableById(host.id);
        const linkFieldAfter = afterDelete.fields.find((field) => field.id === linkFieldId);
        expect(linkFieldAfter?.type).toBe('link');
        if (!linkFieldAfter || linkFieldAfter.type !== 'link') return;
        expect(linkFieldAfter.options.filter).toBeNull();
        expect(linkFieldAfter.options.visibleFieldIds).toBeNull();
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/conditional-lookup.e2e-spec.ts
     *   case: keeps only the limit after the sort field is deleted
     */
    it('[V1 PARITY] removes conditional lookup sort but preserves limit when sort field is deleted', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreignValueFieldId = createFieldId();
        const foreignSortFieldId = createFieldId();
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Conditional Sort Foreign',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: foreignValueFieldId, name: 'Value' },
            { type: 'number', id: foreignSortFieldId, name: 'Score' },
          ],
          records: [
            { fields: { Name: 'r1', [foreignValueFieldId]: 'alpha', [foreignSortFieldId]: 2 } },
            { fields: { Name: 'r2', [foreignValueFieldId]: 'beta', [foreignSortFieldId]: 1 } },
          ],
        });
        foreignTableId = foreign.id;

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Conditional Sort Host',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          records: [{ fields: { Name: 'host-1' } }],
        });
        hostTableId = host.id;

        const conditionalLookupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: conditionalLookupFieldId,
            name: 'Conditional Limited',
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignValueFieldId,
              condition: {
                filter: {
                  conjunction: 'and',
                  filterSet: [{ fieldId: foreignValueFieldId, operator: 'is', value: 'alpha' }],
                },
                sort: {
                  fieldId: foreignSortFieldId,
                  order: 'asc',
                },
                limit: 1,
              },
            },
          },
        });
        await ctx.drainOutbox();

        const beforeDelete = await ctx.getTableById(host.id);
        const conditionalFieldBefore = beforeDelete.fields.find(
          (field) => field.id === conditionalLookupFieldId
        ) as
          | {
              hasError?: boolean;
              options?: { condition?: { limit?: number; sort?: unknown } };
            }
          | undefined;
        expect(conditionalFieldBefore).toBeTruthy();
        if (!conditionalFieldBefore?.options?.condition) return;
        expect(conditionalFieldBefore.hasError).toBeFalsy();
        expect(conditionalFieldBefore.options.condition.limit).toBe(1);
        expect(conditionalFieldBefore.options.condition.sort).toEqual({
          fieldId: foreignSortFieldId,
          order: 'asc',
        });

        await ctx.deleteField({ tableId: foreign.id, fieldId: foreignSortFieldId });
        await ctx.drainOutbox();

        const afterDelete = await ctx.getTableById(host.id);
        const conditionalFieldAfter = afterDelete.fields.find(
          (field) => field.id === conditionalLookupFieldId
        ) as
          | {
              hasError?: boolean;
              options?: { condition?: { limit?: number; sort?: unknown } };
            }
          | undefined;
        expect(conditionalFieldAfter).toBeTruthy();
        if (!conditionalFieldAfter?.options?.condition) return;
        expect(conditionalFieldAfter.hasError).toBeFalsy();
        expect(conditionalFieldAfter.options.condition.limit).toBe(1);
        expect(conditionalFieldAfter.options.condition.sort).toBeUndefined();
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/delete-field.e2e-spec.ts
     * - community/apps/nestjs-backend/test/field.e2e-spec.ts
     */
    it('[V1 PARITY] forbids deleting primary field (expects 403)', async () => {
      const { tableId, primaryFieldId } = await createTable('Delete Field Primary Forbidden');

      const deleteResponse = await fetch(`${ctx.baseUrl}/tables/deleteField`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId,
          fieldId: primaryFieldId,
        }),
      });

      expect(deleteResponse.status).toBe(403);
      const tableAfter = await ctx.getTableById(tableId);
      expect(tableAfter.fields.some((field) => field.id === primaryFieldId)).toBe(true);
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/delete-field.e2e-spec.ts
     *   case: should delete field referenced by formula
     */
    it('[V1 PARITY] cleans formula references when deleting a source field used by formula expression', async () => {
      let tableId: string | undefined;
      try {
        const sourceFieldId = createFieldId();
        const formulaFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Formula Source Dependency',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: sourceFieldId, name: 'Source' },
          ],
          records: [{ fields: { Name: 'r1', [sourceFieldId]: 'Source 1' } }],
        });
        tableId = table.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: 'Formula Field',
            options: { expression: `UPPER({${sourceFieldId}})` },
          },
        });
        await ctx.drainOutbox();
        const recordsBeforeDelete = await ctx.listRecordsWithoutDrain(tableId);
        const firstRecordId = recordsBeforeDelete[0]?.id;
        if (!firstRecordId) throw new Error('Missing record');
        const formulaDbFieldName = await getFieldDbName(formulaFieldId);
        expect(await getStoredCellValue(tableId, firstRecordId, formulaDbFieldName)).toBe(
          'SOURCE 1'
        );

        const refsBeforeDelete = await countReferenceRowsFrom(sourceFieldId);
        expect(refsBeforeDelete).toBeGreaterThan(0);
        await ctx.deleteField({ tableId, fieldId: sourceFieldId });
        await ctx.drainOutbox();

        expect(await countReferenceRowsFrom(sourceFieldId)).toBe(0);
        const tableAfter = await ctx.getTableById(tableId);
        const formulaField = tableAfter.fields.find((field) => field.id === formulaFieldId);
        expect(formulaField?.type).toBe('formula');
        expect(formulaField?.hasError).toBe(true);
        expect(await getStoredCellValue(tableId, firstRecordId, formulaDbFieldName)).toBeNull();
        const recordsAfter = await ctx.listRecordsWithoutDrain(tableId);
        expect(recordsAfter).toHaveLength(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/field.e2e-spec.ts
     *   case: should delete a middle formula field, a -> b -> c delete b
     */
    it('[V1 PARITY] cleans inbound and outbound references when deleting an intermediate formula field', async () => {
      let tableId: string | undefined;
      try {
        const sourceFieldId = createFieldId();
        const midFormulaFieldId = createFieldId();
        const tailFormulaFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Formula Middle Dependency',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: sourceFieldId, name: 'Source' },
          ],
          records: [{ fields: { Name: 'r1', [sourceFieldId]: 'a' } }],
        });
        tableId = table.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: midFormulaFieldId,
            name: 'Mid Formula',
            options: { expression: `{${sourceFieldId}}` },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: tailFormulaFieldId,
            name: 'Tail Formula',
            options: { expression: `{${midFormulaFieldId}}` },
          },
        });
        await ctx.drainOutbox();
        const recordsBeforeDelete = await ctx.listRecordsWithoutDrain(tableId);
        const firstRecordId = recordsBeforeDelete[0]?.id;
        if (!firstRecordId) throw new Error('Missing record');
        const tailFormulaDbFieldName = await getFieldDbName(tailFormulaFieldId);
        expect(await getStoredCellValue(tableId, firstRecordId, tailFormulaDbFieldName)).toBe('a');

        const refsBeforeDelete = await countReferenceRowsTouching(midFormulaFieldId);
        expect(refsBeforeDelete).toBe(2);
        await ctx.deleteField({ tableId, fieldId: midFormulaFieldId });
        await ctx.drainOutbox();

        expect(await countReferenceRowsTouching(midFormulaFieldId)).toBe(0);
        const tableAfter = await ctx.getTableById(tableId);
        const tailFormulaAfter = tableAfter.fields.find((field) => field.id === tailFormulaFieldId);
        expect(tailFormulaAfter).toBeDefined();
        expect(tailFormulaAfter?.hasError).toBe(true);
        expect(await getStoredCellValue(tableId, firstRecordId, tailFormulaDbFieldName)).toBeNull();
        const recordsAfter = await ctx.listRecordsWithoutDrain(tableId);
        expect(recordsAfter).toHaveLength(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/delete-field.e2e-spec.ts
     *   special case: primary converted to formula then referenced field is deleted
     */
    it('[V1 PARITY] keeps primary field accessible when its upstream dependency is deleted after converting primary to formula', async () => {
      let tableId: string | undefined;
      try {
        const ref1FieldId = createFieldId();
        const ref2FieldId = createFieldId();
        const helperFormulaFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Primary Formula Upstream',
          fields: [
            { type: 'singleLineText', name: 'Primary Field', isPrimary: true },
            { type: 'singleLineText', id: ref1FieldId, name: 'Reference Field 1' },
            { type: 'singleLineText', id: ref2FieldId, name: 'Reference Field 2' },
          ],
          records: [
            {
              fields: {
                'Primary Field': 'p1',
                [ref1FieldId]: 'r1',
                [ref2FieldId]: 'r2',
              },
            },
          ],
        });
        tableId = table.id;
        const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id;
        if (!primaryFieldId) throw new Error('Primary field not found');

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: helperFormulaFieldId,
            name: 'Helper Formula',
            options: {
              expression: `CONCATENATE({${ref1FieldId}}, " - ", {${ref2FieldId}})`,
            },
          },
        });

        await ctx.updateField({
          tableId,
          fieldId: primaryFieldId,
          field: {
            type: 'formula',
            options: {
              expression: `UPPER({${helperFormulaFieldId}})`,
            },
          },
        });
        await ctx.drainOutbox();
        const recordsBeforeDelete = await ctx.listRecordsWithoutDrain(tableId);
        const firstRecordId = recordsBeforeDelete[0]?.id;
        if (!firstRecordId) throw new Error('Missing record');
        const primaryDbFieldName = await getFieldDbName(primaryFieldId);
        expect(await getStoredCellValue(tableId, firstRecordId, primaryDbFieldName)).toBe(
          'R1 - R2'
        );

        await ctx.deleteField({ tableId, fieldId: ref2FieldId });
        await ctx.drainOutbox();

        expect(await countReferenceRowsFrom(ref2FieldId)).toBe(0);
        const tableAfter = await ctx.getTableById(tableId);
        const primaryAfter = tableAfter.fields.find((field) => field.id === primaryFieldId);
        expect(primaryAfter?.isPrimary).toBe(true);
        expect(primaryAfter?.type).toBe('formula');
        expect(primaryAfter?.hasError).toBe(true);
        expect(await getStoredCellValue(tableId, firstRecordId, primaryDbFieldName)).toBeNull();
        const recordsAfter = await ctx.listRecordsWithoutDrain(tableId);
        expect(recordsAfter).toHaveLength(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/delete-field.e2e-spec.ts
     *   special case: delete intermediate formula referenced by primary formula
     */
    it('[V1 PARITY] keeps table readable when deleting intermediate formula in a primary-field formula chain', async () => {
      let tableId: string | undefined;
      try {
        const sourceFieldId = createFieldId();
        const midFormulaFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Primary Formula Middle Chain',
          fields: [
            { type: 'singleLineText', name: 'Primary Field', isPrimary: true },
            { type: 'singleLineText', id: sourceFieldId, name: 'Reference Field' },
          ],
          records: [{ fields: { 'Primary Field': 'p1', [sourceFieldId]: 'ref' } }],
        });
        tableId = table.id;
        const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id;
        if (!primaryFieldId) throw new Error('Primary field not found');

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: midFormulaFieldId,
            name: 'Intermediate Formula',
            options: {
              expression: `UPPER({${sourceFieldId}})`,
            },
          },
        });

        await ctx.updateField({
          tableId,
          fieldId: primaryFieldId,
          field: {
            type: 'formula',
            options: {
              expression: `CONCATENATE("Primary: ", {${midFormulaFieldId}})`,
            },
          },
        });
        await ctx.drainOutbox();
        const recordsBeforeDelete = await ctx.listRecordsWithoutDrain(tableId);
        const firstRecordId = recordsBeforeDelete[0]?.id;
        if (!firstRecordId) throw new Error('Missing record');
        const primaryDbFieldName = await getFieldDbName(primaryFieldId);
        expect(await getStoredCellValue(tableId, firstRecordId, primaryDbFieldName)).toBe(
          'Primary: REF'
        );

        const refsBeforeDelete = await countReferenceRowsTouching(midFormulaFieldId);
        expect(refsBeforeDelete).toBe(2);
        await ctx.deleteField({ tableId, fieldId: midFormulaFieldId });
        await ctx.drainOutbox();

        expect(await countReferenceRowsTouching(midFormulaFieldId)).toBe(0);
        const tableAfter = await ctx.getTableById(tableId);
        const primaryAfter = tableAfter.fields.find((field) => field.id === primaryFieldId);
        expect(primaryAfter?.isPrimary).toBe(true);
        expect(primaryAfter?.hasError).toBe(true);
        expect(await getStoredCellValue(tableId, firstRecordId, primaryDbFieldName)).toBeNull();
        const recordsAfter = await ctx.listRecordsWithoutDrain(tableId);
        expect(recordsAfter).toHaveLength(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/field.e2e-spec.ts
     *   case: should delete a link field
     */
    it('[V1 PARITY] removes link-related references/physical relation artifacts when deleting a link field', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const host = await createTable('Delete Field Link Artifacts Host');
        const foreign = await createTable('Delete Field Link Artifacts Foreign');
        hostTableId = host.tableId;
        foreignTableId = foreign.tableId;

        const linkFieldId = createFieldId();
        const withLink = await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.tableId,
          field: {
            type: 'link',
            id: linkFieldId,
            name: 'ManyOne Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.tableId,
              lookupFieldId: foreign.primaryFieldId,
              isOneWay: true,
            },
          },
        });
        const linkField = withLink.fields.find((field) => field.id === linkFieldId);
        expect(linkField?.type).toBe('link');
        expect(await countReferenceRowsTo(linkFieldId)).toBeGreaterThan(0);
        expect(await hasColumnInBaseTable(host.tableId, `__fk_${linkFieldId}`)).toBe(true);
        const junctionTable = await findJunctionTableByFieldId(linkFieldId);
        if (junctionTable) {
          expect(await hasTableInBase(junctionTable)).toBe(true);
        }

        await ctx.deleteField({ tableId: host.tableId, fieldId: linkFieldId });

        expect(await countReferenceRowsTouching(linkFieldId)).toBe(0);
        expect(await hasColumnInBaseTable(host.tableId, `__fk_${linkFieldId}`)).toBe(false);
        if (junctionTable) {
          expect(await hasTableInBase(junctionTable)).toBe(false);
        }

        const hostAfter = await ctx.getTableById(host.tableId);
        expect(hostAfter.fields.some((field) => field.id === linkFieldId)).toBe(false);
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/field.e2e-spec.ts
     *   case: should delete a link with lookup field and a referenced formula
     */
    it('[V1 PARITY] marks dependent lookup fields as hasError after deleting the upstream link field', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const host = await createTable('Delete Field Lookup Error Host');
        const foreign = await createTable('Delete Field Lookup Error Foreign');
        hostTableId = host.tableId;
        foreignTableId = foreign.tableId;

        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const formulaFieldId = createFieldId();
        const symLookupFieldId = createFieldId();

        const withLink = await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.tableId,
          field: {
            type: 'link',
            id: linkFieldId,
            name: 'Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.tableId,
              lookupFieldId: foreign.primaryFieldId,
            },
          },
        });
        const linkField = withLink.fields.find((field) => field.id === linkFieldId);
        expect(linkField?.type).toBe('link');
        if (!linkField || linkField.type !== 'link') {
          throw new Error('Expected created link field');
        }
        const symmetricFieldId = linkField.options.symmetricFieldId;
        expect(symmetricFieldId).toBeTruthy();
        if (!symmetricFieldId) {
          throw new Error('Expected symmetric field id for two-way link');
        }

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.tableId,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'Foreign Name Lookup',
            options: {
              linkFieldId,
              foreignTableId: foreign.tableId,
              lookupFieldId: foreign.primaryFieldId,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: foreign.tableId,
          field: {
            type: 'lookup',
            id: symLookupFieldId,
            name: 'Host Name Lookup',
            options: {
              linkFieldId: symmetricFieldId,
              foreignTableId: host.tableId,
              lookupFieldId: host.primaryFieldId,
            },
          },
        });

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.tableId,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: 'Lookup Formula',
            options: {
              expression: `{${lookupFieldId}}`,
            },
          },
        });
        const foreignRecord = await ctx.createRecord(foreign.tableId, {
          [foreign.primaryFieldId]: 'foreign-1',
        });
        const hostRecord = await ctx.createRecord(host.tableId, {
          [host.primaryFieldId]: 'host-1',
        });
        await ctx.updateRecord(host.tableId, hostRecord.id, {
          [linkFieldId]: { id: foreignRecord.id, title: 'foreign-1' },
        });
        await ctx.drainOutbox();
        const lookupDbFieldName = await getFieldDbName(lookupFieldId);
        const formulaDbFieldName = await getFieldDbName(formulaFieldId);
        expect(await getStoredCellValue(host.tableId, hostRecord.id, lookupDbFieldName)).toEqual([
          'foreign-1',
        ]);
        expect(await getStoredCellValue(host.tableId, hostRecord.id, formulaDbFieldName)).toEqual([
          'foreign-1',
        ]);

        const beforeDelete = await ctx.getTableById(host.tableId);
        const lookupBefore = beforeDelete.fields.find((field) => field.id === lookupFieldId);
        expect(lookupBefore?.isLookup).toBe(true);
        expect(lookupBefore?.hasError).toBeFalsy();
        expect(await countReferenceRowsFrom(foreign.primaryFieldId)).toBe(2);

        await ctx.deleteField({ tableId: host.tableId, fieldId: linkFieldId });
        await ctx.drainOutbox();

        const afterDelete = await ctx.getTableById(host.tableId);
        const lookupAfter = afterDelete.fields.find((field) => field.id === lookupFieldId);
        expect(lookupAfter?.isLookup).toBe(true);
        expect(lookupAfter?.hasError).toBe(true);
        const foreignAfter = await ctx.getTableById(foreign.tableId);
        expect(foreignAfter.fields.find((field) => field.id === symmetricFieldId)).toBeUndefined();
        expect(foreignAfter.fields.find((field) => field.id === symLookupFieldId)?.hasError).toBe(
          true
        );
        expect(await getStoredCellValue(host.tableId, hostRecord.id, lookupDbFieldName)).toBeNull();
        expect(
          await getStoredCellValue(host.tableId, hostRecord.id, formulaDbFieldName)
        ).toBeNull();
        expect(await countReferenceRowsFrom(foreign.primaryFieldId)).toBe(0);
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/computed-orchestrator.e2e-spec.ts
     *   case: emits old->null for lookup when source field is deleted
     */
    it('[V1 PARITY] clears lookup projection when deleting source field in foreign table', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreignValueFieldId = createFieldId();
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Lookup Projection Foreign',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: foreignValueFieldId, name: 'A' },
          ],
          records: [{ fields: { Name: 'f1', [foreignValueFieldId]: 10 } }],
        });
        foreignTableId = foreign.id;
        const foreignPrimaryFieldId = foreign.fields.find((field) => field.isPrimary)?.id;
        if (!foreignPrimaryFieldId) throw new Error('Missing foreign primary field');

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Lookup Projection Host',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          records: [{ fields: { Name: 'h1' } }],
        });
        hostTableId = host.id;

        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'link',
            id: linkFieldId,
            name: 'L',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: true,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: 'LKP',
            options: {
              foreignTableId: foreign.id,
              linkFieldId,
              lookupFieldId: foreignValueFieldId,
            },
          },
        });

        const foreignRecordId = (await ctx.listRecords(foreign.id))[0]?.id;
        const hostRecordId = (await ctx.listRecords(host.id))[0]?.id;
        if (!foreignRecordId || !hostRecordId) throw new Error('Missing records');

        await ctx.updateRecord(host.id, hostRecordId, {
          [linkFieldId]: { id: foreignRecordId, title: 'f1' },
        });
        await ctx.drainOutbox();

        const lookupDbFieldName = await getFieldDbName(lookupFieldId);
        expect(await getStoredCellValue(host.id, hostRecordId, lookupDbFieldName)).toEqual([10]);

        await ctx.deleteField({ tableId: foreign.id, fieldId: foreignValueFieldId });
        await ctx.drainOutbox();

        const hostAfter = await ctx.getTableById(host.id);
        expect(hostAfter.fields.find((field) => field.id === lookupFieldId)?.hasError).toBe(true);
        expect(await getStoredCellValue(host.id, hostRecordId, lookupDbFieldName)).toBeNull();
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/computed-orchestrator.e2e-spec.ts
     *   case: emits old->null for multi-level lookup when source field is deleted
     */
    it('[V1 PARITY] clears multi-level lookup chain projection when deleting base field', async () => {
      let tableAId: string | undefined;
      let tableBId: string | undefined;
      let tableCId: string | undefined;
      try {
        const aFieldId = createFieldId();
        const tableA = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Multi Lookup A',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: aFieldId, name: 'A' },
          ],
          records: [{ fields: { Name: 'a1', [aFieldId]: 10 } }],
        });
        tableAId = tableA.id;
        const tableAPrimaryFieldId = tableA.fields.find((field) => field.isPrimary)?.id;
        if (!tableAPrimaryFieldId) throw new Error('Missing tableA primary field');

        const tableB = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Multi Lookup B',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          records: [{ fields: { Name: 'b1' } }],
        });
        tableBId = tableB.id;
        const tableBPrimaryFieldId = tableB.fields.find((field) => field.isPrimary)?.id;
        if (!tableBPrimaryFieldId) throw new Error('Missing tableB primary field');

        const bLinkFieldId = createFieldId();
        const bLookupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableB.id,
          field: {
            type: 'link',
            id: bLinkFieldId,
            name: 'L_T1',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableA.id,
              lookupFieldId: tableAPrimaryFieldId,
              isOneWay: true,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableB.id,
          field: {
            type: 'lookup',
            id: bLookupFieldId,
            name: 'L2',
            options: {
              foreignTableId: tableA.id,
              linkFieldId: bLinkFieldId,
              lookupFieldId: aFieldId,
            },
          },
        });

        const tableC = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Multi Lookup C',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          records: [{ fields: { Name: 'c1' } }],
        });
        tableCId = tableC.id;

        const cLinkFieldId = createFieldId();
        const cLookupFieldId = createFieldId();
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableC.id,
          field: {
            type: 'link',
            id: cLinkFieldId,
            name: 'L_T2',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: tableBPrimaryFieldId,
              isOneWay: true,
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: tableC.id,
          field: {
            type: 'lookup',
            id: cLookupFieldId,
            name: 'L3',
            options: {
              foreignTableId: tableB.id,
              linkFieldId: cLinkFieldId,
              lookupFieldId: bLookupFieldId,
            },
          },
        });

        const tableARecordId = (await ctx.listRecords(tableA.id))[0]?.id;
        const tableBRecordId = (await ctx.listRecords(tableB.id))[0]?.id;
        const tableCRecordId = (await ctx.listRecords(tableC.id))[0]?.id;
        if (!tableARecordId || !tableBRecordId || !tableCRecordId) {
          throw new Error('Missing records');
        }

        await ctx.updateRecord(tableB.id, tableBRecordId, {
          [bLinkFieldId]: { id: tableARecordId, title: 'a1' },
        });
        await ctx.updateRecord(tableC.id, tableCRecordId, {
          [cLinkFieldId]: { id: tableBRecordId, title: 'b1' },
        });
        await ctx.drainOutbox();

        const bLookupDbFieldName = await getFieldDbName(bLookupFieldId);
        const cLookupDbFieldName = await getFieldDbName(cLookupFieldId);
        expect(await getStoredCellValue(tableB.id, tableBRecordId, bLookupDbFieldName)).toEqual([
          10,
        ]);
        expect(await getStoredCellValue(tableC.id, tableCRecordId, cLookupDbFieldName)).toEqual([
          10,
        ]);

        await ctx.deleteField({ tableId: tableA.id, fieldId: aFieldId });
        await ctx.drainOutbox();

        const tableBAfter = await ctx.getTableById(tableB.id);
        expect(tableBAfter.fields.find((field) => field.id === bLookupFieldId)?.hasError).toBe(
          true
        );
        expect(await getStoredCellValue(tableB.id, tableBRecordId, bLookupDbFieldName)).toBeNull();
        expect(await getStoredCellValue(tableC.id, tableCRecordId, cLookupDbFieldName)).toBeNull();
      } finally {
        await safeDeleteTable(tableCId);
        await safeDeleteTable(tableBId);
        await safeDeleteTable(tableAId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/field-view-sync.e2e-spec.ts
     *   case: should delete relative view conditions when deleting a field
     */
    it('[V1 PARITY] removes deleted-field references from view filter/sort/group and form column meta', async () => {
      let tableId: string | undefined;
      try {
        const numberFieldId = createFieldId();
        const statusFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field View Cleanup',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: numberFieldId, name: 'Amount' },
            { type: 'singleLineText', id: statusFieldId, name: 'Status' },
          ],
          views: [{ type: 'grid' }, { type: 'kanban' }, { type: 'form' }],
        });
        tableId = table.id;

        const gridViewId = table.views.find((view) => view.type === 'grid')?.id;
        const kanbanViewId = table.views.find((view) => view.type === 'kanban')?.id;
        const formViewId = table.views.find((view) => view.type === 'form')?.id;
        if (!gridViewId || !kanbanViewId || !formViewId) {
          throw new Error('Missing required views for delete-field view cleanup test');
        }

        const legacyFilter: LegacyFilterGroup = {
          conjunction: 'and',
          filterSet: [
            { fieldId: numberFieldId, operator: 'isGreater', value: 1 },
            { fieldId: statusFieldId, operator: 'is', value: 'done' },
          ],
        };
        const sortPayload = {
          sortObjs: [
            { fieldId: numberFieldId, order: 'asc' as const },
            { fieldId: statusFieldId, order: 'asc' as const },
          ],
        };
        const groupPayload = [
          { fieldId: numberFieldId, order: 'asc' as const },
          { fieldId: statusFieldId, order: 'asc' as const },
        ];

        await ctx.testContainer.db
          .updateTable('view')
          .set({
            filter: JSON.stringify(legacyFilter),
            sort: JSON.stringify(sortPayload),
            group: JSON.stringify(groupPayload),
          })
          .where('id', '=', gridViewId)
          .execute();

        await ctx.testContainer.db
          .updateTable('view')
          .set({
            filter: JSON.stringify(legacyFilter),
            group: JSON.stringify(groupPayload),
          })
          .where('id', '=', kanbanViewId)
          .execute();

        await ctx.testContainer.db
          .updateTable('view')
          .set({
            column_meta: JSON.stringify({
              [numberFieldId]: { order: 1, visible: true, required: true },
              [statusFieldId]: { order: 2, visible: true },
            }),
          })
          .where('id', '=', formViewId)
          .execute();

        await ctx.deleteField({ tableId: table.id, fieldId: numberFieldId });
        await ctx.drainOutbox();

        const gridViewAfter = await ctx.testContainer.db
          .selectFrom('view')
          .select(['filter', 'sort', 'group'])
          .where('id', '=', gridViewId)
          .executeTakeFirstOrThrow();
        const kanbanViewAfter = await ctx.testContainer.db
          .selectFrom('view')
          .select(['filter', 'group'])
          .where('id', '=', kanbanViewId)
          .executeTakeFirstOrThrow();
        const formViewAfter = await ctx.testContainer.db
          .selectFrom('view')
          .select('column_meta')
          .where('id', '=', formViewId)
          .executeTakeFirstOrThrow();

        const gridFilter = parseJson<LegacyFilterGroup>(gridViewAfter.filter);
        expect(gridFilter).toEqual({
          conjunction: 'and',
          filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'done' }],
        });
        const gridSort = parseJson<LegacySortPayload>(gridViewAfter.sort);
        expect(gridSort).toEqual({
          sortObjs: [{ fieldId: statusFieldId, order: 'asc' }],
          manualSort: false,
        });
        const gridGroup = parseJson<Array<{ fieldId: string; order: 'asc' | 'desc' }>>(
          gridViewAfter.group
        );
        expect(gridGroup).toEqual([{ fieldId: statusFieldId, order: 'asc' }]);

        const kanbanFilter = parseJson<LegacyFilterGroup>(kanbanViewAfter.filter);
        expect(kanbanFilter).toEqual({
          conjunction: 'and',
          filterSet: [{ fieldId: statusFieldId, operator: 'is', value: 'done' }],
        });
        const kanbanGroup = parseJson<Array<{ fieldId: string; order: 'asc' | 'desc' }>>(
          kanbanViewAfter.group
        );
        expect(kanbanGroup).toEqual([{ fieldId: statusFieldId, order: 'asc' }]);

        const formColumnMeta = parseJson<Record<string, { order?: number; visible?: boolean }>>(
          formViewAfter.column_meta
        );
        expect(formColumnMeta?.[numberFieldId]).toBeUndefined();
        expect(formColumnMeta?.[statusFieldId]?.order).toBe(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/computed-orchestrator.e2e-spec.ts
     *   case: marks hasError when referenced lookup or filter fields are removed
     */
    it('[V1 PARITY] marks conditionalLookup as hasError when foreign lookup/filter fields are deleted', async () => {
      let hostTableId: string | undefined;
      let foreignTableId: string | undefined;
      try {
        const foreignAmountFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field ConditionalLookup Foreign',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: foreignAmountFieldId, name: 'Amount' },
            { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          ],
        });
        foreignTableId = foreign.id;
        const foreignPrimaryFieldId = foreign.fields.find((field) => field.isPrimary)?.id;
        if (!foreignPrimaryFieldId) throw new Error('Missing foreign primary field');

        const hostFilterFieldId = createFieldId();
        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field ConditionalLookup Host',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'singleLineText', id: hostFilterFieldId, name: 'StatusFilter' },
          ],
        });
        hostTableId = host.id;

        const conditionalByFilterFieldId = createFieldId();
        const conditionalByLookupFieldId = createFieldId();

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: conditionalByFilterFieldId,
            name: 'Conditional By Filter',
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignPrimaryFieldId,
              condition: makeCondition(foreignStatusFieldId, {
                type: 'field',
                fieldId: hostFilterFieldId,
              }),
            },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            type: 'conditionalLookup',
            id: conditionalByLookupFieldId,
            name: 'Conditional By Lookup',
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignAmountFieldId,
              condition: makeCondition(foreignPrimaryFieldId, 'any'),
            },
          },
        });

        const beforeDelete = await ctx.getTableById(host.id);
        expect(
          beforeDelete.fields.find((field) => field.id === conditionalByFilterFieldId)?.hasError
        ).toBeFalsy();
        expect(
          beforeDelete.fields.find((field) => field.id === conditionalByLookupFieldId)?.hasError
        ).toBeFalsy();

        await ctx.deleteField({ tableId: foreign.id, fieldId: foreignStatusFieldId });
        await ctx.drainOutbox();
        const afterFilterDelete = await ctx.getTableById(host.id);
        expect(
          afterFilterDelete.fields.find((field) => field.id === conditionalByFilterFieldId)
            ?.hasError
        ).toBe(true);
        expect(
          afterFilterDelete.fields.find((field) => field.id === conditionalByLookupFieldId)
            ?.hasError
        ).toBeFalsy();

        await ctx.deleteField({ tableId: foreign.id, fieldId: foreignAmountFieldId });
        await ctx.drainOutbox();
        const afterLookupDelete = await ctx.getTableById(host.id);
        expect(
          afterLookupDelete.fields.find((field) => field.id === conditionalByLookupFieldId)
            ?.hasError
        ).toBe(true);
      } finally {
        await safeDeleteTable(hostTableId);
        await safeDeleteTable(foreignTableId);
      }
    });

    /**
     * v1 reference:
     * - community/apps/nestjs-backend/test/formula-delete-chain.e2e-spec.ts
     *   case: marks downstream formulas hasError after deleting base field
     */
    it('[V1 PARITY] propagates hasError through formula dependency chain after deleting the base field', async () => {
      let tableId: string | undefined;
      try {
        const baseFieldId = createFieldId();
        const midFormulaFieldId = createFieldId();
        const tailFormulaFieldId = createFieldId();
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Delete Field Formula Chain',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'number', id: baseFieldId, name: 'A' },
          ],
          records: [{ fields: { Name: 'r1', [baseFieldId]: 1 } }],
        });
        tableId = table.id;

        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: midFormulaFieldId,
            name: 'B',
            options: { expression: `{${baseFieldId}} * 2` },
          },
        });
        await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'formula',
            id: tailFormulaFieldId,
            name: 'C',
            options: { expression: `{${midFormulaFieldId}} * 2` },
          },
        });
        await ctx.drainOutbox();
        const recordsBeforeDelete = await ctx.listRecordsWithoutDrain(tableId);
        const firstRecordId = recordsBeforeDelete[0]?.id;
        if (!firstRecordId) throw new Error('Missing record');
        const midFormulaDbFieldName = await getFieldDbName(midFormulaFieldId);
        const tailFormulaDbFieldName = await getFieldDbName(tailFormulaFieldId);
        expect(await getStoredCellValue(tableId, firstRecordId, midFormulaDbFieldName)).toBe(2);
        expect(await getStoredCellValue(tableId, firstRecordId, tailFormulaDbFieldName)).toBe(4);

        await ctx.deleteField({ tableId, fieldId: baseFieldId });
        await ctx.drainOutbox();

        const tableAfter = await ctx.getTableById(tableId);
        const midFormula = tableAfter.fields.find((field) => field.id === midFormulaFieldId);
        const tailFormula = tableAfter.fields.find((field) => field.id === tailFormulaFieldId);

        expect(midFormula?.hasError).toBe(true);
        expect(tailFormula?.hasError).toBe(true);
        expect(await getStoredCellValue(tableId, firstRecordId, midFormulaDbFieldName)).toBeNull();
        expect(await getStoredCellValue(tableId, firstRecordId, tailFormulaDbFieldName)).toBeNull();
        const recordsAfter = await ctx.listRecordsWithoutDrain(tableId);
        expect(recordsAfter).toHaveLength(1);
      } finally {
        await safeDeleteTable(tableId);
      }
    });
  });
});

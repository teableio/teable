/* eslint-disable @typescript-eslint/naming-convention */
import {
  createBaseOkResponseSchema,
  deleteTableOkResponseSchema,
  explainOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getDomainEventName = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const name = event['name'];
  if (!isObjectRecord(name) || typeof name.toString !== 'function') {
    return undefined;
  }

  return name.toString();
};

const getEventTableId = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const tableId = event['tableId'];
  if (!isObjectRecord(tableId) || typeof tableId.toString !== 'function') {
    return undefined;
  }

  return tableId.toString();
};

let nameCounter = 0;
const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

const getTableLogEntriesByMessage = (ctx: SharedTestContext, message: string, tableId: string) =>
  ctx.testContainer.spyLogger.getEntriesByMessage(message).filter((entry) => {
    const context = entry.context;
    return isObjectRecord(context) && context['tableId'] === tableId;
  });

const getDbFieldName = async (ctx: SharedTestContext, fieldId: string) => {
  const result = await sql<{ db_field_name: string | null }>`
    SELECT "db_field_name"
    FROM "field"
    WHERE "id" = ${fieldId}
  `.execute(ctx.testContainer.db);

  const dbFieldName = result.rows.at(0)?.db_field_name;
  if (!dbFieldName) {
    throw new Error(`Missing dbFieldName for field ${fieldId}`);
  }

  return dbFieldName;
};

const listRawFieldPairValues = async (
  ctx: SharedTestContext,
  tableId: string,
  firstFieldId: string,
  secondFieldId: string
) => {
  const firstDbFieldName = await getDbFieldName(ctx, firstFieldId);
  const secondDbFieldName = await getDbFieldName(ctx, secondFieldId);

  const result = await sql<{
    __id: string;
    first_value: string | null;
    second_value: string | null;
  }>`
    SELECT
      "__id",
      ${sql.ref(firstDbFieldName)} as "first_value",
      ${sql.ref(secondDbFieldName)} as "second_value"
    FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
    ORDER BY "__auto_number" ASC
  `.execute(ctx.testContainer.db);

  return new Map(
    result.rows.map((row) => [
      row.__id,
      { firstValue: row.first_value, secondValue: row.second_value },
    ])
  );
};

const expectEmptyConvertedCell = (value: unknown) => {
  const isEmpty =
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    value === '[]';
  expect(isEmpty).toBe(true);
};

const physicalTableExists = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${ctx.baseId}
        AND c.relname = ${tableId}
    ) as "exists"
  `.execute(ctx.testContainer.db);

  return result.rows.at(0)?.exists === true;
};

const listPhysicalTableIndexes = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{
    name: string;
    is_unique: boolean;
    definition: string;
  }>`
    SELECT
      idx.relname as "name",
      ix.indisunique as "is_unique",
      pg_get_indexdef(idx.oid) as "definition"
    FROM pg_class tbl
    INNER JOIN pg_namespace n ON n.oid = tbl.relnamespace
    INNER JOIN pg_index ix ON ix.indrelid = tbl.oid
    INNER JOIN pg_class idx ON idx.oid = ix.indexrelid
    WHERE n.nspname = ${ctx.baseId}
      AND tbl.relname = ${tableId}
    ORDER BY idx.relname ASC
  `.execute(ctx.testContainer.db);

  return result.rows.map((row) => ({
    name: row.name,
    isUnique: row.is_unique,
    definition: row.definition,
  }));
};

const listPhysicalTableConstraints = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{
    name: string;
    type: string;
    definition: string;
  }>`
    SELECT
      con.conname as "name",
      con.contype as "type",
      pg_get_constraintdef(con.oid) as "definition"
    FROM pg_constraint con
    INNER JOIN pg_class tbl ON tbl.oid = con.conrelid
    INNER JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = ${ctx.baseId}
      AND tbl.relname = ${tableId}
    ORDER BY con.conname ASC
  `.execute(ctx.testContainer.db);

  return result.rows.map((row) => ({
    name: row.name,
    type: row.type,
    definition: row.definition,
  }));
};

const countPhysicalTableRows = async (ctx: SharedTestContext, tableId: string) => {
  if (!(await physicalTableExists(ctx, tableId))) {
    return null;
  }

  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int as "count"
    FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
  `.execute(ctx.testContainer.db);

  return result.rows.at(0)?.count ?? 0;
};

const getTableMetaDeleteState = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{
    deleted_time: Date | null;
  }>`
    SELECT "deleted_time"
    FROM "table_meta"
    WHERE "id" = ${tableId}
  `.execute(ctx.testContainer.db);

  const row = result.rows.at(0);
  if (!row) {
    return null;
  }

  return {
    deletedTime: row.deleted_time,
  };
};

const listFieldMetaDeleteStates = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{
    id: string;
    deleted_time: Date | null;
  }>`
    SELECT "id", "deleted_time"
    FROM "field"
    WHERE "table_id" = ${tableId}
    ORDER BY "id" ASC
  `.execute(ctx.testContainer.db);

  return result.rows.map((row) => ({
    id: row.id,
    deletedTime: row.deleted_time,
  }));
};

const listViewMetaDeleteStates = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{
    id: string;
    deleted_time: Date | null;
  }>`
    SELECT "id", "deleted_time"
    FROM "view"
    WHERE "table_id" = ${tableId}
    ORDER BY "id" ASC
  `.execute(ctx.testContainer.db);

  return result.rows.map((row) => ({
    id: row.id,
    deletedTime: row.deleted_time,
  }));
};

const countReferenceRowsForFieldIds = async (
  ctx: SharedTestContext,
  fieldIds: ReadonlyArray<string>
) => {
  if (fieldIds.length === 0) {
    return 0;
  }

  const values = sql.join(fieldIds.map((fieldId) => sql`${fieldId}`));
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int as "count"
    FROM "reference"
    WHERE "from_field_id" IN (${values})
       OR "to_field_id" IN (${values})
  `.execute(ctx.testContainer.db);

  return result.rows.at(0)?.count ?? 0;
};

describe('v2 http deleteTable (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let secondTableId: string;
  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.base.id;
  };
  const safeDeleteTable = async (targetTableId: string | undefined) => {
    if (!targetTableId) return;
    await ctx.deleteTable(targetTableId).catch(() => undefined);
  };
  const deleteTableWithBaseId = async (
    baseId: string,
    targetTableId: string,
    options?: { mode?: 'soft' | 'permanent' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId: targetTableId,
        mode: options?.mode,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeleteTable failed (${response.status}): ${await response.text()}`);
    }
  };
  const postExplain = async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      throw new Error(`Explain request failed (${response.status}): ${await response.text()}`);
    }

    const raw = await response.json();
    const parsed = explainOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse explain response');
    }

    return parsed.data.data;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table1 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Me',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    tableId = table1.id;

    const table2 = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Me Too',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });
    secondTableId = table2.id;
  });

  it('returns 200 ok and hides deleted tables (fetch)', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = deleteTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(tableId);
    expect(body.data.events.some((event) => event.name === 'TableTrashed')).toBe(true);
    expect(await physicalTableExists(ctx, tableId)).toBe(true);

    const getResponse = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`
    );
    expect(getResponse.status).toBe(404);

    await ctx.deleteTable(tableId).catch(() => undefined);
  });

  it('returns ok via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl: ctx.baseUrl });

    const body = await client.tables.delete({ baseId: ctx.baseId, tableId: secondTableId });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.id).toBe(secondTableId);
    expect(body.data.events.some((event) => event.name === 'TableTrashed')).toBe(true);
    await ctx.deleteTable(secondTableId).catch(() => undefined);
  });

  it('supports permanent delete and removes physical storage', async () => {
    const permanentTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Permanently',
      fields: [{ type: 'singleLineText', name: 'Name' }],
    });

    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: permanentTable.id,
        mode: 'permanent',
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = deleteTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    expect(parsed.data.data.events.some((event) => event.name === 'TableDeleted')).toBe(true);
    expect(await physicalTableExists(ctx, permanentTable.id)).toBe(false);
  });

  it('cleans up cross-base incoming references when deleting a foreign table', async () => {
    let foreignBaseId: string | undefined;
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      foreignBaseId = await createBase(nextName('v2-delete-table-foreign-base'));

      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('DeleteTable Cross Base Foreign'),
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Value' },
        ],
        records: [{ fields: { Name: 'Cross-A', Value: 'alpha' } }],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignValueFieldId = foreignTable.fields.find((field) => field.name === 'Value')?.id;
      if (!foreignPrimaryFieldId || !foreignValueFieldId) {
        throw new Error('Missing cross-base foreign field ids');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('DeleteTable Cross Base Host'),
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) {
        throw new Error('Missing cross-base host primary field');
      }

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Cross Base Link',
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = tableWithLink.fields.find(
        (field) => field.name === 'Cross Base Link'
      )?.id;
      if (!linkFieldId) {
        throw new Error('Missing cross-base link field');
      }

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Cross Base Lookup',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });
      const lookupFieldId = tableWithLookup.fields.find(
        (field) => field.name === 'Cross Base Lookup'
      )?.id;
      if (!lookupFieldId) {
        throw new Error('Missing cross-base lookup field');
      }

      const foreignRecord = (await ctx.listRecords(foreignTable.id)).at(0);
      if (!foreignRecord) {
        throw new Error('Missing cross-base foreign record');
      }

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host Cross',
      });
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      await deleteTableWithBaseId(foreignBaseId, foreignTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const refreshedHost = await ctx.getTableById(hostTable.id);
      const refreshedLinkField = refreshedHost.fields.find((field) => field.id === linkFieldId);
      const refreshedLookupField = refreshedHost.fields.find(
        (field) => field.id === lookupFieldId
      ) as { hasError?: boolean; isLookup?: boolean; type?: string } | undefined;
      const hostRecords = await ctx.listRecords(hostTable.id);
      const updatedRecord = hostRecords.find((record) => record.id === hostRecord.id);

      expect(refreshedLinkField?.type).toBe('singleLineText');
      expect(refreshedLookupField?.isLookup).toBe(true);
      expect(refreshedLookupField?.type).toBe('singleLineText');
      expect(refreshedLookupField?.hasError).toBe(true);
      expect(updatedRecord?.fields[linkFieldId]).toBe('Cross-A');
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      await safeDeleteTable(hostTableId);
      if (foreignBaseId && foreignTableId) {
        await deleteTableWithBaseId(foreignBaseId, foreignTableId, { mode: 'permanent' }).catch(
          () => undefined
        );
      }
    }
  });

  it('clears formula over lookup values when deleting a foreign table', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('DeleteTable Formula Foreign'),
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Value' },
        ],
        records: [{ fields: { Name: 'Formula-A', Value: 'alpha' } }],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignValueFieldId = foreignTable.fields.find((field) => field.name === 'Value')?.id;
      if (!foreignPrimaryFieldId || !foreignValueFieldId) {
        throw new Error('Missing formula foreign field ids');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('DeleteTable Formula Host'),
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) {
        throw new Error('Missing formula host primary field');
      }

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Formula Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = tableWithLink.fields.find((field) => field.name === 'Formula Link')?.id;
      if (!linkFieldId) {
        throw new Error('Missing formula link field');
      }

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Formula Lookup',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });
      const lookupFieldId = tableWithLookup.fields.find(
        (field) => field.name === 'Formula Lookup'
      )?.id;
      if (!lookupFieldId) {
        throw new Error('Missing formula lookup field');
      }

      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'formula',
          name: 'Formula Lookup State',
          options: {
            expression: `IF(COUNTA({${lookupFieldId}})=0, "no lookup", "has lookup")`,
          },
        },
      });
      const formulaFieldId = tableWithFormula.fields.find(
        (field) => field.name === 'Formula Lookup State'
      )?.id;
      if (!formulaFieldId) {
        throw new Error('Missing formula field');
      }

      const foreignRecord = (await ctx.listRecords(foreignTable.id)).at(0);
      if (!foreignRecord) {
        throw new Error('Missing formula foreign record');
      }

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host Formula',
      });
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      const beforeDeleteRecord = (await ctx.listRecords(hostTable.id)).find(
        (record) => record.id === hostRecord.id
      );
      expect(beforeDeleteRecord?.fields[lookupFieldId]).toEqual(['alpha']);
      expect(beforeDeleteRecord?.fields[formulaFieldId]).toBe('has lookup');

      await ctx.deleteTable(foreignTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const refreshedHost = await ctx.getTableById(hostTable.id);
      const refreshedLinkField = refreshedHost.fields.find((field) => field.id === linkFieldId);
      const refreshedLookupField = refreshedHost.fields.find(
        (field) => field.id === lookupFieldId
      ) as { hasError?: boolean } | undefined;
      const refreshedFormulaField = refreshedHost.fields.find(
        (field) => field.id === formulaFieldId
      );
      const updatedRecord = (await ctx.listRecords(hostTable.id)).find(
        (record) => record.id === hostRecord.id
      );

      expect(refreshedLinkField?.type).toBe('singleLineText');
      expect(refreshedLookupField?.hasError).toBe(true);
      expect(refreshedFormulaField?.type).toBe('formula');
      expect(updatedRecord?.fields[linkFieldId]).toBe('Formula-A');
      expectEmptyConvertedCell(updatedRecord?.fields[lookupFieldId]);
      expect(updatedRecord?.fields[formulaFieldId]).toBeNull();
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  it('publishes schema refresh action triggers for affected host tables during delete-table side effects', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('DeleteTable Refresh Foreign'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        records: [{ fields: { Name: 'refresh-a' } }],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      if (!foreignPrimaryFieldId) {
        throw new Error('Missing refresh foreign primary field');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('DeleteTable Refresh Host'),
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) {
        throw new Error('Missing refresh host primary field');
      }

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Foreign Link',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = tableWithLink.fields.find((field) => field.name === 'Foreign Link')?.id;
      if (!linkFieldId) {
        throw new Error('Missing refresh link field');
      }

      const foreignRecord = (await ctx.listRecords(foreignTable.id)).at(0);
      if (!foreignRecord) {
        throw new Error('Missing refresh foreign record');
      }

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'refresh-host',
      });
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      await ctx.deleteTable(foreignTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const actionTriggerTableIds = newEvents
        .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
        .map((event) => getEventTableId(event))
        .filter((tableId): tableId is string => Boolean(tableId));

      expect(actionTriggerTableIds).toContain(hostTable.id);
      expect(actionTriggerTableIds).not.toContain(foreignTable.id);
    } finally {
      await ctx.drainOutbox().catch(() => undefined);
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  it('keeps physical schema on soft delete and removes schema/meta artifacts on permanent delete', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Artifact Foreign',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        records: [{ fields: { Name: 'Foreign-1' } }],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      if (!foreignPrimaryFieldId) {
        throw new Error('Missing artifact foreign primary field');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Artifact Host',
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) {
        throw new Error('Missing artifact host primary field');
      }

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'One Way Foreign Link',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = tableWithLink.fields.find(
        (field) => field.name === 'One Way Foreign Link'
      )?.id;
      if (!linkFieldId) {
        throw new Error('Missing artifact link field');
      }

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Foreign Name',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });
      const trackedFieldIds = tableWithLookup.fields.map((field) => field.id);

      const foreignRecord = (await ctx.listRecords(foreignTable.id)).at(0);
      if (!foreignRecord) {
        throw new Error('Missing artifact foreign record');
      }

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host-1',
      });
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });
      await ctx.drainOutbox();

      const beforeSoftIndexes = await listPhysicalTableIndexes(ctx, hostTable.id);
      const beforeSoftConstraints = await listPhysicalTableConstraints(ctx, hostTable.id);
      const beforeSoftRowCount = await countPhysicalTableRows(ctx, hostTable.id);
      const beforeSoftTableMeta = await getTableMetaDeleteState(ctx, hostTable.id);
      const beforeSoftFieldMeta = await listFieldMetaDeleteStates(ctx, hostTable.id);
      const beforeSoftViewMeta = await listViewMetaDeleteStates(ctx, hostTable.id);
      const beforeSoftReferenceCount = await countReferenceRowsForFieldIds(ctx, trackedFieldIds);

      expect(await physicalTableExists(ctx, hostTable.id)).toBe(true);
      expect(beforeSoftIndexes.length).toBeGreaterThanOrEqual(3);
      expect(beforeSoftIndexes.some((index) => index.isUnique)).toBe(true);
      expect(beforeSoftConstraints.some((constraint) => constraint.type === 'f')).toBe(true);
      expect(beforeSoftRowCount).toBe(1);
      expect(beforeSoftTableMeta?.deletedTime).toBeNull();
      expect(beforeSoftFieldMeta).toHaveLength(tableWithLookup.fields.length);
      expect(beforeSoftFieldMeta.every((field) => field.deletedTime == null)).toBe(true);
      expect(beforeSoftViewMeta.length).toBeGreaterThan(0);
      expect(beforeSoftViewMeta.every((view) => view.deletedTime == null)).toBe(true);
      expect(beforeSoftReferenceCount).toBeGreaterThan(0);

      await ctx.deleteTable(hostTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const afterSoftIndexes = await listPhysicalTableIndexes(ctx, hostTable.id);
      const afterSoftConstraints = await listPhysicalTableConstraints(ctx, hostTable.id);
      const afterSoftRowCount = await countPhysicalTableRows(ctx, hostTable.id);
      const afterSoftTableMeta = await getTableMetaDeleteState(ctx, hostTable.id);
      const afterSoftFieldMeta = await listFieldMetaDeleteStates(ctx, hostTable.id);
      const afterSoftViewMeta = await listViewMetaDeleteStates(ctx, hostTable.id);
      const afterSoftReferenceCount = await countReferenceRowsForFieldIds(ctx, trackedFieldIds);

      expect(await physicalTableExists(ctx, hostTable.id)).toBe(true);
      expect(afterSoftIndexes).toEqual(beforeSoftIndexes);
      expect(afterSoftConstraints).toEqual(beforeSoftConstraints);
      expect(afterSoftRowCount).toBe(beforeSoftRowCount);
      expect(afterSoftTableMeta?.deletedTime).not.toBeNull();
      expect(afterSoftFieldMeta).toHaveLength(beforeSoftFieldMeta.length);
      expect(afterSoftFieldMeta.every((field) => field.deletedTime != null)).toBe(true);
      expect(afterSoftViewMeta).toHaveLength(beforeSoftViewMeta.length);
      expect(afterSoftViewMeta.every((view) => view.deletedTime != null)).toBe(true);
      expect(afterSoftReferenceCount).toBe(beforeSoftReferenceCount);

      await ctx.deleteTable(hostTable.id, { mode: 'permanent' });
      hostTableId = undefined;

      const afterPermanentIndexes = await listPhysicalTableIndexes(ctx, hostTable.id);
      const afterPermanentConstraints = await listPhysicalTableConstraints(ctx, hostTable.id);
      const afterPermanentTableMeta = await getTableMetaDeleteState(ctx, hostTable.id);
      const afterPermanentFieldMeta = await listFieldMetaDeleteStates(ctx, hostTable.id);
      const afterPermanentViewMeta = await listViewMetaDeleteStates(ctx, hostTable.id);
      const afterPermanentReferenceCount = await countReferenceRowsForFieldIds(
        ctx,
        trackedFieldIds
      );

      expect(await physicalTableExists(ctx, hostTable.id)).toBe(false);
      expect(await countPhysicalTableRows(ctx, hostTable.id)).toBeNull();
      expect(afterPermanentIndexes).toHaveLength(0);
      expect(afterPermanentConstraints).toHaveLength(0);
      expect(afterPermanentTableMeta).toBeNull();
      expect(afterPermanentFieldMeta).toHaveLength(0);
      expect(afterPermanentViewMeta).toHaveLength(0);
      expect(afterPermanentReferenceCount).toBe(0);

      expect(await physicalTableExists(ctx, foreignTable.id)).toBe(true);
      expect((await getTableMetaDeleteState(ctx, foreignTable.id))?.deletedTime).toBeNull();
    } finally {
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  it('restores a soft-deleted table without recreating physical storage', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('Restore Table Candidate'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        records: [{ fields: { Name: 'Alpha' } }],
      });
      tableId = table.id;

      const primaryFieldId = table.fields.find((field) => field.isPrimary)?.id;
      if (!primaryFieldId) {
        throw new Error('Missing restore table primary field');
      }

      const indexesBeforeDelete = await listPhysicalTableIndexes(ctx, table.id);
      const constraintsBeforeDelete = await listPhysicalTableConstraints(ctx, table.id);
      expect(await physicalTableExists(ctx, table.id)).toBe(true);
      expect(await countPhysicalTableRows(ctx, table.id)).toBe(1);

      await ctx.deleteTable(table.id, { mode: 'soft' });

      expect(await physicalTableExists(ctx, table.id)).toBe(true);
      expect((await getTableMetaDeleteState(ctx, table.id))?.deletedTime).toEqual(expect.any(Date));
      expect(
        (await listFieldMetaDeleteStates(ctx, table.id)).every((field) => field.deletedTime)
      ).toBe(true);
      expect(
        (await listViewMetaDeleteStates(ctx, table.id)).every((view) => view.deletedTime)
      ).toBe(true);
      await expect(ctx.getTableById(table.id)).rejects.toThrow();

      const beforeRestoreEventCount = ctx.testContainer.eventBus.events().length;
      const restored = await ctx.restoreTable(table.id);
      const restoreEvents = ctx.testContainer.eventBus.events().slice(beforeRestoreEventCount);

      expect(restored.id).toBe(table.id);
      expect(restoreEvents.map(getDomainEventName)).toContain('TableRestored');
      expect(await physicalTableExists(ctx, table.id)).toBe(true);
      expect((await getTableMetaDeleteState(ctx, table.id))?.deletedTime).toBeNull();
      expect(
        (await listFieldMetaDeleteStates(ctx, table.id)).every((field) => !field.deletedTime)
      ).toBe(true);
      expect(
        (await listViewMetaDeleteStates(ctx, table.id)).every((view) => !view.deletedTime)
      ).toBe(true);
      expect(await listPhysicalTableIndexes(ctx, table.id)).toEqual(indexesBeforeDelete);
      expect(await listPhysicalTableConstraints(ctx, table.id)).toEqual(constraintsBeforeDelete);

      const listedTables = await ctx.listTables();
      expect(listedTables.some((listedTable) => listedTable.id === table.id)).toBe(true);

      const records = await ctx.listRecords(table.id, { limit: 10 });
      expect(records).toHaveLength(1);
      expect(records[0]?.fields[primaryFieldId]).toBe('Alpha');
    } finally {
      await safeDeleteTable(tableId);
    }
  });

  it('explains delete table side effects without mutating real tables', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Explain Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Value' },
        ],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignValueFieldId = foreignTable.fields.find((field) => field.name === 'Value')?.id;
      if (!foreignPrimaryFieldId || !foreignValueFieldId) {
        throw new Error('Missing explain foreign field ids');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Explain Host',
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;

      const tableWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Foreign Link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });
      const linkFieldId = tableWithLink.fields.find((field) => field.name === 'Foreign Link')?.id;
      if (!linkFieldId) throw new Error('Missing explain link field');

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Foreign Value',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });

      const result = await postExplain('/tables/explainDeleteTable', {
        baseId: ctx.baseId,
        tableId: foreignTable.id,
        mode: 'permanent',
        analyze: false,
        includeSql: true,
        includeGraph: false,
        includeLocks: false,
      });

      expect(result.command.type).toBe('DeleteTable');
      expect(result.command.tableId).toBe(foreignTable.id);
      expect(result.command.tableName).toBe('DeleteTable Explain Foreign');
      expect(
        result.sqlExplains.some(
          (step) =>
            step.sql.toLowerCase().includes('drop table') && step.sql.includes(foreignTable.id)
        )
      ).toBe(true);
      expect(
        result.sqlExplains.some(
          (step) =>
            step.sql.includes(hostTable.id) &&
            (step.sql.toLowerCase().includes('alter table') ||
              step.sql.toLowerCase().startsWith('update ') ||
              step.sql.toLowerCase().startsWith('with '))
        )
      ).toBe(true);

      const refreshedForeign = await ctx.getTableById(foreignTable.id);
      const refreshedHost = await ctx.getTableById(hostTable.id);
      const refreshedLinkField = refreshedHost.fields.find((field) => field.id === linkFieldId);
      const refreshedLookupField = refreshedHost.fields.find(
        (field) => field.name === 'Foreign Value'
      ) as { hasError?: boolean } | undefined;

      expect(refreshedForeign.id).toBe(foreignTable.id);
      expect(refreshedLinkField?.type).toBe('link');
      expect(refreshedLookupField?.hasError).not.toBe(true);
    } finally {
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  // V1 delete-table parity inventory:
  // - table.e2e-spec.ts: should delete table and clean up link and lookup fields
  // - trash.e2e-spec.ts: delete -> retrieve/restore/reset base trash items
  it('[V1 PARITY][table.e2e-spec.ts] cleans up mixed link/computed fields when deleting a foreign table', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Value' },
        ],
        records: [
          { fields: { Name: 'A', Value: 'alpha' } },
          { fields: { Name: 'B', Value: 'beta' } },
        ],
      });
      foreignTableId = foreignTable.id;

      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      const foreignValueFieldId = foreignTable.fields.find((field) => field.name === 'Value')?.id;
      if (!foreignPrimaryFieldId || !foreignValueFieldId) {
        throw new Error('Missing foreign field ids');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Host',
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
      });
      hostTableId = hostTable.id;
      const hostPrimaryFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
      if (!hostPrimaryFieldId) throw new Error('Missing host primary field');

      const tableWithTwoWayLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Two Way Foreign Link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
          },
        },
      });
      const twoWayLinkFieldId = tableWithTwoWayLink.fields.find(
        (field) => field.name === 'Two Way Foreign Link'
      )?.id;
      if (!twoWayLinkFieldId) throw new Error('Missing two-way link field');

      const tableWithOneWayLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'One Way Foreign Link',
          options: {
            relationship: 'oneOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const oneWayLinkFieldId = tableWithOneWayLink.fields.find(
        (field) => field.name === 'One Way Foreign Link'
      )?.id;
      if (!oneWayLinkFieldId) throw new Error('Missing one-way link field');

      const tableWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Foreign Lookup',
          options: {
            linkFieldId: twoWayLinkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });
      const lookupFieldId = tableWithLookup.fields.find(
        (field) => field.name === 'Foreign Lookup'
      )?.id;
      if (!lookupFieldId) throw new Error('Missing lookup field');

      const tableWithRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'rollup',
          name: 'Foreign Rollup',
          options: {
            expression: 'countall({values})',
          },
          config: {
            linkFieldId: twoWayLinkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });
      const rollupFieldId = tableWithRollup.fields.find(
        (field) => field.name === 'Foreign Rollup'
      )?.id;
      if (!rollupFieldId) throw new Error('Missing rollup field');

      const foreignRecords = await ctx.listRecords(foreignTable.id);
      const foreignRecordA = foreignRecords.find(
        (record) => record.fields[foreignPrimaryFieldId] === 'A'
      );
      const foreignRecordB = foreignRecords.find(
        (record) => record.fields[foreignPrimaryFieldId] === 'B'
      );
      if (!foreignRecordA || !foreignRecordB) throw new Error('Missing foreign records');

      const hostRecordA = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host-1',
      });
      const hostRecordB = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host-2',
      });
      const hostRecordEmpty = await ctx.createRecord(hostTable.id, {
        [hostPrimaryFieldId]: 'Host-3',
      });

      await ctx.updateRecord(hostTable.id, hostRecordA.id, {
        [twoWayLinkFieldId]: [{ id: foreignRecordA.id }],
        [oneWayLinkFieldId]: { id: foreignRecordA.id },
      });
      await ctx.updateRecord(hostTable.id, hostRecordB.id, {
        [twoWayLinkFieldId]: [{ id: foreignRecordB.id }],
        [oneWayLinkFieldId]: { id: foreignRecordB.id },
      });
      await ctx.drainOutbox();

      ctx.clearLogs();

      await ctx.deleteTable(foreignTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const hostBackfillStarts = getTableLogEntriesByMessage(
        ctx,
        'computed:backfillMany:start',
        hostTable.id
      );
      expect(hostBackfillStarts).toHaveLength(2);

      const hostBackfillFieldSets = hostBackfillStarts.map((entry) => {
        const context = entry.context;
        if (!isObjectRecord(context) || !Array.isArray(context['fieldIds'])) {
          return [];
        }
        return context['fieldIds'].filter(
          (fieldId): fieldId is string => typeof fieldId === 'string'
        );
      });
      expect(hostBackfillFieldSets).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([lookupFieldId]),
          expect.arrayContaining([rollupFieldId]),
        ])
      );

      const hostBackfillSqlLogs = getTableLogEntriesByMessage(
        ctx,
        'computed:backfillMany:sql',
        hostTable.id
      );
      expect(hostBackfillSqlLogs).toHaveLength(2);
      for (const entry of hostBackfillSqlLogs) {
        const sqlText = isObjectRecord(entry.context) ? entry.context['sql'] : undefined;
        expect(typeof sqlText).toBe('string');
        if (typeof sqlText !== 'string') continue;

        expect(sqlText).toContain(`update "${ctx.baseId}"."${hostTable.id}" as "u" set`);
        expect(sqlText.toLowerCase()).toContain('from (select');
        expect(sqlText).not.toContain('tmp_computed_dirty');
        expect(sqlText).not.toContain('select "__id" as "record_id"');
      }

      expect(ctx.testContainer.spyLogger.getEntriesByMessage('find:mode:stored:sql')).toHaveLength(
        0
      );

      const refreshedHost = await ctx.getTableById(hostTable.id);
      const twoWayLinkField = refreshedHost.fields.find((field) => field.id === twoWayLinkFieldId);
      const oneWayLinkField = refreshedHost.fields.find((field) => field.id === oneWayLinkFieldId);
      const lookupField = refreshedHost.fields.find((field) => field.id === lookupFieldId) as
        | { hasError?: boolean }
        | undefined;
      const rollupField = refreshedHost.fields.find((field) => field.id === rollupFieldId) as
        | { hasError?: boolean }
        | undefined;

      expect(twoWayLinkField?.type).toBe('singleLineText');
      expect(oneWayLinkField?.type).toBe('singleLineText');
      expect(lookupField?.hasError).toBe(true);
      expect(rollupField?.hasError).toBe(true);

      const refreshedRecords = await ctx.listRecords(hostTable.id);
      const updatedHostRecordA = refreshedRecords.find((record) => record.id === hostRecordA.id);
      const updatedHostRecordB = refreshedRecords.find((record) => record.id === hostRecordB.id);
      const updatedHostRecordEmpty = refreshedRecords.find(
        (record) => record.id === hostRecordEmpty.id
      );
      expect(updatedHostRecordA?.fields[twoWayLinkFieldId]).toBe('A');
      expect(updatedHostRecordA?.fields[oneWayLinkFieldId]).toBe('A');
      expect(updatedHostRecordB?.fields[twoWayLinkFieldId]).toBe('B');
      expect(updatedHostRecordB?.fields[oneWayLinkFieldId]).toBe('B');
      expectEmptyConvertedCell(updatedHostRecordEmpty?.fields[twoWayLinkFieldId]);
      expectEmptyConvertedCell(updatedHostRecordEmpty?.fields[oneWayLinkFieldId]);

      const rawHostValues = await listRawFieldPairValues(
        ctx,
        hostTable.id,
        twoWayLinkFieldId,
        oneWayLinkFieldId
      );
      expect(rawHostValues.get(hostRecordA.id)).toEqual({
        firstValue: 'A',
        secondValue: 'A',
      });
      expect(rawHostValues.get(hostRecordB.id)).toEqual({
        firstValue: 'B',
        secondValue: 'B',
      });
      expect(rawHostValues.get(hostRecordEmpty.id)).toEqual({
        firstValue: null,
        secondValue: null,
      });
    } finally {
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  it('marks conditional lookup and conditional rollup errored when the foreign table is deleted', async () => {
    let foreignTableId: string | undefined;
    let hostTableId: string | undefined;

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Conditional Foreign',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Value' },
          { type: 'number', name: 'Score' },
        ],
        records: [{ fields: { Name: 'Row-A', Value: 'alpha', Score: 1 } }],
      });
      foreignTableId = foreignTable.id;

      const foreignValueFieldId = foreignTable.fields.find((field) => field.name === 'Value')?.id;
      const foreignScoreFieldId = foreignTable.fields.find((field) => field.name === 'Score')?.id;
      if (!foreignValueFieldId || !foreignScoreFieldId) {
        throw new Error('Missing foreign conditional field ids');
      }

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteTable Conditional Host',
        fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
        records: [{ fields: { 'Host Name': 'Host-1' } }],
      });
      hostTableId = hostTable.id;

      const tableWithConditionalLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'conditionalLookup',
          name: 'Conditional Lookup',
          options: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignValueFieldId, operator: 'is', value: 'alpha' }],
              },
              sort: {
                fieldId: foreignScoreFieldId,
                order: 'asc',
              },
              limit: 1,
            },
          },
        },
      });
      const conditionalLookupFieldId = tableWithConditionalLookup.fields.find(
        (field) => field.name === 'Conditional Lookup'
      )?.id;
      if (!conditionalLookupFieldId) throw new Error('Missing conditional lookup field');

      const tableWithConditionalRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'conditionalRollup',
          name: 'Conditional Rollup',
          options: {
            expression: 'sum({values})',
          },
          config: {
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignScoreFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: foreignValueFieldId, operator: 'is', value: 'alpha' }],
              },
              sort: {
                fieldId: foreignScoreFieldId,
                order: 'asc',
              },
              limit: 1,
            },
          },
        },
      });
      const conditionalRollupFieldId = tableWithConditionalRollup.fields.find(
        (field) => field.name === 'Conditional Rollup'
      )?.id;
      if (!conditionalRollupFieldId) throw new Error('Missing conditional rollup field');

      await ctx.drainOutbox();
      ctx.clearLogs();
      await ctx.deleteTable(foreignTable.id, { mode: 'soft' });
      await ctx.drainOutbox();

      const hostBackfillStarts = getTableLogEntriesByMessage(
        ctx,
        'computed:backfillMany:start',
        hostTable.id
      );
      expect(hostBackfillStarts).toHaveLength(1);
      const hostBackfillFieldSets = hostBackfillStarts.map((entry) => {
        const context = entry.context;
        if (!isObjectRecord(context) || !Array.isArray(context['fieldIds'])) {
          return [];
        }
        return context['fieldIds'].filter(
          (fieldId): fieldId is string => typeof fieldId === 'string'
        );
      });
      expect(hostBackfillFieldSets).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([conditionalLookupFieldId, conditionalRollupFieldId]),
        ])
      );

      const hostBackfillSqlLogs = getTableLogEntriesByMessage(
        ctx,
        'computed:backfillMany:sql',
        hostTable.id
      );
      expect(hostBackfillSqlLogs).toHaveLength(1);
      for (const entry of hostBackfillSqlLogs) {
        const sqlText = isObjectRecord(entry.context) ? entry.context['sql'] : undefined;
        expect(typeof sqlText).toBe('string');
        if (typeof sqlText !== 'string') continue;

        expect(sqlText).toContain(`update "${ctx.baseId}"."${hostTable.id}" as "u" set`);
        expect(sqlText.toLowerCase()).toContain('from (select');
        expect(sqlText).not.toContain('tmp_computed_dirty');
        expect(sqlText).not.toContain('select "__id" as "record_id"');
      }

      expect(ctx.testContainer.spyLogger.getEntriesByMessage('find:mode:stored:sql')).toHaveLength(
        0
      );

      const refreshedHost = await ctx.getTableById(hostTable.id);
      const conditionalLookupField = refreshedHost.fields.find(
        (field) => field.id === conditionalLookupFieldId
      ) as { hasError?: boolean } | undefined;
      const conditionalRollupField = refreshedHost.fields.find(
        (field) => field.id === conditionalRollupFieldId
      ) as { hasError?: boolean } | undefined;

      expect(conditionalLookupField?.hasError).toBe(true);
      expect(conditionalRollupField?.hasError).toBe(true);
    } finally {
      await safeDeleteTable(hostTableId);
      await safeDeleteTable(foreignTableId);
    }
  });

  it.todo(
    '[V1 PARITY][trash.e2e-spec.ts] surfaces a deleted table in base trash once v2 exposes trash routes'
  );

  it.todo(
    '[V1 PARITY][trash.e2e-spec.ts] surfaces a deleted linked foreign table in base trash once v2 exposes trash routes'
  );

  it.todo(
    '[V1 PARITY][trash.e2e-spec.ts] restores a deleted table from base trash once v2 exposes trash routes'
  );

  it.todo(
    '[V1 PARITY][trash.e2e-spec.ts] resets base trash after deleting multiple tables once v2 exposes trash routes'
  );
});

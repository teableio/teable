/* eslint-disable @typescript-eslint/naming-convention */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type RawViewRow = {
  id: string;
  name: string;
  type: string;
  column_meta: string;
  sort: string | null;
  filter: string | null;
  group: string | null;
  options: string | null;
};

let nameCounter = 0;
let fieldIdCounter = 0;

const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const remapIds = <T>(value: T, replacements: Record<string, string>) => {
  let json = JSON.stringify(value);
  for (const [sourceId, targetId] of Object.entries(replacements)) {
    json = json.replaceAll(sourceId, targetId);
  }
  return JSON.parse(json) as T;
};

const normalizeButtonCellValue = (value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeStoredFilterShape = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeStoredFilterShape(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'filterSet') {
      normalized.items = normalizeStoredFilterShape(entry);
      continue;
    }
    normalized[key] = normalizeStoredFilterShape(entry);
  }
  return normalized;
};

const expectClearedButtonValue = (value: unknown) => {
  expect(value === undefined || value === null).toBe(true);
};

const createBase = async (ctx: SharedTestContext, name: string) => {
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

const deleteTableWithBaseId = async (ctx: SharedTestContext, baseId: string, tableId: string) => {
  const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete table ${tableId} in base ${baseId}: ${errorText}`);
  }
};

const listViewRows = async (ctx: SharedTestContext, tableId: string) =>
  ctx.testContainer.db
    .selectFrom('view')
    .select(['id', 'name', 'type', 'column_meta', 'sort', 'filter', 'group', 'options'])
    .where('table_id', '=', tableId)
    .where('deleted_time', 'is', null)
    .orderBy('type')
    .execute() as Promise<RawViewRow[]>;

const normalizeViewRows = (rows: RawViewRow[]) =>
  rows.map((row) => ({
    name: row.name,
    type: row.type,
    columnMeta: JSON.parse(row.column_meta),
    sort: row.sort ? JSON.parse(row.sort) : null,
    filter: row.filter ? normalizeStoredFilterShape(JSON.parse(row.filter)) : null,
    group: row.group ? JSON.parse(row.group) : null,
    options: row.options ? JSON.parse(row.options) : null,
  }));

const getFieldStorage = async (ctx: SharedTestContext, fieldId: string) => {
  const result = await sql<{ db_field_name: string | null; db_field_type: string | null }>`
    SELECT "db_field_name", "db_field_type"
    FROM "field"
    WHERE "id" = ${fieldId}
  `.execute(ctx.testContainer.db);

  const row = result.rows.at(0);
  if (!row?.db_field_name || !row.db_field_type) {
    throw new Error(`Missing field storage metadata for ${fieldId}`);
  }

  return {
    dbFieldName: row.db_field_name,
    dbFieldType: row.db_field_type,
  };
};

const getDbTableName = async (ctx: SharedTestContext, tableId: string) => {
  const result = await sql<{ db_table_name: string | null }>`
    SELECT "db_table_name"
    FROM "table_meta"
    WHERE "id" = ${tableId}
  `.execute(ctx.testContainer.db);

  const dbTableName = result.rows.at(0)?.db_table_name;
  if (!dbTableName) {
    throw new Error(`Missing table storage metadata for ${tableId}`);
  }

  return dbTableName;
};

const setRawFieldValue = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fieldId: string,
  value: unknown
) => {
  const { dbFieldName, dbFieldType } = await getFieldStorage(ctx, fieldId);

  if (dbFieldType === 'JSON') {
    await sql`
      UPDATE ${sql.table(`${ctx.baseId}.${tableId}`)}
      SET ${sql.ref(dbFieldName)} = ${JSON.stringify(value)}::jsonb
      WHERE "__id" = ${recordId}
    `.execute(ctx.testContainer.db);
    return;
  }

  await sql`
    UPDATE ${sql.table(`${ctx.baseId}.${tableId}`)}
    SET ${sql.ref(dbFieldName)} = ${JSON.stringify(value)}
    WHERE "__id" = ${recordId}
  `.execute(ctx.testContainer.db);
};

describe('duplicateTable (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('duplicates all field kinds and remaps link-based schemas', async () => {
    const cleanupTableIds: string[] = [];

    const tagNameFieldId = createFieldId();
    const vendorNameFieldId = createFieldId();
    const vendorTagLinkFieldId = createFieldId();
    const sourceNameFieldId = createFieldId();
    const requiredTextFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const singleSelectFieldId = createFieldId();
    const dateFieldId = createFieldId();
    const checkboxFieldId = createFieldId();
    const userFieldId = createFieldId();
    const multiSelectFieldId = createFieldId();
    const multiUserFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    const vendorLinkFieldId = createFieldId();
    const vendorNameLookupFieldId = createFieldId();
    const vendorTagsLookupFieldId = createFieldId();

    try {
      const tags = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-tags'),
        fields: [{ id: tagNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(tags.id);

      const vendors = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-vendors'),
        fields: [{ id: vendorNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(vendors.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: vendors.id,
        field: {
          id: vendorTagLinkFieldId,
          name: 'Tags',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: tags.id,
            lookupFieldId: tagNameFieldId,
            isOneWay: true,
          },
        },
      });

      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-all-fields'),
        fields: [
          { id: sourceNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: requiredTextFieldId,
            name: 'Required Text',
            type: 'singleLineText',
            notNull: true,
            unique: true,
          },
          {
            id: numberFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
          {
            id: singleSelectFieldId,
            name: 'Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choX', name: 'x', color: 'cyan' },
                { id: 'choY', name: 'y', color: 'blue' },
              ],
            },
          },
          { id: dateFieldId, name: 'Due', type: 'date' },
          { id: checkboxFieldId, name: 'Done', type: 'checkbox' },
          { id: userFieldId, name: 'Owner', type: 'user' },
          {
            id: multiSelectFieldId,
            name: 'Genres',
            type: 'multipleSelect',
            options: {
              choices: [
                { id: 'choR', name: 'rap', color: 'cyan' },
                { id: 'choK', name: 'rock', color: 'blue' },
              ],
            },
          },
          {
            id: multiUserFieldId,
            name: 'Assignees',
            type: 'user',
            options: { isMultiple: true, shouldNotify: false },
          },
          {
            id: formulaFieldId,
            name: 'Score',
            type: 'formula',
            options: {
              expression: `{${numberFieldId}} + 1`,
              timeZone: 'Asia/Shanghai',
              formatting: { type: 'decimal', precision: 1 },
            },
          },
        ],
      });
      cleanupTableIds.push(source.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: vendorLinkFieldId,
          name: 'Vendor',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: vendors.id,
            lookupFieldId: vendorNameFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: vendorNameLookupFieldId,
          name: 'Vendor Name',
          type: 'lookup',
          options: {
            linkFieldId: vendorLinkFieldId,
            foreignTableId: vendors.id,
            lookupFieldId: vendorNameFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: vendorTagsLookupFieldId,
          name: 'Vendor Tags',
          type: 'lookup',
          options: {
            linkFieldId: vendorLinkFieldId,
            foreignTableId: vendors.id,
            lookupFieldId: vendorTagLinkFieldId,
          },
        },
      });

      const sourceTable = await ctx.getTableById(source.id);
      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: source.id,
        name: nextName('v2-duplicate-all-fields-copy'),
        includeRecords: false,
      });
      cleanupTableIds.push(duplicated.table.id);

      expect(duplicated.table.fields).toHaveLength(sourceTable.fields.length);
      expect(duplicated.table.fields.map((field) => field.name).sort()).toEqual(
        sourceTable.fields.map((field) => field.name).sort()
      );

      const duplicatedVendorLinkId = duplicated.fieldIdMap[vendorLinkFieldId];
      const duplicatedVendorTagsLookupId = duplicated.fieldIdMap[vendorTagsLookupFieldId];
      expect(duplicatedVendorLinkId).toBeTruthy();
      expect(duplicatedVendorTagsLookupId).toBeTruthy();

      const duplicatedVendorLink = duplicated.table.fields.find(
        (field) => field.id === duplicatedVendorLinkId
      );
      expect(duplicatedVendorLink?.type).toBe('link');
      if (!duplicatedVendorLink || duplicatedVendorLink.type !== 'link') {
        throw new Error('Missing duplicated vendor link field');
      }
      expect(duplicatedVendorLink.notNull).toBeUndefined();
      expect(duplicatedVendorLink.options.foreignTableId).toBe(vendors.id);
      expect(duplicatedVendorLink.options.isOneWay).toBe(true);

      const duplicatedVendorNameLookup = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[vendorNameLookupFieldId]
      );
      expect(duplicatedVendorNameLookup?.isLookup).toBe(true);
      expect(duplicatedVendorNameLookup?.lookupOptions).toMatchObject({
        linkFieldId: duplicatedVendorLinkId,
        foreignTableId: vendors.id,
        lookupFieldId: vendorNameFieldId,
      });

      const duplicatedVendorTagsLookup = duplicated.table.fields.find(
        (field) => field.id === duplicatedVendorTagsLookupId
      );
      expect(duplicatedVendorTagsLookup).toMatchObject({
        id: duplicatedVendorTagsLookupId,
        type: 'link',
        isLookup: true,
        lookupOptions: {
          linkFieldId: duplicatedVendorLinkId,
          foreignTableId: vendors.id,
          lookupFieldId: vendorTagLinkFieldId,
        },
      });
      if (!duplicatedVendorTagsLookup || duplicatedVendorTagsLookup.type !== 'link') {
        throw new Error('Missing duplicated lookup(link) field');
      }
      expect(duplicatedVendorTagsLookup.options.foreignTableId).toBe(tags.id);
      expect(duplicatedVendorTagsLookup.options.lookupFieldId).toBe(tagNameFieldId);

      const duplicatedRequiredText = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[requiredTextFieldId]
      );
      expect(duplicatedRequiredText?.notNull).toBe(true);
      expect(duplicatedRequiredText?.unique).toBe(true);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('preserves hasError for formula and lookup fields after duplication', async () => {
    const cleanupTableIds: string[] = [];

    const foreignNameFieldId = createFieldId();
    const foreignValueFieldId = createFieldId();
    const sourceNameFieldId = createFieldId();
    const sourceNumberFieldId = createFieldId();
    const linkFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    try {
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-error-foreign'),
        fields: [
          { id: foreignNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: foreignValueFieldId,
            name: 'Value',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
        ],
      });
      cleanupTableIds.push(foreignTable.id);

      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-error-source'),
        fields: [
          { id: sourceNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: sourceNumberFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
        ],
      });
      cleanupTableIds.push(source.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: linkFieldId,
          name: 'Vendor',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: formulaFieldId,
          name: 'Broken Formula',
          type: 'formula',
          options: {
            expression: `{${sourceNumberFieldId}} + 1`,
            timeZone: 'Asia/Shanghai',
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: lookupFieldId,
          name: 'Broken Lookup',
          type: 'lookup',
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignValueFieldId,
          },
        },
      });

      await ctx.deleteField({ tableId: source.id, fieldId: sourceNumberFieldId });
      await ctx.deleteField({ tableId: foreignTable.id, fieldId: foreignValueFieldId });
      await ctx.drainOutbox();

      const sourceAfterDelete = await ctx.getTableById(source.id);
      const sourceFormula = sourceAfterDelete.fields.find((field) => field.id === formulaFieldId);
      const sourceLookup = sourceAfterDelete.fields.find((field) => field.id === lookupFieldId);
      expect(sourceFormula?.hasError).toBe(true);
      expect(sourceLookup?.hasError).toBe(true);

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: source.id,
        name: nextName('v2-duplicate-error-copy'),
        includeRecords: false,
      });
      cleanupTableIds.push(duplicated.table.id);

      const duplicatedFormula = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[formulaFieldId]
      );
      const duplicatedLookup = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[lookupFieldId]
      );
      expect(duplicatedFormula?.hasError).toBe(true);
      expect(duplicatedLookup?.hasError).toBe(true);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates self link fields and remaps self-linked records', async () => {
    const cleanupTableIds: string[] = [];

    const sourceNameFieldId = createFieldId();
    const selfLinkFieldId = createFieldId();

    try {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-self-link'),
        fields: [{ id: sourceNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(source.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: source.id,
        field: {
          id: selfLinkFieldId,
          name: 'Related',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: source.id,
            lookupFieldId: sourceNameFieldId,
          },
        },
      });

      const sourceAfterLink = await ctx.getTableById(source.id);
      const createdSelfLinkField = sourceAfterLink.fields.find(
        (field) => field.id === selfLinkFieldId
      );
      if (!createdSelfLinkField || createdSelfLinkField.type !== 'link') {
        throw new Error('Missing self link field');
      }
      const symmetricSelfLinkField = sourceAfterLink.fields.find(
        (field) => field.id === createdSelfLinkField.options.symmetricFieldId
      );
      if (!symmetricSelfLinkField || symmetricSelfLinkField.type !== 'link') {
        throw new Error('Missing symmetric self link field');
      }

      const alpha = await ctx.createRecord(source.id, {
        [sourceNameFieldId]: 'Alpha',
      });
      const beta = await ctx.createRecord(source.id, {
        [sourceNameFieldId]: 'Beta',
      });

      await ctx.updateRecord(source.id, alpha.id, {
        [selfLinkFieldId]: [{ id: beta.id }],
      });

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: source.id,
        name: nextName('v2-duplicate-self-link-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);

      const duplicatedSelfLinkFieldId = duplicated.fieldIdMap[selfLinkFieldId];
      const duplicatedSymmetricFieldId = duplicated.fieldIdMap[symmetricSelfLinkField.id];
      const duplicatedSelfLinkFields = duplicated.table.fields.filter(
        (field) => field.type === 'link' && field.options.foreignTableId === duplicated.table.id
      );

      expect(duplicatedSelfLinkFields).toHaveLength(2);
      expect(duplicatedSelfLinkFields[0]?.options.fkHostTableName).toBe(
        duplicatedSelfLinkFields[1]?.options.fkHostTableName
      );

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      const duplicatedRecordByName = new Map(
        duplicatedRecords.map((record) => [
          record.fields[duplicated.fieldIdMap[sourceNameFieldId]],
          record,
        ])
      );
      const duplicatedAlpha = duplicatedRecordByName.get('Alpha');
      const duplicatedBeta = duplicatedRecordByName.get('Beta');
      expect(duplicatedAlpha).toBeDefined();
      expect(duplicatedBeta).toBeDefined();
      if (!duplicatedAlpha || !duplicatedBeta) {
        throw new Error('Missing duplicated self-link records');
      }

      expect(duplicatedAlpha.fields[duplicatedSelfLinkFieldId]).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: duplicatedBeta.id })])
      );
      expect(duplicatedAlpha.fields[duplicatedSymmetricFieldId] ?? undefined).toBeUndefined();
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates all view types and preserves query/options in storage', async () => {
    const cleanupTableIds: string[] = [];

    const nameFieldId = createFieldId();
    const statusFieldId = createFieldId();
    const dueFieldId = createFieldId();
    const filesFieldId = createFieldId();
    const amountFieldId = createFieldId();

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-views'),
        fields: [
          { id: nameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: statusFieldId,
            name: 'Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choTodo', name: 'Todo', color: 'cyan' },
                { id: 'choDone', name: 'Done', color: 'green' },
              ],
            },
          },
          { id: dueFieldId, name: 'Due', type: 'date' },
          { id: filesFieldId, name: 'Files', type: 'attachment' },
          {
            id: amountFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
        ],
        views: [
          { type: 'grid', name: 'Grid' },
          { type: 'gallery', name: 'Gallery' },
          { type: 'kanban', name: 'Kanban' },
          { type: 'calendar', name: 'Calendar' },
          { type: 'form', name: 'Form' },
          { type: 'plugin', name: 'Plugin' },
        ],
      });
      cleanupTableIds.push(table.id);

      const sourceViewRows = await listViewRows(ctx, table.id);
      const viewIdByType = new Map(sourceViewRows.map((row) => [row.type, row.id] as const));
      const columnMeta = {
        [nameFieldId]: { order: 0, visible: true },
        [statusFieldId]: { order: 1, visible: true },
        [dueFieldId]: { order: 2, visible: true },
        [filesFieldId]: { order: 3, visible: true },
        [amountFieldId]: { order: 4, visible: true },
      };
      const gridFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: nameFieldId,
            operator: 'contains',
            value: 'A',
          },
          {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: amountFieldId,
                operator: 'isGreater',
                value: 1,
              },
            ],
          },
        ],
      };
      const gridSort = {
        sortObjs: [
          { fieldId: statusFieldId, order: 'asc' },
          { fieldId: amountFieldId, order: 'desc' },
        ],
      };
      const gridGroup = [{ fieldId: nameFieldId, order: 'asc' }];

      for (const row of sourceViewRows) {
        let options: Record<string, unknown> | undefined;
        if (row.type === 'grid') {
          options = { rowHeight: 'tall' };
        }
        if (row.type === 'gallery') {
          options = { coverFieldId: filesFieldId };
        }
        if (row.type === 'kanban') {
          options = { stackFieldId: statusFieldId };
        }
        if (row.type === 'calendar') {
          options = { startDateFieldId: dueFieldId, endDateFieldId: dueFieldId };
        }
        if (row.type === 'form') {
          options = { submitText: 'Send' };
        }
        if (row.type === 'plugin') {
          options = {
            pluginId: 'plg-sheet',
            pluginInstallId: 'pli-sheet',
            pluginLogo: 'logos/sheet.png',
          };
        }

        await ctx.testContainer.db
          .updateTable('view')
          .set({
            column_meta: JSON.stringify(columnMeta),
            sort: row.type === 'grid' ? JSON.stringify(gridSort) : null,
            filter: row.type === 'grid' ? JSON.stringify(gridFilter) : null,
            group: row.type === 'grid' ? JSON.stringify(gridGroup) : null,
            options: options ? JSON.stringify(options) : null,
          })
          .where('id', '=', row.id)
          .execute();
      }

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: table.id,
        name: nextName('v2-duplicate-views-copy'),
        includeRecords: false,
      });
      cleanupTableIds.push(duplicated.table.id);

      const sourceNormalized = normalizeViewRows(await listViewRows(ctx, table.id)).map((row) =>
        remapIds(row, duplicated.fieldIdMap)
      );
      const duplicatedNormalized = normalizeViewRows(await listViewRows(ctx, duplicated.table.id));

      expect(viewIdByType.get('grid')).toBeTruthy();
      expect(duplicatedNormalized).toHaveLength(sourceNormalized.length);
      expect(duplicatedNormalized).toEqual(sourceNormalized);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates records when the source table has persisted view row orders', async () => {
    const cleanupTableIds: string[] = [];

    const nameFieldId = createFieldId();

    try {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-row-orders'),
        fields: [{ id: nameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
        records: [{ fields: { [nameFieldId]: 'Alpha' } }, { fields: { [nameFieldId]: 'Beta' } }],
      });
      cleanupTableIds.push(source.id);

      const sourceViewId = source.views[0]?.id;
      if (!sourceViewId) {
        throw new Error('Missing source default view');
      }

      const sourceDbTableName = await getDbTableName(ctx, source.id);
      const sourceOrderColumn = `__row_${sourceViewId}`;
      await sql`
        ALTER TABLE ${sql.table(sourceDbTableName)}
        ADD COLUMN ${sql.id(sourceOrderColumn)} double precision
      `.execute(ctx.testContainer.db);

      const sourceRecords = await ctx.listRecords(source.id, { limit: 100 });
      const alphaRecord = sourceRecords.find((record) => record.fields[nameFieldId] === 'Alpha');
      const betaRecord = sourceRecords.find((record) => record.fields[nameFieldId] === 'Beta');
      if (!alphaRecord || !betaRecord) {
        throw new Error('Missing source records for row-order duplication test');
      }

      await sql`
        UPDATE ${sql.table(sourceDbTableName)}
        SET ${sql.id(sourceOrderColumn)} = CASE
          WHEN "__id" = ${alphaRecord.id} THEN 10
          WHEN "__id" = ${betaRecord.id} THEN 20
          ELSE ${sql.id(sourceOrderColumn)}
        END
      `.execute(ctx.testContainer.db);

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: source.id,
        name: nextName('v2-duplicate-row-orders-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);

      const duplicatedViewId = duplicated.viewIdMap[sourceViewId];
      if (!duplicatedViewId) {
        throw new Error('Missing duplicated default view id');
      }

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      const duplicatedAlpha = duplicatedRecords.find(
        (record) => record.fields[duplicated.fieldIdMap[nameFieldId]] === 'Alpha'
      );
      const duplicatedBeta = duplicatedRecords.find(
        (record) => record.fields[duplicated.fieldIdMap[nameFieldId]] === 'Beta'
      );
      if (!duplicatedAlpha || !duplicatedBeta) {
        throw new Error('Missing duplicated records for row-order duplication test');
      }

      const duplicatedDbTableName = await getDbTableName(ctx, duplicated.table.id);
      const duplicatedOrderColumn = `__row_${duplicatedViewId}`;
      const orderRows = await sql<{ __id: string; order_value: number | null }>`
        SELECT "__id", ${sql.id(duplicatedOrderColumn)} AS order_value
        FROM ${sql.table(duplicatedDbTableName)}
        ORDER BY ${sql.id(duplicatedOrderColumn)} ASC
      `.execute(ctx.testContainer.db);

      expect(orderRows.rows).toEqual([
        { __id: duplicatedAlpha.id, order_value: 10 },
        { __id: duplicatedBeta.id, order_value: 20 },
      ]);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates formula fields with working computed values on duplicated records', async () => {
    const cleanupTableIds: string[] = [];

    const nameFieldId = createFieldId();
    const numberFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-formula-relative'),
        fields: [
          { id: nameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: numberFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
          {
            id: formulaFieldId,
            name: 'Formula',
            type: 'formula',
            options: {
              expression: `{${numberFieldId}}`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
        records: [
          { fields: { [nameFieldId]: 'Alpha', [numberFieldId]: 1 } },
          { fields: { [nameFieldId]: 'Beta', [numberFieldId]: 2 } },
        ],
      });
      cleanupTableIds.push(table.id);

      await ctx.drainOutbox();

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: table.id,
        name: nextName('v2-duplicate-formula-relative-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);

      await ctx.drainOutbox();

      const duplicatedNumberFieldId = duplicated.fieldIdMap[numberFieldId];
      const duplicatedFormulaFieldId = duplicated.fieldIdMap[formulaFieldId];
      const initialRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      const initialByName = new Map(
        initialRecords.map((record) => [record.fields[duplicated.fieldIdMap[nameFieldId]], record])
      );

      expect(initialByName.get('Alpha')?.fields[duplicatedFormulaFieldId]).toBe(1);
      expect(initialByName.get('Beta')?.fields[duplicatedFormulaFieldId]).toBe(2);

      const betaRecord = initialByName.get('Beta');
      if (!betaRecord) {
        throw new Error('Missing duplicated beta record');
      }

      await ctx.updateRecord(duplicated.table.id, betaRecord.id, {
        [duplicatedNumberFieldId]: 3,
      });
      await ctx.drainOutbox();

      const updatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      const updatedByName = new Map(
        updatedRecords.map((record) => [record.fields[duplicated.fieldIdMap[nameFieldId]], record])
      );

      expect(updatedByName.get('Alpha')?.fields[duplicatedFormulaFieldId]).toBe(1);
      expect(updatedByName.get('Beta')?.fields[duplicatedFormulaFieldId]).toBe(3);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates cross-base link fields as one-way links', async () => {
    const cleanupDefaultBaseTableIds: string[] = [];
    const cleanupForeignTables: Array<{ baseId: string; tableId: string }> = [];

    const foreignNameFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const crossBaseLinkFieldId = createFieldId();

    try {
      const foreignBaseId = await createBase(ctx, nextName('v2-duplicate-cross-base'));

      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: nextName('v2-duplicate-cross-base-foreign-table'),
        fields: [{ id: foreignNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupForeignTables.push({ baseId: foreignBaseId, tableId: foreignTable.id });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-cross-base-host-table'),
        fields: [{ id: hostNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupDefaultBaseTableIds.push(hostTable.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          id: crossBaseLinkFieldId,
          name: 'Foreign Link',
          type: 'link',
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: false,
          },
        },
      });

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        name: nextName('v2-duplicate-cross-base-copy'),
        includeRecords: true,
      });
      cleanupDefaultBaseTableIds.push(duplicated.table.id);

      const duplicatedLinkField = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[crossBaseLinkFieldId]
      );
      expect(duplicatedLinkField?.type).toBe('link');
      if (!duplicatedLinkField || duplicatedLinkField.type !== 'link') {
        throw new Error('Missing duplicated cross-base link field');
      }
      expect(duplicatedLinkField.options.baseId).toBe(foreignBaseId);
      expect(duplicatedLinkField.options.foreignTableId).toBe(foreignTable.id);
      expect(duplicatedLinkField.options.isOneWay).toBe(true);
    } finally {
      for (const tableId of cleanupDefaultBaseTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
      for (const target of cleanupForeignTables.reverse()) {
        try {
          await deleteTableWithBaseId(ctx, target.baseId, target.tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });

  it('duplicates button fields without workflow and clears click count', async () => {
    const cleanupTableIds: string[] = [];

    const nameFieldId = createFieldId();
    const buttonFieldId = createFieldId();

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-button'),
        fields: [{ id: nameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(table.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          id: buttonFieldId,
          name: 'Run',
          type: 'button',
          options: {
            label: 'Run',
            color: 'teal',
            workflow: {
              id: 'wfl-v2-duplicate-button',
              name: 'Duplicate Button Workflow',
              isActive: true,
            },
          },
        },
      });

      const record = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Alpha',
      });

      await setRawFieldValue(ctx, table.id, record.id, buttonFieldId, { count: 1 });

      const sourceRecords = await ctx.listRecords(table.id, { limit: 100 });
      const sourceButtonValue = sourceRecords.find((item) => item.id === record.id)?.fields[
        buttonFieldId
      ];
      expect(normalizeButtonCellValue(sourceButtonValue)).toEqual({ count: 1 });

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: table.id,
        name: nextName('v2-duplicate-button-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);

      const duplicatedButtonFieldId = duplicated.fieldIdMap[buttonFieldId];
      const duplicatedButtonField = duplicated.table.fields.find(
        (field) => field.id === duplicatedButtonFieldId
      );
      expect(duplicatedButtonField?.type).toBe('button');
      if (!duplicatedButtonField || duplicatedButtonField.type !== 'button') {
        throw new Error('Missing duplicated button field');
      }
      expect(duplicatedButtonField.options.workflow).toBeUndefined();

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      const duplicatedByName = new Map(
        duplicatedRecords.map((item) => [item.fields[duplicated.fieldIdMap[nameFieldId]], item])
      );
      expectClearedButtonValue(duplicatedByName.get('Alpha')?.fields[duplicatedButtonFieldId]);
    } finally {
      for (const tableId of cleanupTableIds.reverse()) {
        try {
          await ctx.deleteTable(tableId);
        } catch {
          // best-effort cleanup for shared e2e context
        }
      }
    }
  });
});

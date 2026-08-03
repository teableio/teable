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

      // Physical bulk preserves __id; self-link endpoints stay valid without remapping.
      expect(duplicatedAlpha.id).toBe(alpha.id);
      expect(duplicatedBeta.id).toBe(beta.id);
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

  it('bulk path preserves source record ids and multi-field values without links', async () => {
    // Tables without link fields use INSERT…SELECT and keep source __id (V1 semantics).
    // Perf lab 10k cases exercise this path; this e2e locks the correctness contract.
    const cleanupTableIds: string[] = [];

    const nameFieldId = createFieldId();
    const amountFieldId = createFieldId();
    const notesFieldId = createFieldId();
    const doneFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    try {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-bulk-values'),
        fields: [
          { id: nameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: amountFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
          { id: notesFieldId, name: 'Notes', type: 'longText' },
          { id: doneFieldId, name: 'Done', type: 'checkbox' },
          {
            id: formulaFieldId,
            name: 'AmountPlusOne',
            type: 'formula',
            options: {
              expression: `{${amountFieldId}} + 1`,
              timeZone: 'Asia/Shanghai',
            },
          },
        ],
        records: [
          {
            fields: {
              [nameFieldId]: 'Alpha',
              [amountFieldId]: 10,
              [notesFieldId]: 'first',
              [doneFieldId]: true,
            },
          },
          {
            fields: {
              [nameFieldId]: 'Beta',
              [amountFieldId]: 20,
              [notesFieldId]: 'second',
            },
          },
        ],
      });
      cleanupTableIds.push(source.id);
      await ctx.drainOutbox();

      const sourceRecords = await ctx.listRecords(source.id, { limit: 100 });
      const sourceByName = new Map(
        sourceRecords.map((record) => [record.fields[nameFieldId], record] as const)
      );
      const sourceAlpha = sourceByName.get('Alpha');
      const sourceBeta = sourceByName.get('Beta');
      if (!sourceAlpha || !sourceBeta) {
        throw new Error('Missing source bulk-path records');
      }

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: source.id,
        name: nextName('v2-duplicate-bulk-values-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords).toHaveLength(2);

      // Physical bulk path preserves __id; hydrate path would mint new ids.
      const duplicatedIds = new Set(duplicatedRecords.map((record) => record.id));
      expect(duplicatedIds.has(sourceAlpha.id)).toBe(true);
      expect(duplicatedIds.has(sourceBeta.id)).toBe(true);

      const nameMapId = duplicated.fieldIdMap[nameFieldId];
      const amountMapId = duplicated.fieldIdMap[amountFieldId];
      const notesMapId = duplicated.fieldIdMap[notesFieldId];
      const doneMapId = duplicated.fieldIdMap[doneFieldId];
      const formulaMapId = duplicated.fieldIdMap[formulaFieldId];
      const byName = new Map(
        duplicatedRecords.map((record) => [record.fields[nameMapId], record] as const)
      );

      expect(byName.get('Alpha')?.fields[amountMapId]).toBe(10);
      expect(byName.get('Alpha')?.fields[notesMapId]).toBe('first');
      expect(byName.get('Alpha')?.fields[doneMapId]).toBe(true);
      expect(byName.get('Alpha')?.fields[formulaMapId]).toBe(11);

      expect(byName.get('Beta')?.fields[amountMapId]).toBe(20);
      expect(byName.get('Beta')?.fields[notesMapId]).toBe('second');
      expect(byName.get('Beta')?.fields[formulaMapId]).toBe(21);
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

  it('duplicates same-base cross-table link and lookup values with records', async () => {
    // External links use the physical bulk path (T6156): preserve __id and
    // bulk-copy junction/host FK storage. Lookup values must still resolve.
    const cleanupTableIds: string[] = [];

    const vendorNameFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const vendorLinkFieldId = createFieldId();
    const vendorNameLookupFieldId = createFieldId();

    try {
      const vendors = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-xtable-vendors'),
        fields: [{ id: vendorNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
        records: [
          { fields: { [vendorNameFieldId]: 'Acme' } },
          { fields: { [vendorNameFieldId]: 'Globex' } },
        ],
      });
      cleanupTableIds.push(vendors.id);

      const vendorRecords = await ctx.listRecords(vendors.id, { limit: 100 });
      const acme = vendorRecords.find((record) => record.fields[vendorNameFieldId] === 'Acme');
      const globex = vendorRecords.find((record) => record.fields[vendorNameFieldId] === 'Globex');
      if (!acme || !globex) {
        throw new Error('Missing vendor seed records');
      }

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-xtable-host'),
        fields: [{ id: hostNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(host.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          id: vendorLinkFieldId,
          name: 'Vendor',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: vendors.id,
            lookupFieldId: vendorNameFieldId,
            isOneWay: true,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
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

      await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Order-1',
        [vendorLinkFieldId]: [{ id: acme.id }, { id: globex.id }],
      });
      await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Order-2',
        [vendorLinkFieldId]: [{ id: acme.id }],
      });
      await ctx.drainOutbox();

      const sourceHostRecords = await ctx.listRecords(host.id, { limit: 100 });
      const sourceOrder1 = sourceHostRecords.find(
        (record) => record.fields[hostNameFieldId] === 'Order-1'
      );
      if (!sourceOrder1) {
        throw new Error('Missing source host records');
      }

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: host.id,
        name: nextName('v2-duplicate-xtable-host-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      const duplicatedLinkFieldId = duplicated.fieldIdMap[vendorLinkFieldId];
      const duplicatedLookupFieldId = duplicated.fieldIdMap[vendorNameLookupFieldId];
      const duplicatedNameFieldId = duplicated.fieldIdMap[hostNameFieldId];

      const duplicatedLinkField = duplicated.table.fields.find(
        (field) => field.id === duplicatedLinkFieldId
      );
      expect(duplicatedLinkField?.type).toBe('link');
      if (!duplicatedLinkField || duplicatedLinkField.type !== 'link') {
        throw new Error('Missing duplicated vendor link field');
      }
      expect(duplicatedLinkField.options.foreignTableId).toBe(vendors.id);

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords).toHaveLength(2);

      // Physical bulk path preserves host __id (T6156 external-link eligibility).
      const duplicatedIds = new Set(duplicatedRecords.map((record) => record.id));
      expect(duplicatedIds.has(sourceOrder1.id)).toBe(true);

      const byName = new Map(
        duplicatedRecords.map((record) => [record.fields[duplicatedNameFieldId], record] as const)
      );
      const order1 = byName.get('Order-1');
      const order2 = byName.get('Order-2');
      if (!order1 || !order2) {
        throw new Error('Missing duplicated host records');
      }
      expect(order1.id).toBe(sourceOrder1.id);

      // External foreign ids must be preserved (foreign table is not duplicated).
      expect(order1.fields[duplicatedLinkFieldId]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: acme.id }),
          expect.objectContaining({ id: globex.id }),
        ])
      );
      expect(order2.fields[duplicatedLinkFieldId]).toEqual([
        expect.objectContaining({ id: acme.id }),
      ]);

      const order1Lookup = order1.fields[duplicatedLookupFieldId];
      const order2Lookup = order2.fields[duplicatedLookupFieldId];
      const normalizeTitles = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value.map((entry) => String(entry));
        }
        if (value == null) {
          return [];
        }
        return [String(value)];
      };
      expect(normalizeTitles(order1Lookup).sort()).toEqual(['Acme', 'Globex']);
      expect(normalizeTitles(order2Lookup)).toEqual(['Acme']);

      // Foreign table remains untouched.
      const vendorsAfter = await ctx.listRecords(vendors.id, { limit: 100 });
      expect(vendorsAfter.map((record) => record.id).sort()).toEqual([acme.id, globex.id].sort());
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

  it('duplicates cross-base link fields as one-way links and preserves foreign record refs', async () => {
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

      const remoteA = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Remote-A',
      });
      const remoteB = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Remote-B',
      });
      const remoteAId = remoteA.id;
      const remoteBId = remoteB.id;

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

      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-1',
        [crossBaseLinkFieldId]: { id: remoteAId },
      });
      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host-2',
        [crossBaseLinkFieldId]: { id: remoteBId },
      });
      await ctx.drainOutbox();

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        name: nextName('v2-duplicate-cross-base-copy'),
        includeRecords: true,
      });
      cleanupDefaultBaseTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      const duplicatedLinkField = duplicated.table.fields.find(
        (field) => field.id === duplicated.fieldIdMap[crossBaseLinkFieldId]
      );
      expect(duplicatedLinkField?.type).toBe('link');
      if (!duplicatedLinkField || duplicatedLinkField.type !== 'link') {
        throw new Error('Missing duplicated cross-base link field');
      }
      expect(duplicatedLinkField.options.baseId).toBe(foreignBaseId);
      expect(duplicatedLinkField.options.foreignTableId).toBe(foreignTable.id);
      // Cross-base two-way becomes one-way on the duplicated host table.
      expect(duplicatedLinkField.options.isOneWay).toBe(true);

      const duplicatedLinkFieldId = duplicated.fieldIdMap[crossBaseLinkFieldId];
      const duplicatedNameFieldId = duplicated.fieldIdMap[hostNameFieldId];
      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords).toHaveLength(2);
      const byName = new Map(
        duplicatedRecords.map((record) => [record.fields[duplicatedNameFieldId], record] as const)
      );

      expect(byName.get('Host-1')?.fields[duplicatedLinkFieldId]).toEqual(
        expect.objectContaining({ id: remoteAId })
      );
      expect(byName.get('Host-2')?.fields[duplicatedLinkFieldId]).toEqual(
        expect.objectContaining({ id: remoteBId })
      );
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

  it('two-way manyOne cross-table duplicate becomes one-way and leaves foreign symmetric intact', async () => {
    // External two-way links are rewritten to one-way on the duplicated table.
    // Foreign-side symmetric must keep pointing only at the original host records.
    const cleanupTableIds: string[] = [];

    const foreignNameFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const hostLinkFieldId = createFieldId();

    try {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-twoway-foreign'),
        fields: [{ id: foreignNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(foreign.id);

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-twoway-host'),
        fields: [{ id: hostNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(host.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          id: hostLinkFieldId,
          name: 'Partner',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: false,
          },
        },
      });

      const hostAfterLink = await ctx.getTableById(host.id);
      const hostLinkField = hostAfterLink.fields.find((field) => field.id === hostLinkFieldId);
      if (!hostLinkField || hostLinkField.type !== 'link') {
        throw new Error('Missing host two-way link field');
      }
      const symmetricFieldId = hostLinkField.options.symmetricFieldId;
      if (!symmetricFieldId) {
        throw new Error('Missing foreign symmetric field id');
      }

      const foreignF1 = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'F1' });
      const foreignF2 = await ctx.createRecord(foreign.id, { [foreignNameFieldId]: 'F2' });
      const hostH1 = await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'H1',
        [hostLinkFieldId]: { id: foreignF1.id },
      });
      const hostH2 = await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'H2',
        [hostLinkFieldId]: { id: foreignF2.id },
      });
      await ctx.drainOutbox();

      // Precondition: foreign symmetric points at original host records.
      const foreignBefore = await ctx.listRecords(foreign.id, { limit: 100 });
      const f1Before = foreignBefore.find((record) => record.id === foreignF1.id);
      const f2Before = foreignBefore.find((record) => record.id === foreignF2.id);
      expect(f1Before?.fields[symmetricFieldId]).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: hostH1.id })])
      );
      expect(f2Before?.fields[symmetricFieldId]).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: hostH2.id })])
      );

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: host.id,
        name: nextName('v2-duplicate-twoway-host-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      const duplicatedLinkFieldId = duplicated.fieldIdMap[hostLinkFieldId];
      const duplicatedLinkField = duplicated.table.fields.find(
        (field) => field.id === duplicatedLinkFieldId
      );
      expect(duplicatedLinkField?.type).toBe('link');
      if (!duplicatedLinkField || duplicatedLinkField.type !== 'link') {
        throw new Error('Missing duplicated two-way→one-way link');
      }
      expect(duplicatedLinkField.options.foreignTableId).toBe(foreign.id);
      expect(duplicatedLinkField.options.isOneWay).toBe(true);
      expect(duplicatedLinkField.options.symmetricFieldId).toBeUndefined();

      const duplicatedNameFieldId = duplicated.fieldIdMap[hostNameFieldId];
      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords).toHaveLength(2);
      const byName = new Map(
        duplicatedRecords.map((record) => [record.fields[duplicatedNameFieldId], record] as const)
      );
      expect(byName.get('H1')?.fields[duplicatedLinkFieldId]).toEqual(
        expect.objectContaining({ id: foreignF1.id })
      );
      expect(byName.get('H2')?.fields[duplicatedLinkFieldId]).toEqual(
        expect.objectContaining({ id: foreignF2.id })
      );

      // Foreign symmetric must not pick up duplicated host ids.
      const foreignAfter = await ctx.listRecords(foreign.id, { limit: 100 });
      const f1After = foreignAfter.find((record) => record.id === foreignF1.id);
      const f2After = foreignAfter.find((record) => record.id === foreignF2.id);
      const f1Symmetric = f1After?.fields[symmetricFieldId];
      const f2Symmetric = f2After?.fields[symmetricFieldId];
      const collectIds = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value
            .map((entry) =>
              entry && typeof entry === 'object' && 'id' in entry
                ? String((entry as { id: unknown }).id)
                : undefined
            )
            .filter((id): id is string => Boolean(id));
        }
        if (value && typeof value === 'object' && 'id' in value) {
          return [String((value as { id: unknown }).id)];
        }
        return [];
      };
      // Symmetric still only references the original host records. Physical bulk
      // preserves host __id, so duplicated row ids equal source host ids — that is
      // expected and does not mean the foreign table gained new reverse links.
      expect(collectIds(f1Symmetric).sort()).toEqual([hostH1.id].sort());
      expect(collectIds(f2Symmetric).sort()).toEqual([hostH2.id].sort());
      expect(byName.get('H1')?.id).toBe(hostH1.id);
      expect(byName.get('H2')?.id).toBe(hostH2.id);
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

  it.each([
    {
      relationship: 'manyOne' as const,
      cell: (foreignId: string) => ({ id: foreignId }),
      expectCell: (foreignId: string) => expect.objectContaining({ id: foreignId }),
    },
    {
      relationship: 'oneOne' as const,
      cell: (foreignId: string) => ({ id: foreignId }),
      expectCell: (foreignId: string) => expect.objectContaining({ id: foreignId }),
    },
    {
      relationship: 'oneMany' as const,
      cell: (foreignId: string) => [{ id: foreignId }],
      expectCell: (foreignId: string) => [expect.objectContaining({ id: foreignId })],
    },
  ])(
    'duplicates one-way $relationship cross-table link record values',
    async ({ relationship, cell, expectCell }) => {
      const cleanupTableIds: string[] = [];
      const foreignNameFieldId = createFieldId();
      const hostNameFieldId = createFieldId();
      const linkFieldId = createFieldId();

      try {
        const foreign = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName(`v2-duplicate-rel-${relationship}-foreign`),
          fields: [
            { id: foreignNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          ],
        });
        cleanupTableIds.push(foreign.id);
        const foreignRecord = await ctx.createRecord(foreign.id, {
          [foreignNameFieldId]: 'Target',
        });

        const host = await ctx.createTable({
          baseId: ctx.baseId,
          name: nextName(`v2-duplicate-rel-${relationship}-host`),
          fields: [{ id: hostNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
        });
        cleanupTableIds.push(host.id);

        await ctx.createField({
          baseId: ctx.baseId,
          tableId: host.id,
          field: {
            id: linkFieldId,
            name: 'Link',
            type: 'link',
            options: {
              relationship,
              foreignTableId: foreign.id,
              lookupFieldId: foreignNameFieldId,
              isOneWay: true,
            },
          },
        });

        await ctx.createRecord(host.id, {
          [hostNameFieldId]: 'Host',
          [linkFieldId]: cell(foreignRecord.id),
        });
        await ctx.drainOutbox();

        const duplicated = await ctx.duplicateTable({
          baseId: ctx.baseId,
          tableId: host.id,
          name: nextName(`v2-duplicate-rel-${relationship}-copy`),
          includeRecords: true,
        });
        cleanupTableIds.push(duplicated.table.id);
        await ctx.drainOutbox();

        const duplicatedLinkFieldId = duplicated.fieldIdMap[linkFieldId];
        const duplicatedNameFieldId = duplicated.fieldIdMap[hostNameFieldId];
        const duplicatedLinkField = duplicated.table.fields.find(
          (field) => field.id === duplicatedLinkFieldId
        );
        expect(duplicatedLinkField?.type).toBe('link');
        if (!duplicatedLinkField || duplicatedLinkField.type !== 'link') {
          throw new Error(`Missing duplicated ${relationship} link field`);
        }
        expect(duplicatedLinkField.options.relationship).toBe(relationship);
        expect(duplicatedLinkField.options.foreignTableId).toBe(foreign.id);
        expect(duplicatedLinkField.options.isOneWay).toBe(true);

        const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
        expect(duplicatedRecords).toHaveLength(1);
        expect(duplicatedRecords[0]?.fields[duplicatedNameFieldId]).toBe('Host');
        expect(duplicatedRecords[0]?.fields[duplicatedLinkFieldId]).toEqual(
          expectCell(foreignRecord.id)
        );
      } finally {
        for (const tableId of cleanupTableIds.reverse()) {
          try {
            await ctx.deleteTable(tableId);
          } catch {
            // best-effort cleanup for shared e2e context
          }
        }
      }
    }
  );

  it('duplicates rollup values with link-based records', async () => {
    const cleanupTableIds: string[] = [];

    const foreignNameFieldId = createFieldId();
    const foreignAmountFieldId = createFieldId();
    const hostNameFieldId = createFieldId();
    const linkFieldId = createFieldId();
    const rollupFieldId = createFieldId();

    try {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-rollup-foreign'),
        fields: [
          { id: foreignNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: foreignAmountFieldId,
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
        ],
      });
      cleanupTableIds.push(foreign.id);

      const itemA = await ctx.createRecord(foreign.id, {
        [foreignNameFieldId]: 'A',
        [foreignAmountFieldId]: 3,
      });
      const itemB = await ctx.createRecord(foreign.id, {
        [foreignNameFieldId]: 'B',
        [foreignAmountFieldId]: 7,
      });

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-rollup-host'),
        fields: [{ id: hostNameFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      });
      cleanupTableIds.push(host.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          id: linkFieldId,
          name: 'Items',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreign.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      });

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          id: rollupFieldId,
          name: 'Total',
          type: 'rollup',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreign.id,
            lookupFieldId: foreignAmountFieldId,
          },
        },
      });

      await ctx.createRecord(host.id, {
        [hostNameFieldId]: 'Order',
        [linkFieldId]: [{ id: itemA.id }, { id: itemB.id }],
      });
      await ctx.drainOutbox();

      const sourceRecords = await ctx.listRecords(host.id, { limit: 100 });
      expect(sourceRecords[0]?.fields[rollupFieldId]).toBe(10);

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: host.id,
        name: nextName('v2-duplicate-rollup-host-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      const duplicatedLinkFieldId = duplicated.fieldIdMap[linkFieldId];
      const duplicatedRollupFieldId = duplicated.fieldIdMap[rollupFieldId];
      const duplicatedNameFieldId = duplicated.fieldIdMap[hostNameFieldId];

      const duplicatedRollupField = duplicated.table.fields.find(
        (field) => field.id === duplicatedRollupFieldId
      );
      expect(duplicatedRollupField?.type).toBe('rollup');
      expect(duplicatedRollupField).toMatchObject({
        type: 'rollup',
        options: expect.objectContaining({ expression: 'sum({values})' }),
      });
      // Rollup config must point at remapped link field and original foreign table/field.
      expect(
        (duplicatedRollupField as { lookupOptions?: Record<string, unknown> } | undefined)
          ?.lookupOptions ??
          (duplicatedRollupField as { config?: Record<string, unknown> } | undefined)?.config
      ).toEqual(
        expect.objectContaining({
          linkFieldId: duplicatedLinkFieldId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignAmountFieldId,
        })
      );

      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords).toHaveLength(1);
      expect(duplicatedRecords[0]?.fields[duplicatedNameFieldId]).toBe('Order');
      expect(duplicatedRecords[0]?.fields[duplicatedLinkFieldId]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: itemA.id }),
          expect.objectContaining({ id: itemB.id }),
        ])
      );
      expect(duplicatedRecords[0]?.fields[duplicatedRollupFieldId]).toBe(10);
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

  it('duplicates conditional lookup values without link fields (bulk path)', async () => {
    // No link field → INSERT…SELECT bulk path, but still remaps conditional field refs.
    const cleanupTableIds: string[] = [];

    const foreignTitleFieldId = createFieldId();
    const foreignStatusFieldId = createFieldId();
    const hostFilterFieldId = createFieldId();
    const conditionalLookupFieldId = createFieldId();

    try {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-cond-foreign'),
        fields: [
          { id: foreignTitleFieldId, name: 'Title', type: 'singleLineText', isPrimary: true },
          { id: foreignStatusFieldId, name: 'Status', type: 'singleLineText' },
        ],
        records: [
          { fields: { [foreignTitleFieldId]: 'Alpha', [foreignStatusFieldId]: 'Active' } },
          { fields: { [foreignTitleFieldId]: 'Beta', [foreignStatusFieldId]: 'Active' } },
          { fields: { [foreignTitleFieldId]: 'Gamma', [foreignStatusFieldId]: 'Closed' } },
        ],
      });
      cleanupTableIds.push(foreign.id);

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-duplicate-cond-host'),
        fields: [
          { id: hostFilterFieldId, name: 'StatusFilter', type: 'singleLineText', isPrimary: true },
        ],
        records: [
          { fields: { [hostFilterFieldId]: 'Active' } },
          { fields: { [hostFilterFieldId]: 'Closed' } },
        ],
      });
      cleanupTableIds.push(host.id);

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          id: conditionalLookupFieldId,
          name: 'Matching Titles',
          type: 'conditionalLookup',
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignTitleFieldId,
            condition: {
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignStatusFieldId,
                    operator: 'is',
                    value: hostFilterFieldId,
                    isSymbol: true,
                  },
                ],
              },
            },
          },
        },
      });
      await ctx.drainOutbox();

      const sourceRecords = await ctx.listRecords(host.id, { limit: 100 });
      const sourceActive = sourceRecords.find(
        (record) => record.fields[hostFilterFieldId] === 'Active'
      );
      const sourceClosed = sourceRecords.find(
        (record) => record.fields[hostFilterFieldId] === 'Closed'
      );
      expect(sourceActive?.fields[conditionalLookupFieldId]).toEqual(['Alpha', 'Beta']);
      expect(sourceClosed?.fields[conditionalLookupFieldId]).toEqual(['Gamma']);
      if (!sourceActive || !sourceClosed) {
        throw new Error('Missing conditional lookup source records');
      }

      const duplicated = await ctx.duplicateTable({
        baseId: ctx.baseId,
        tableId: host.id,
        name: nextName('v2-duplicate-cond-host-copy'),
        includeRecords: true,
      });
      cleanupTableIds.push(duplicated.table.id);
      await ctx.drainOutbox();

      // Bulk path: same record ids as source.
      const duplicatedRecords = await ctx.listRecords(duplicated.table.id, { limit: 100 });
      expect(duplicatedRecords.map((record) => record.id).sort()).toEqual(
        [sourceActive.id, sourceClosed.id].sort()
      );

      const duplicatedFilterFieldId = duplicated.fieldIdMap[hostFilterFieldId];
      const duplicatedLookupFieldId = duplicated.fieldIdMap[conditionalLookupFieldId];
      const duplicatedLookupField = duplicated.table.fields.find(
        (field) => field.id === duplicatedLookupFieldId
      ) as
        | {
            type?: string;
            isLookup?: boolean;
            conditionalLookupOptions?: {
              foreignTableId?: string;
              lookupFieldId?: string;
              condition?: unknown;
            };
          }
        | undefined;
      // Conditional lookup is exposed as the lookup target cell type + flags, not type='conditionalLookup'.
      expect(duplicatedLookupField?.isLookup).toBe(true);
      expect(duplicatedLookupField?.conditionalLookupOptions).toEqual(
        expect.objectContaining({
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
        })
      );
      // Host field reference inside condition must remap to the duplicated filter field.
      const conditionJson = JSON.stringify(duplicatedLookupField?.conditionalLookupOptions ?? {});
      expect(conditionJson).toContain(duplicatedFilterFieldId);
      expect(conditionJson).not.toContain(hostFilterFieldId);

      const byFilter = new Map(
        duplicatedRecords.map((record) => [record.fields[duplicatedFilterFieldId], record] as const)
      );
      expect(byFilter.get('Active')?.fields[duplicatedLookupFieldId]).toEqual(['Alpha', 'Beta']);
      expect(byFilter.get('Closed')?.fields[duplicatedLookupFieldId]).toEqual(['Gamma']);
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

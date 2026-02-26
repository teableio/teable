/**
 * E2E tests for Link field updates.
 *
 * Link field updates are complex because they affect:
 * - Junction tables (for manyMany relationships)
 * - Foreign key columns (for oneMany relationships)
 * - Symmetric link fields (for twoWay links)
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('update-field: link property updates', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let sourcePrimaryFieldId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create source table
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Link Source Table',
      fields: [{ type: 'singleLineText', name: 'Source Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;
    const sourcePrimary = sourceTable.fields.find((f) => f.isPrimary);
    if (!sourcePrimary) throw new Error('No source primary field');
    sourcePrimaryFieldId = sourcePrimary.id;

    // Create foreign table
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Link Foreign Table',
      fields: [{ type: 'singleLineText', name: 'Foreign Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    // Cleanup tables
    try {
      if (sourceTableId) await ctx.deleteTable(sourceTableId);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // Ignore cleanup errors
    }
  });

  const getActiveFieldRowCountFromDb = async (fieldId: string): Promise<number> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM field
      WHERE id = ${fieldId}
      AND deleted_time IS NULL
    `.execute(ctx.testContainer.db);
    return parseInt(result.rows[0].count, 10);
  };

  const getJunctionTableNameByFieldId = async (fieldId: string): Promise<string | undefined> => {
    const result = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name LIKE ${'junction_%'}
    `.execute(ctx.testContainer.db);

    return result.rows.find((r) => r.table_name.includes(fieldId))?.table_name;
  };

  const getJunctionRows = async (
    junctionTableName: string
  ): Promise<Array<Record<string, unknown>>> => {
    const result = await sql`
      SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
    `.execute(ctx.testContainer.db);

    return result.rows as Array<Record<string, unknown>>;
  };

  const hasTableInBase = async (tableName: string): Promise<boolean> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableName}
    `.execute(ctx.testContainer.db);

    return parseInt(result.rows[0].count, 10) > 0;
  };

  const hasFkColumnInTable = async (tableId: string, fieldId: string): Promise<boolean> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM information_schema.columns
      WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableId}
      AND column_name = ${`__fk_${fieldId}`}
    `.execute(ctx.testContainer.db);

    return parseInt(result.rows[0].count, 10) > 0;
  };

  const getFkValueByRecordId = async (
    tableId: string,
    fieldId: string,
    recordId: string
  ): Promise<string | null> => {
    const result = await sql<{ fk_value: string | null }>`
      SELECT ${sql.ref(`__fk_${fieldId}`)} as fk_value
      FROM ${sql.table(`${ctx.baseId}.${tableId}`)}
      WHERE "__id" = ${recordId}
    `.execute(ctx.testContainer.db);

    if (result.rows.length !== 1) {
      throw new Error(`Expected one record for ${recordId}, got ${result.rows.length}`);
    }

    return result.rows[0].fk_value;
  };

  // ============ Name updates ============

  test('should update link field name', async () => {
    // Setup: Create oneWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Original Link Name',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'Original Link Name');
    if (!linkField) throw new Error('Link field not found');

    // Action: Update name
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        name: 'Renamed Link',
      },
    });

    // Assert: Name changed
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.name).toBe('Renamed Link');
    expect(updatedField?.type).toBe('link');

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  // ============ Relationship type changes - oneWay/twoWay ============

  test('should convert oneWay to twoWay', async () => {
    // Setup: Create oneWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'OneWay Link',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'OneWay Link');
    if (!linkField) throw new Error('Link field not found');

    // Action: Convert to twoWay
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    // Assert: Link field updated
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const fieldOptions = updatedField?.options as { isOneWay?: boolean; symmetricFieldId?: string };
    expect(fieldOptions?.isOneWay).toBe(false);
    expect(fieldOptions?.symmetricFieldId).toBeDefined();

    // Assert: Symmetric field created in foreign table
    const foreignTableAfter = await ctx.getTableById(foreignTableId);
    const symField = foreignTableAfter.fields.find((f) => f.id === fieldOptions?.symmetricFieldId);
    expect(symField).toBeDefined();
    expect(symField?.type).toBe('link');
    // Verify symmetric field points back to source table
    const symOptions = symField?.options as { foreignTableId?: string; symmetricFieldId?: string };
    expect(symOptions?.foreignTableId).toBe(sourceTableId);
    expect(symOptions?.symmetricFieldId).toBe(linkField.id);

    expect(await getActiveFieldRowCountFromDb(fieldOptions!.symmetricFieldId!)).toBe(1);
    const junctionTableName = await getJunctionTableNameByFieldId(linkField.id);
    expect(junctionTableName).toBeDefined();

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should convert twoWay to oneWay', async () => {
    // Setup: Create twoWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'TwoWay Link',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'TwoWay Link');
    if (!linkField) throw new Error('Link field not found');
    const fieldOptions = linkField.options as { symmetricFieldId?: string };
    const symFieldId = fieldOptions?.symmetricFieldId;
    expect(symFieldId).toBeDefined();

    // Create linked records
    const foreignRec = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign Record 2',
    });
    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source Record 2',
      [linkField.id]: [{ id: foreignRec.id }],
    });
    await ctx.drainOutbox();

    // Action: Convert to oneWay
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    // Assert: Link field updated
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const newOptions = updatedField?.options as { isOneWay?: boolean; symmetricFieldId?: string };
    expect(newOptions?.isOneWay).toBe(true);
    expect(newOptions?.symmetricFieldId).toBeUndefined();

    // Assert: Symmetric field deleted from foreign table
    const foreignTableAfter = await ctx.getTableById(foreignTableId);
    const symFieldAfter = foreignTableAfter.fields.find((f) => f.id === symFieldId);
    expect(symFieldAfter).toBeUndefined();

    // Assert: Source links preserved
    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const linkValue = sourceRecAfter?.fields[linkField.id] as Array<{ id: string }>;
    expect(linkValue?.[0]?.id).toBe(foreignRec.id);

    expect(await getActiveFieldRowCountFromDb(symFieldId!)).toBe(0);

    // Cleanup
    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRec.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  // ============ Relationship type changes - junction/FK ============

  test('should convert manyMany oneWay to oneMany oneWay (metadata-only, same storage)', async () => {
    // Setup: Create manyMany oneWay link with records having multiple links
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'ManyMany Link',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'ManyMany Link');
    if (!linkField) throw new Error('Link field not found');

    // Create foreign records
    const foreign1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign A',
    });
    const foreign2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign B',
    });
    // Link multiple foreign records to one source record
    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source with many links',
      [linkField.id]: [{ id: foreign1.id }, { id: foreign2.id }],
    });
    await ctx.drainOutbox();

    // Action: Convert to oneMany
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const newOptions = updatedField?.options as { relationship?: string };
    expect(newOptions?.relationship).toBe('oneMany');

    // Assert: Links preserved (oneWay manyMany and oneWay oneMany use same junction table)
    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const linkValue = sourceRecAfter?.fields[linkField.id] as Array<{ id: string }>;
    // oneMany allows multiple links from source to foreign, so all should be kept
    expect(linkValue?.length).toBeGreaterThan(0);

    // Cleanup
    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreign1.id, foreign2.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should convert oneMany oneWay to manyMany oneWay (metadata-only, same storage)', async () => {
    // Setup: Create oneMany oneWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'OneMany Link',
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'OneMany Link');
    if (!linkField) throw new Error('Link field not found');

    // Create linked record
    const foreignRec = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign for OneMany',
    });
    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source for OneMany',
      [linkField.id]: [{ id: foreignRec.id }],
    });
    await ctx.drainOutbox();

    // Action: Convert to manyMany
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    // Assert: Field type changed
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const newOptions = updatedField?.options as { relationship?: string };
    expect(newOptions?.relationship).toBe('manyMany');

    // Assert: Existing links preserved
    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const linkValue = sourceRecAfter?.fields[linkField.id] as Array<{ id: string }>;
    expect(linkValue?.[0]?.id).toBe(foreignRec.id);

    // Cleanup
    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRec.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should convert manyMany twoWay to oneMany twoWay (junction to FK)', async () => {
    // Setup: Create manyMany twoWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'ManyMany TwoWay',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'ManyMany TwoWay');
    if (!linkField) throw new Error('Link field not found');
    const linkOptions = linkField.options as {
      symmetricFieldId?: string;
      relationship?: string;
    };
    expect(linkOptions.symmetricFieldId).toBeDefined();
    const symFieldId = linkOptions.symmetricFieldId!;

    // Create linked records
    const foreign1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign TW A',
    });
    const foreign2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign TW B',
    });
    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source TW',
      [linkField.id]: [{ id: foreign1.id }, { id: foreign2.id }],
    });
    await ctx.drainOutbox();

    const oldJunctionTable = await getJunctionTableNameByFieldId(linkField.id);

    // Action: Convert to oneMany twoWay
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    // Assert: Field relationship changed
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const newOptions = updatedField?.options as {
      relationship?: string;
      isOneWay?: boolean;
      symmetricFieldId?: string;
    };
    expect(newOptions?.relationship).toBe('oneMany');
    expect(newOptions?.isOneWay).toBe(false);
    expect(newOptions?.symmetricFieldId).toBe(symFieldId);

    // Assert: Symmetric field updated with reversed relationship
    const foreignTableAfter = await ctx.getTableById(foreignTableId);
    const symField = foreignTableAfter.fields.find((f) => f.id === symFieldId);
    expect(symField).toBeDefined();
    expect(symField?.type).toBe('link');
    const symOptions = symField?.options as {
      relationship?: string;
      foreignTableId?: string;
      symmetricFieldId?: string;
    };
    expect(symOptions?.relationship).toBe('manyOne');
    expect(symOptions?.foreignTableId).toBe(sourceTableId);
    expect(symOptions?.symmetricFieldId).toBe(linkField.id);

    // Assert: Links preserved
    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const linkValue = sourceRecAfter?.fields[linkField.id] as Array<{ id: string }>;
    expect(linkValue?.length).toBeGreaterThan(0);

    expect(await hasFkColumnInTable(foreignTableId, symFieldId)).toBe(true);
    expect(await getFkValueByRecordId(foreignTableId, symFieldId, foreign1.id)).toBe(sourceRec.id);
    expect(await getFkValueByRecordId(foreignTableId, symFieldId, foreign2.id)).toBe(sourceRec.id);

    if (oldJunctionTable && (await hasTableInBase(oldJunctionTable))) {
      const oldJunctionRows = await getJunctionRows(oldJunctionTable);
      const matchingRows = oldJunctionRows.filter((r) => Object.values(r).includes(sourceRec.id));
      expect(matchingRows.length).toBe(0);
    }

    // Cleanup
    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreign1.id, foreign2.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should convert oneMany twoWay to manyMany twoWay (FK to junction)', async () => {
    // Setup: Create oneMany twoWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'OneMany TwoWay',
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'OneMany TwoWay');
    if (!linkField) throw new Error('Link field not found');
    const linkOptions = linkField.options as {
      symmetricFieldId?: string;
      relationship?: string;
    };
    expect(linkOptions.symmetricFieldId).toBeDefined();
    const symFieldId = linkOptions.symmetricFieldId!;

    // Create linked records
    const foreignRec = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Foreign for OM TW',
    });
    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source for OM TW',
      [linkField.id]: [{ id: foreignRec.id }],
    });
    await ctx.drainOutbox();

    expect(await hasFkColumnInTable(foreignTableId, symFieldId)).toBe(true);
    expect(await getFkValueByRecordId(foreignTableId, symFieldId, foreignRec.id)).toBe(
      sourceRec.id
    );

    // Action: Convert to manyMany twoWay
    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    // Assert: Field relationship changed
    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('link');
    const newOptions = updatedField?.options as {
      relationship?: string;
      isOneWay?: boolean;
      symmetricFieldId?: string;
    };
    expect(newOptions?.relationship).toBe('manyMany');
    expect(newOptions?.isOneWay).toBe(false);
    expect(newOptions?.symmetricFieldId).toBe(symFieldId);

    // Assert: Symmetric field updated with reversed relationship
    const foreignTableAfter = await ctx.getTableById(foreignTableId);
    const symField = foreignTableAfter.fields.find((f) => f.id === symFieldId);
    expect(symField).toBeDefined();
    expect(symField?.type).toBe('link');
    const symOptions = symField?.options as {
      relationship?: string;
      foreignTableId?: string;
      symmetricFieldId?: string;
    };
    expect(symOptions?.relationship).toBe('manyMany');
    expect(symOptions?.foreignTableId).toBe(sourceTableId);
    expect(symOptions?.symmetricFieldId).toBe(linkField.id);

    // Assert: Links preserved
    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const linkValue = sourceRecAfter?.fields[linkField.id] as Array<{ id: string }>;
    expect(linkValue?.[0]?.id).toBe(foreignRec.id);

    const newJunctionTable = await getJunctionTableNameByFieldId(linkField.id);
    expect(newJunctionTable).toBeDefined();
    const junctionRows = await getJunctionRows(newJunctionTable!);
    const matchingRows = junctionRows.filter(
      (r) => Object.values(r).includes(sourceRec.id) && Object.values(r).includes(foreignRec.id)
    );
    expect(matchingRows.length).toBe(1);

    // Cleanup
    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreignRec.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should clean link filter after foreign filtering field is converted', async () => {
    const foreignWithStatus = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'singleSelect',
        name: 'Filter Status',
        options: {
          choices: [{ name: 'x', color: 'blue' }],
        },
      },
    });
    const statusField = foreignWithStatus.fields.find((f) => f.name === 'Filter Status');
    if (!statusField) throw new Error('Status field not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Filtered Link',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'x' }],
          },
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Filtered Link');
    if (!linkField) throw new Error('Link field not found');

    const linkOptions = linkField.options as { filter?: unknown | null };
    expect(linkOptions.filter).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'x' }],
    });

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: statusField.id,
      field: {
        type: 'multipleSelect',
      },
    });

    const sourceAfter = await ctx.getTableById(sourceTableId);
    const linkAfter = sourceAfter.fields.find((f) => f.id === linkField.id);
    expect(linkAfter).toBeDefined();
    const linkAfterOptions = linkAfter?.options as { filter?: unknown | null };
    expect(linkAfterOptions.filter).toBeNull();

    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: statusField.id });
  });

  test('should update link filter option values when referenced select option names change', async () => {
    const foreignWithStatus = await ctx.createField({
      baseId: ctx.baseId,
      tableId: foreignTableId,
      field: {
        type: 'singleSelect',
        name: 'Filter Status Rename',
        options: {
          choices: [
            { id: 'cho_active', name: 'Active', color: 'green' },
            { id: 'cho_closed', name: 'Closed', color: 'blue' },
          ],
        },
      },
    });
    const statusField = foreignWithStatus.fields.find((f) => f.name === 'Filter Status Rename');
    if (!statusField) throw new Error('Status field not found');

    const sourceWithLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Filtered Link Rename',
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: statusField.id, operator: 'is', value: 'Active' }],
          },
        },
      },
    });
    const linkField = sourceWithLink.fields.find((f) => f.name === 'Filtered Link Rename');
    if (!linkField) throw new Error('Link field not found');

    await ctx.updateField({
      tableId: foreignTableId,
      fieldId: statusField.id,
      field: {
        options: {
          choices: [
            { id: 'cho_active', name: 'Active Plus', color: 'green' },
            { id: 'cho_closed', name: 'Closed', color: 'blue' },
          ],
        },
      },
    });

    const sourceAfter = await ctx.getTableById(sourceTableId);
    const linkAfter = sourceAfter.fields.find((f) => f.id === linkField.id);
    expect(linkAfter).toBeDefined();

    const linkAfterOptions = linkAfter?.options as {
      filter?: {
        filterSet?: Array<{ fieldId?: string; operator?: string; value?: unknown }>;
      } | null;
    };
    expect(linkAfterOptions.filter?.filterSet?.[0]).toEqual({
      fieldId: statusField.id,
      operator: 'is',
      value: 'Active Plus',
    });

    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
    await ctx.deleteField({ tableId: foreignTableId, fieldId: statusField.id });
  });

  // ============ hasOrderColumn meta persistence ============
  //
  // `meta` (e.g. hasOrderColumn) is an internal property managed by domain logic.
  // It is NOT part of the public API contract (not in contract-http field DTO schema)
  // and must never be exposed for API updates. These tests read the DB directly to
  // verify that the internal meta is persisted correctly after link field conversions.

  /**
   * Read hasOrderColumn from the `field.meta` DB column directly.
   * meta is internal — not in the public API contract schema.
   */
  const getHasOrderColumnFromDb = async (fieldId: string): Promise<boolean> => {
    const row = await ctx.testContainer.db
      .selectFrom('field')
      .select('meta')
      .where('id', '=', fieldId)
      .executeTakeFirstOrThrow();
    const meta = row.meta ? (JSON.parse(row.meta) as { hasOrderColumn?: boolean }) : null;
    return meta?.hasOrderColumn ?? false;
  };

  test('should set hasOrderColumn to false for oneMany oneWay, then true after converting to twoWay', async () => {
    // Setup: Create oneMany oneWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'OrderCol OneWay Link',
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'OrderCol OneWay Link');
    if (!linkField) throw new Error('Link field not found');

    // Assert: oneMany + oneWay -> hasOrderColumn should be false
    expect(await getHasOrderColumnFromDb(linkField.id)).toBe(false);

    // Action: Convert to twoWay
    await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });

    // Assert: oneMany + twoWay -> hasOrderColumn should be true
    expect(await getHasOrderColumnFromDb(linkField.id)).toBe(true);

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should set hasOrderColumn to true for oneMany twoWay, then false after converting to oneWay', async () => {
    // Setup: Create oneMany twoWay link field
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'OrderCol TwoWay Link',
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: false,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'OrderCol TwoWay Link');
    if (!linkField) throw new Error('Link field not found');

    // Assert: oneMany + twoWay -> hasOrderColumn should be true
    expect(await getHasOrderColumnFromDb(linkField.id)).toBe(true);

    // Action: Convert to oneWay
    await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        options: {
          foreignTableId,
          relationship: 'oneMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });

    // Assert: oneMany + oneWay -> hasOrderColumn should be false
    expect(await getHasOrderColumnFromDb(linkField.id)).toBe(false);

    // Cleanup
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });

  test('should keep hasOrderColumn true for manyMany regardless of oneWay/twoWay conversion', async () => {
    // Use isolated tables to avoid interference from previous oneMany twoWay tests
    const srcTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'HasOrder ManyMany Source',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const fgnTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'HasOrder ManyMany Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    const fgnPrimaryId = fgnTable.fields.find((f) => f.isPrimary)!.id;

    try {
      // Setup: Create manyMany oneWay link field
      const tableAfterCreate = await ctx.createField({
        baseId: ctx.baseId,
        tableId: srcTable.id,
        field: {
          type: 'link',
          name: 'OrderCol ManyMany Link',
          options: {
            foreignTableId: fgnTable.id,
            relationship: 'manyMany',
            lookupFieldId: fgnPrimaryId,
            isOneWay: true,
          },
        },
      });
      const linkField = tableAfterCreate.fields.find((f) => f.name === 'OrderCol ManyMany Link');
      if (!linkField) throw new Error('Link field not found');

      // Assert: manyMany + oneWay -> hasOrderColumn should be true
      expect(await getHasOrderColumnFromDb(linkField.id)).toBe(true);

      // Action: Convert to twoWay
      await ctx.updateField({
        tableId: srcTable.id,
        fieldId: linkField.id,
        field: {
          options: {
            foreignTableId: fgnTable.id,
            relationship: 'manyMany',
            lookupFieldId: fgnPrimaryId,
            isOneWay: false,
          },
        },
      });

      // Assert: manyMany + twoWay -> hasOrderColumn should still be true
      expect(await getHasOrderColumnFromDb(linkField.id)).toBe(true);
    } finally {
      try {
        await ctx.deleteTable(srcTable.id);
      } catch {
        /* cleanup */
      }
      try {
        await ctx.deleteTable(fgnTable.id);
      } catch {
        /* cleanup */
      }
    }
  });
});

describe('update-field: link conversions', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let sourcePrimaryFieldId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create source table
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Link Conversion Source',
      fields: [{ type: 'singleLineText', name: 'Source Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;
    const sourcePrimary = sourceTable.fields.find((f) => f.isPrimary);
    if (!sourcePrimary) throw new Error('No source primary field');
    sourcePrimaryFieldId = sourcePrimary.id;

    // Create foreign table
    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Link Conversion Foreign',
      fields: [{ type: 'singleLineText', name: 'Foreign Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    try {
      if (sourceTableId) await ctx.deleteTable(sourceTableId);
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // Ignore cleanup errors
    }
  });

  const getJunctionTableNameByFieldId = async (fieldId: string): Promise<string | undefined> => {
    const result = await sql<{ table_name: string }>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name LIKE ${'junction_%'}
    `.execute(ctx.testContainer.db);

    return result.rows.find((r) => r.table_name.includes(fieldId))?.table_name;
  };

  const hasTableInBase = async (tableName: string): Promise<boolean> => {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*)::int as count
      FROM information_schema.tables
      WHERE table_schema = ${ctx.baseId}
      AND table_name = ${tableName}
    `.execute(ctx.testContainer.db);

    return parseInt(result.rows[0].count, 10) > 0;
  };

  const getJunctionRows = async (
    junctionTableName: string
  ): Promise<Array<Record<string, unknown>>> => {
    const result = await sql`
      SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
    `.execute(ctx.testContainer.db);

    return result.rows as Array<Record<string, unknown>>;
  };

  test('should convert link to singleLineText', async () => {
    const sourceTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: sourceTableId,
      field: {
        type: 'link',
        name: 'Link to Convert',
        options: {
          foreignTableId,
          relationship: 'manyMany',
          lookupFieldId: foreignPrimaryFieldId,
          isOneWay: true,
        },
      },
    });
    const linkField = sourceTable.fields.find((f) => f.name === 'Link to Convert');
    if (!linkField) throw new Error('Link field not found');

    const foreign1 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Apple',
    });
    const foreign2 = await ctx.createRecord(foreignTableId, {
      [foreignPrimaryFieldId]: 'Banana',
    });

    const sourceRec = await ctx.createRecord(sourceTableId, {
      [sourcePrimaryFieldId]: 'Source Record',
      [linkField.id]: [{ id: foreign1.id }, { id: foreign2.id }],
    });
    await ctx.drainOutbox();

    const junctionTableName = await getJunctionTableNameByFieldId(linkField.id);
    expect(junctionTableName).toBeDefined();
    const beforeRows = await getJunctionRows(junctionTableName!);
    const beforeMatches = beforeRows.filter((r) => Object.values(r).includes(sourceRec.id));
    expect(beforeMatches.length).toBe(2);

    const updatedTable = await ctx.updateField({
      tableId: sourceTableId,
      fieldId: linkField.id,
      field: {
        type: 'singleLineText',
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === linkField.id);
    expect(updatedField?.type).toBe('singleLineText');

    const sourceRecords = await ctx.listRecords(sourceTableId);
    const sourceRecAfter = sourceRecords.find((r) => r.id === sourceRec.id);
    const textValue = sourceRecAfter?.fields[linkField.id] as string;
    expect(textValue).toBe('Apple, Banana');

    if (junctionTableName && (await hasTableInBase(junctionTableName))) {
      const afterRows = await getJunctionRows(junctionTableName);
      const afterMatches = afterRows.filter((r) => Object.values(r).includes(sourceRec.id));
      expect(afterMatches.length).toBe(0);
    }

    await ctx.deleteRecords(sourceTableId, [sourceRec.id]);
    await ctx.deleteRecords(foreignTableId, [foreign1.id, foreign2.id]);
    await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
  });
});

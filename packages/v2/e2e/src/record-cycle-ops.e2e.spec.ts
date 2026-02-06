import { randomUUID } from 'node:crypto';

import { explainOkResponseSchema } from '@teable/v2-contract-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 record operations with cyclic references (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 1;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  let foreignTableId = '';
  let foreignTitleFieldId = '';
  let foreignRecordId1 = '';
  let foreignRecordId2 = '';

  let tableId = '';
  let nameFieldId = '';
  let linkFieldId = '';
  let lookupFieldId = '';
  let formulaAFieldId = '';
  let formulaBFieldId = '';
  let cycleReferenceId = '';

  const postExplain = async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      throw new Error(`Explain request failed (${response.status}): ${errorText}`);
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

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cycle Foreign',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;
    foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    if (!foreignTitleFieldId) throw new Error('Missing foreign title field');

    const foreignRecordA = await ctx.createRecord(foreignTableId, {
      [foreignTitleFieldId]: 'Parent A',
    });
    const foreignRecordB = await ctx.createRecord(foreignTableId, {
      [foreignTitleFieldId]: 'Parent B',
    });
    foreignRecordId1 = foreignRecordA.id;
    foreignRecordId2 = foreignRecordB.id;

    nameFieldId = createFieldId();
    linkFieldId = createFieldId();
    lookupFieldId = createFieldId();
    formulaAFieldId = createFieldId();
    formulaBFieldId = createFieldId();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Cycle Ops',
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId,
            lookupFieldId: foreignTitleFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Parent Title',
          options: {
            linkFieldId,
            foreignTableId,
            lookupFieldId: foreignTitleFieldId,
          },
        },
        {
          type: 'formula',
          id: formulaAFieldId,
          name: 'Parent Label',
          options: {
            expression: `IF({${lookupFieldId}}, "linked", "")`,
          },
        },
        {
          type: 'formula',
          id: formulaBFieldId,
          name: 'Parent Label Copy',
          options: {
            expression: `{${formulaAFieldId}}`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    const existingEdge = await ctx.testContainer.db
      .selectFrom('reference')
      .select(['from_field_id', 'to_field_id'])
      .where('from_field_id', '=', formulaAFieldId)
      .where('to_field_id', '=', formulaBFieldId)
      .executeTakeFirst();

    if (!existingEdge) {
      throw new Error('Missing formula dependency edge for cycle setup');
    }

    cycleReferenceId = `ref_${randomUUID()}`;
    await ctx.testContainer.db
      .insertInto('reference')
      .values({
        id: cycleReferenceId,
        from_field_id: formulaBFieldId,
        to_field_id: formulaAFieldId,
      })
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing())
      .execute();
  });

  afterAll(async () => {
    if (cycleReferenceId) {
      await ctx.testContainer.db
        .deleteFrom('reference')
        .where('id', '=', cycleReferenceId)
        .execute();
    }
    if (tableId) {
      await ctx.deleteTable(tableId);
    }
    if (foreignTableId) {
      await ctx.deleteTable(foreignTableId);
    }
  });

  it('returns warnings in explain create/update/delete with cycle', async () => {
    const createExplain = await postExplain('/tables/explainCreateRecord', {
      tableId,
      fields: {
        [nameFieldId]: 'Cycle Explain Create',
        [linkFieldId]: { id: foreignRecordId1 },
      },
      analyze: false,
      includeSql: false,
      includeGraph: false,
      includeLocks: false,
    });

    expect(createExplain.computedImpact).not.toBeNull();
    expect(createExplain.computedImpact?.warnings?.[0]).toContain(
      'Computed field dependency cycle detected'
    );

    const created = await ctx.createRecord(tableId, {
      [nameFieldId]: 'Cycle Explain Update',
      [linkFieldId]: { id: foreignRecordId1 },
    });
    await ctx.drainOutbox();

    const updateExplain = await postExplain('/tables/explainUpdateRecord', {
      tableId,
      recordId: created.id,
      fields: {
        [linkFieldId]: { id: foreignRecordId2 },
      },
      analyze: false,
      includeSql: false,
      includeGraph: false,
      includeLocks: false,
    });

    expect(updateExplain.computedImpact).not.toBeNull();
    expect(updateExplain.computedImpact?.warnings?.[0]).toContain(
      'Computed field dependency cycle detected'
    );

    const deleteExplain = await postExplain('/tables/explainDeleteRecords', {
      tableId,
      recordIds: [created.id],
      analyze: false,
      includeSql: false,
      includeGraph: false,
      includeLocks: false,
    });

    expect(deleteExplain.computedImpact).not.toBeNull();
    expect(deleteExplain.computedImpact?.warnings?.[0]).toContain(
      'Computed field dependency cycle detected'
    );

    await ctx.deleteRecord(tableId, created.id);
    await ctx.drainOutbox();
  });

  it('creates, updates, and deletes records without throwing on cycles', async () => {
    const record = await ctx.createRecord(tableId, {
      [nameFieldId]: 'Cycle Ops Record',
      [linkFieldId]: { id: foreignRecordId1 },
    });
    await ctx.drainOutbox();

    await ctx.updateRecord(tableId, record.id, {
      [linkFieldId]: { id: foreignRecordId2 },
    });
    await ctx.drainOutbox();

    await ctx.deleteRecord(tableId, record.id);
    await ctx.drainOutbox();
  });
});

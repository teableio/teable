/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Sanitized production-shaped regression for formula projections over direct and template-derived
 * link arrays.
 *
 * The fixture retains only the failure-causing structure: a target table with roughly 265 rows,
 * direct many-many links, a many-one template link, a lookup of the template's many-many links,
 * and two ARRAY formulas combining both JSON inputs. Names and values are synthetic.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const TARGET_RECORD_COUNT = 265;
const CREATE_BATCH_SIZE = 100;

const isPgliteConnection = () => {
  const connectionString =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;
  return connectionString?.startsWith('pglite://') || connectionString === 'memory://';
};

const linkTitles = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        try {
          return linkTitles([JSON.parse(item)]).at(0) ?? item;
        } catch {
          return item;
        }
      }
      if (!item || typeof item !== 'object' || !('title' in item)) return '';
      const title = item.title;
      return typeof title === 'string' ? title : '';
    })
    .filter(Boolean)
    .sort();
};

describe.skipIf(isPgliteConnection())('v2 JSON formula cascade (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldSequence = 0;
  let cleanupTableIds: string[] = [];

  const createFieldId = (label: string) => {
    fieldSequence += 1;
    const suffix = `${label}${fieldSequence}`.replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
    return `fld${suffix.padEnd(16, '0')}`;
  };

  const createRecordsInBatches = async (
    tableId: string,
    rows: Array<{ fields: Record<string, unknown> }>
  ) => {
    const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
    for (let offset = 0; offset < rows.length; offset += CREATE_BATCH_SIZE) {
      created.push(
        ...(await ctx.createRecords(tableId, rows.slice(offset, offset + CREATE_BATCH_SIZE)))
      );
    }
    return created;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, 120_000);

  afterEach(async () => {
    for (const tableId of [...cleanupTableIds].reverse()) {
      await ctx.deleteTable(tableId, { mode: 'permanent' }).catch(() => undefined);
    }
    await ctx.testContainer.db
      .deleteFrom('computed_update_dead_letter')
      .where('base_id', '=', ctx.baseId)
      .execute();
    cleanupTableIds = [];
  }, 180_000);

  it('computes direct and template-derived link arrays through the same-table CTE path', async () => {
    const itemNameFieldId = createFieldId('itemName');
    const itemTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `SyntheticItems_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: itemNameFieldId,
          name: 'Item name',
          isPrimary: true,
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(itemTable.id);

    const [itemA, itemB, itemC] = await ctx.createRecords(itemTable.id, [
      { fields: { [itemNameFieldId]: 'Alpha' } },
      { fields: { [itemNameFieldId]: 'Beta' } },
      { fields: { [itemNameFieldId]: 'Gamma' } },
    ]);
    expect(itemA && itemB && itemC).toBeDefined();

    const templateNameFieldId = createFieldId('templateName');
    const templateItemsFieldId = createFieldId('templateItems');
    const templateTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `SyntheticTemplates_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: templateNameFieldId,
          name: 'Template name',
          isPrimary: true,
        },
        {
          type: 'link',
          id: templateItemsFieldId,
          name: 'Template items',
          options: {
            relationship: 'manyMany',
            foreignTableId: itemTable.id,
            lookupFieldId: itemNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(templateTable.id);

    const templateRecord = await ctx.createRecord(templateTable.id, {
      [templateNameFieldId]: 'Template A',
      [templateItemsFieldId]: [{ id: itemB!.id }, { id: itemC!.id }],
    });

    const targetNameFieldId = createFieldId('targetName');
    const directItemsFieldId = createFieldId('directItems');
    const templateLinkFieldId = createFieldId('templateLink');
    const templateItemsLookupFieldId = createFieldId('templateLookup');
    const compactItemsFormulaFieldId = createFieldId('compactItems');
    const uniqueItemsFormulaFieldId = createFieldId('uniqueItems');
    const targetTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `SyntheticTargets_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: targetNameFieldId,
          name: 'Target name',
          isPrimary: true,
        },
        {
          type: 'link',
          id: directItemsFieldId,
          name: 'Direct items',
          options: {
            relationship: 'manyMany',
            foreignTableId: itemTable.id,
            lookupFieldId: itemNameFieldId,
          },
        },
        {
          type: 'link',
          id: templateLinkFieldId,
          name: 'Template',
          options: {
            relationship: 'manyOne',
            foreignTableId: templateTable.id,
            lookupFieldId: templateNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: templateItemsLookupFieldId,
          name: 'Template-derived items',
          options: {
            linkFieldId: templateLinkFieldId,
            foreignTableId: templateTable.id,
            lookupFieldId: templateItemsFieldId,
          },
        },
        {
          type: 'formula',
          id: compactItemsFormulaFieldId,
          name: 'Compact items',
          options: {
            expression: `ARRAY_COMPACT(ARRAY_UNIQUE(ARRAY_FLATTEN({${directItemsFieldId}}, {${templateItemsLookupFieldId}})))`,
          },
        },
        {
          type: 'formula',
          id: uniqueItemsFormulaFieldId,
          name: 'Unique items',
          options: {
            expression: `ARRAY_UNIQUE(ARRAY_FLATTEN({${directItemsFieldId}}, {${templateItemsLookupFieldId}}))`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    cleanupTableIds.push(targetTable.id);

    const targets = await createRecordsInBatches(
      targetTable.id,
      Array.from({ length: TARGET_RECORD_COUNT }, (_, index) => ({
        fields: {
          [targetNameFieldId]: `Target ${index.toString().padStart(3, '0')}`,
          [directItemsFieldId]: [{ id: itemA!.id }, { id: itemB!.id }],
          [templateLinkFieldId]: { id: templateRecord.id },
        },
      }))
    );
    expect(targets).toHaveLength(TARGET_RECORD_COUNT);
    await ctx.drainOutbox();

    ctx.clearLogs();
    await ctx.updateRecord(templateTable.id, templateRecord.id, {
      [templateItemsFieldId]: [{ id: itemB!.id }, { id: itemC!.id }, { id: itemA!.id }],
    });
    await ctx.drainOutbox();

    const [targetRecord] = await ctx.listRecordsWithoutDrain(targetTable.id, { limit: 1 });
    const compactTitles = linkTitles(targetRecord?.fields[compactItemsFormulaFieldId]);
    const uniqueTitles = linkTitles(targetRecord?.fields[uniqueItemsFormulaFieldId]);
    expect(new Set(compactTitles)).toEqual(new Set(['Alpha', 'Beta', 'Gamma']));
    expect(new Set(uniqueTitles)).toEqual(new Set(['Alpha', 'Beta', 'Gamma']));
    expect(compactTitles.filter((title) => title === 'Beta')).toHaveLength(2);
    expect(uniqueTitles.filter((title) => title === 'Beta')).toHaveLength(2);

    const relevantFieldIds = [compactItemsFormulaFieldId, uniqueItemsFormulaFieldId];
    const deadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error', 'affected_field_ids'])
      .where('base_id', '=', ctx.baseId)
      .execute();
    expect(
      deadLetters.filter((task) =>
        task.affected_field_ids.some((fieldId) => relevantFieldIds.includes(fieldId))
      )
    ).toEqual([]);

    const formulaStorage = await ctx.testContainer.db
      .selectFrom('field')
      .select(['id', 'db_field_name'])
      .where('id', 'in', relevantFieldIds)
      .execute();
    const formulaColumnNames = formulaStorage.map((field) => field.db_field_name);
    expect(formulaColumnNames).toHaveLength(2);

    const targetSqlEntries = ctx.testContainer.spyLogger
      .getEntriesByMessage('computed:update:table=')
      .filter(
        (entry) =>
          entry.message.includes(`.${targetTable.id}:`) &&
          formulaColumnNames.every((columnName) => entry.message.includes(`"${columnName}"`))
      );
    // 265 targets / JSON chunk size 25 = 11 chunks. Changed-only continuation
    // (with stage budgets on by default) converges in ONE wave: the formulas
    // compute correct values inside the staged chain, so the old second
    // replan wave — 11 more chunked statements recomputing already-correct
    // fields — no longer runs. Value assertions above prove correctness.
    expect(targetSqlEntries).toHaveLength(11);
    expect(
      targetSqlEntries.every(
        (entry) =>
          /:chunk=\d+\/11:sql:/.test(entry.message) &&
          /\bwith "level_\d+" as materialized\b/i.test(entry.message) &&
          /as "__record_ids"\("__id"\)/i.test(entry.message)
      )
    ).toBe(true);
  }, 600_000);
});

import { describe, expect, it } from 'vitest';

import type { DataQueryManifest } from './DataQueryManifest';
import { parseDataQueryManifestText } from './DataQueryManifestFiles';
import {
  diffDataQueryManifestRepair,
  planDataQueryManifestRepair,
  serializeDataQueryManifest,
  sqlMentionsIdentifier,
  type DataQuerySchemaChange,
} from './DataQueryManifestRepair';

const tableId = `tbl${'a'.repeat(16)}`;
const targetTableId = `tbl${'b'.repeat(16)}`;
const deptTableId = `tbl${'c'.repeat(16)}`;
const titleField = `fld${'1'.repeat(16)}`;
const statusField = `fld${'2'.repeat(16)}`;
const amountField = `fld${'3'.repeat(16)}`;
const regionField = `fld${'4'.repeat(16)}`;
const linkField = `fld${'5'.repeat(16)}`;
const deptLinkField = `fld${'6'.repeat(16)}`;
const ownerNameField = `fld${'7'.repeat(16)}`;
const deptNameField = `fld${'8'.repeat(16)}`;
const replacementField = `fld${'9'.repeat(16)}`;

const parse = (yaml: string): DataQueryManifest => {
  const result = parseDataQueryManifestText(yaml);
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
};

/** Every repair must survive the same parser the save gate uses. */
const expectRoundTrip = (manifest: DataQueryManifest) => {
  const serialized = serializeDataQueryManifest(manifest);
  const reparsed = parseDataQueryManifestText(serialized);
  expect(reparsed.isErr()).toBe(false);
  if (reparsed.isOk()) expect(reparsed.value).toEqual(JSON.parse(JSON.stringify(manifest)));
};

const query = (manifest: DataQueryManifest, queryId: string) => {
  const value = manifest.queries[queryId];
  if (!value) throw new Error(`missing query ${queryId}`);
  return value;
};

const listManifest = `
schemaVersion: 1
queries:
  listOpen:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${titleField}, alias: title }
        - { fieldId: ${statusField}, alias: status }
      filter:
        conjunction: and
        items:
          - { fieldId: ${statusField}, operator: is, value: open }
          - { fieldId: ${titleField}, operator: isNotEmpty, value: null }
      sort:
        - { fieldId: ${statusField}, order: asc }
        - { fieldId: ${titleField}, order: asc }
      page: { limit: 20 }
  sqlOnly:
    mode: sql-query
    fallback:
      sql: SELECT "Title" FROM "bse"."tbl_root"
      outputs:
        - { alias: title }
`;

describe('planDataQueryManifestRepair: field delete', () => {
  it('suggests removing a projection, filter branch and sort item, but blocks filter semantics', () => {
    const manifest = parse(listManifest);
    const change: DataQuerySchemaChange = {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
      fieldName: 'Status',
    };
    const plan = planDataQueryManifestRepair(manifest, change);

    expect(plan.queries).toEqual([
      {
        queryId: 'listOpen',
        classification: 'manual',
        reasons: ['field_deleted_projection', 'filter_semantics_changed', 'field_deleted_sort'],
        actions: [
          { kind: 'remove_projection', alias: 'status' },
          { kind: 'remove_filter', source: 'root' },
          { kind: 'remove_sort', index: 0 },
        ],
      },
      {
        queryId: 'sqlOnly',
        classification: 'manual',
        reasons: ['sql_query_unverifiable'],
        actions: [],
      },
    ]);
    expect(plan.summary).toEqual({ auto: 0, manual: 2, noop: 0 });
    expect(plan.applyable).toBe(false);

    const repaired = plan.preview!;
    const definition = query(repaired, 'listOpen').definition!;
    if (definition.kind !== 'records') throw new Error('expected records');
    expect(definition.select.map((item) => item.alias)).toEqual(['title']);
    expect(definition.sort).toEqual([{ fieldId: titleField, order: 'asc' }]);
    expectRoundTrip(repaired);
  });

  it('omits an emptied filter group and an emptied sort list', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  onlyStatus:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${titleField}, alias: title }
      filter: { fieldId: ${statusField}, operator: is, value: open }
      sort:
        - { fieldId: ${statusField}, order: asc }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.queries[0]?.classification).toBe('manual');
    const definition = plan.preview!.queries.onlyStatus.definition!;
    expect(definition).not.toHaveProperty('filter');
    expect(definition).not.toHaveProperty('sort');
    expectRoundTrip(plan.preview!);
  });

  it('unwraps a not node whose only leaf read the deleted field', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  negated:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${titleField}, alias: title }
      filter:
        not: { fieldId: ${statusField}, operator: is, value: open }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.queries[0]?.classification).toBe('manual');
    expect(plan.preview!.queries.negated.definition).not.toHaveProperty('filter');
    expectRoundTrip(plan.preview!);
  });

  it('drops a filter leaf that compares against the deleted field', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  fieldToField:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${titleField}, alias: title }
      filter:
        fieldId: ${titleField}
        operator: is
        value: { type: field, fieldId: ${statusField} }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.queries[0]?.classification).toBe('manual');
    expect(plan.preview!.queries.fieldToField.definition).not.toHaveProperty('filter');
    expectRoundTrip(plan.preview!);
  });

  it('trims parameterized sort allow-lists instead of dropping the item', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  sortable:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      parameters:
        sortField: { type: string }
      select:
        - { fieldId: ${titleField}, alias: title }
      sort:
        - field: { type: parameter, name: sortField }
          order: asc
          allowed:
            - { fieldId: ${statusField} }
            - { fieldId: ${titleField} }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.repaired!.queries.sortable.definition!.sort).toEqual([
      {
        field: { type: 'parameter', name: 'sortField' },
        order: 'asc',
        allowed: [{ fieldId: titleField }],
      },
    ]);
    expectRoundTrip(plan.repaired!);
  });

  it('marks a query manual when the only projection is deleted and no fallback exists', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  onlyStatus:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${statusField}, alias: status }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.applyable).toBe(false);
    expect(plan.blockingQueryIds).toEqual(['onlyStatus']);
    expect(plan.queries[0]?.reasons).toEqual(['field_deleted_projection', 'definition_empty']);
    expect(plan.repaired).toBeUndefined();
  });

  it('trims fallback outputs that named a removed alias', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  withFallback:
    definition:
      version: 1
      kind: records
      tableId: ${tableId}
      select:
        - { fieldId: ${titleField}, alias: title }
        - { fieldId: ${statusField}, alias: status }
    fallback:
      sql: SELECT "Title", "Grade" FROM "bse"."tbl_root"
      outputs:
        - { alias: title }
        - { alias: status }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
      fieldName: 'Score',
    });
    expect(plan.repaired!.queries.withFallback.fallback?.outputs).toEqual([{ alias: 'title' }]);
    expectRoundTrip(plan.repaired!);
  });

  it('never treats an unverifiable SQL-only query as unaffected', () => {
    const manifest = parse(listManifest);
    const unrelated = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(unrelated.queries.find((entry) => entry.queryId === 'sqlOnly')).toMatchObject({
      classification: 'manual',
      reasons: ['sql_query_unverifiable'],
    });
    expect(unrelated.queries.find((entry) => entry.queryId === 'sqlOnly')?.actions).toEqual([]);
    expect(query(unrelated.preview!, 'sqlOnly')).toEqual(query(manifest, 'sqlOnly'));

    const named = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
      fieldName: 'Title',
    });
    expect(named.queries.find((entry) => entry.queryId === 'sqlOnly')?.reasons).toEqual([
      'fallback_references_field',
    ]);
    expect(named.blockingQueryIds).toContain('sqlOnly');
  });
});

describe('planDataQueryManifestRepair: aggregates', () => {
  const aggregateManifest = `
schemaVersion: 1
queries:
  totals:
    definition:
      version: 1
      kind: aggregate
      tableId: ${tableId}
      groupBy:
        - { fieldId: ${statusField}, alias: status }
        - { fieldId: ${regionField}, alias: region }
      aggregates:
        - { fieldId: ${amountField}, statisticFunc: sum, alias: total }
      sort:
        - { fieldId: ${statusField}, order: asc }
        - { alias: total, order: desc }
`;

  it('suggests removing a groupBy entry but blocks group semantics', () => {
    const plan = planDataQueryManifestRepair(parse(aggregateManifest), {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(plan.queries[0]).toMatchObject({
      classification: 'manual',
      reasons: ['group_semantics_changed', 'field_deleted_sort'],
    });
    const definition = plan.preview!.queries.totals.definition!;
    if (definition.kind !== 'aggregate') throw new Error('expected aggregate');
    expect(definition.groupBy).toEqual([{ fieldId: regionField, alias: 'region' }]);
    expect(definition.sort).toEqual([{ alias: 'total', order: 'desc' }]);
    expectRoundTrip(plan.preview!);
  });

  it('switches mode:auto to its fallback when the only aggregate is deleted', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  autoTotal:
    mode: auto
    definition:
      version: 1
      kind: aggregate
      tableId: ${tableId}
      aggregates:
        - { fieldId: ${amountField}, statisticFunc: sum, alias: total }
    fallback:
      sql: SELECT sum("amount") AS "total" FROM "bse"."tbl_root"
      outputs:
        - { alias: total, wireType: numberOrString, nullable: true }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: amountField,
      fieldName: 'Amount',
    });
    const repaired = query(plan.repaired!, 'autoTotal');
    expect(repaired.mode).toBe('sql-query');
    expect(repaired).not.toHaveProperty('definition');
    expect(repaired.fallback?.outputs).toEqual([
      { alias: 'total', wireType: 'numberOrString', nullable: true },
    ]);
    expect(plan.queries[0]?.reasons).toContain('switch_to_fallback');
    expectRoundTrip(plan.repaired!);
  });

  it('rewrites a grouped relation metric through its own source and leaves count alone', () => {
    const manifest = parse(`
schemaVersion: 1
queries:
  report:
    definition:
      version: 2
      kind: aggregate
      tableId: ${tableId}
      relations:
        items: { linkFieldId: ${linkField}, tableId: ${targetTableId} }
      groupBy:
        - { fieldId: ${statusField}, alias: status }
      aggregates:
        - { fieldId: ${amountField}, statisticFunc: sum, alias: total }
        - { source: items, fieldId: ${ownerNameField}, statisticFunc: sum, alias: itemTotal }
        - { source: items, statisticFunc: count, alias: itemCount }
`);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_replaced',
      tableId: targetTableId,
      fieldId: ownerNameField,
      replacementFieldId: replacementField,
    });
    const definition = plan.preview!.queries.report.definition!;
    if (definition.kind !== 'aggregate') throw new Error('expected aggregate');
    // The metric lives in the relation's table: a root-scoped rewrite would miss it,
    // and the field-less `count` metric has nothing to rewrite.
    expect(definition.aggregates).toEqual([
      { fieldId: amountField, statisticFunc: 'sum', alias: 'total' },
      { source: 'items', fieldId: replacementField, statisticFunc: 'sum', alias: 'itemTotal' },
      { source: 'items', statisticFunc: 'count', alias: 'itemCount' },
    ]);
    expect(plan.queries[0]?.actions).toEqual([
      {
        kind: 'rewrite_field',
        fromFieldId: ownerNameField,
        toFieldId: replacementField,
        usages: ['aggregate'],
      },
    ]);
    expectRoundTrip(plan.preview!);
  });
});

describe('planDataQueryManifestRepair: relations', () => {
  const relationManifest = `
schemaVersion: 1
queries:
  joined:
    definition:
      version: 2
      kind: records
      tableId: ${tableId}
      relations:
        owner: { linkFieldId: ${linkField}, tableId: ${targetTableId} }
        dept: { linkFieldId: ${deptLinkField}, tableId: ${deptTableId}, via: owner }
      select:
        - { fieldId: ${titleField}, alias: title }
        - { source: owner, fieldId: ${ownerNameField}, alias: ownerName }
        - { source: dept, fieldId: ${deptNameField}, alias: deptName }
      sort:
        - { source: owner, fieldId: ${ownerNameField}, order: asc }
        - { fieldId: ${titleField}, order: asc }
      page: { limit: 10 }
`;

  it('drops a deleted link field, its dependants and the via hop through it', () => {
    const plan = planDataQueryManifestRepair(parse(relationManifest), {
      kind: 'field_deleted',
      tableId,
      fieldId: linkField,
    });
    const definition = plan.repaired!.queries.joined.definition!;
    expect(definition).not.toHaveProperty('relations');
    if (definition.kind !== 'records') throw new Error('expected records');
    expect(definition.select.map((item) => item.alias)).toEqual(['title']);
    expect(definition.sort).toEqual([{ fieldId: titleField, order: 'asc' }]);
    expect(plan.queries[0]?.reasons).toContain('relation_removed');
    expectRoundTrip(plan.repaired!);
  });

  it('drops relations whose target table was deleted', () => {
    const plan = planDataQueryManifestRepair(parse(relationManifest), {
      kind: 'table_deleted',
      tableId: targetTableId,
    });
    const definition = plan.repaired!.queries.joined.definition!;
    expect(definition).not.toHaveProperty('relations');
    if (definition.kind !== 'records') throw new Error('expected records');
    expect(definition.select.map((item) => item.alias)).toEqual(['title']);
    expectRoundTrip(plan.repaired!);
  });

  it('marks a query manual when its root table was deleted', () => {
    const plan = planDataQueryManifestRepair(parse(relationManifest), {
      kind: 'table_deleted',
      tableId,
    });
    expect(plan.queries[0]).toMatchObject({ classification: 'manual', reasons: ['table_deleted'] });
  });
});

describe('planDataQueryManifestRepair: rename, type change and replacement', () => {
  const manifest = parse(listManifest);

  it('treats a structured rename as a no-op and correlates SQL by name', () => {
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_updated',
      tableId,
      fieldId: statusField,
      previousName: 'Status',
    });
    expect(plan.summary).toEqual({ auto: 0, manual: 1, noop: 1 });

    const blocked = planDataQueryManifestRepair(manifest, {
      kind: 'field_updated',
      tableId,
      fieldId: titleField,
      previousName: 'Title',
    });
    expect(blocked.queries.find((entry) => entry.queryId === 'sqlOnly')?.classification).toBe(
      'manual'
    );
  });

  it('requires a human for an output-changing type change', () => {
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_updated',
      tableId,
      fieldId: statusField,
      typeChanged: true,
    });
    expect(plan.queries[0]).toMatchObject({
      classification: 'manual',
      reasons: ['type_change_affects_output'],
    });

    const compatible = planDataQueryManifestRepair(manifest, {
      kind: 'field_updated',
      tableId,
      fieldId: statusField,
      typeChanged: true,
      outputCompatible: true,
    });
    expect(compatible.queries[0]?.classification).toBe('noop');
  });

  it('rewrites a unique field mapping across every usage', () => {
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_replaced',
      tableId,
      fieldId: statusField,
      replacementFieldId: replacementField,
    });
    const definition = plan.preview!.queries.listOpen.definition!;
    if (definition.kind !== 'records') throw new Error('expected records');
    expect(definition.select).toContainEqual({ fieldId: replacementField, alias: 'status' });
    expect(definition.sort).toEqual([
      { fieldId: replacementField, order: 'asc' },
      { fieldId: titleField, order: 'asc' },
    ]);
    expect(plan.queries[0]?.actions).toEqual([
      {
        kind: 'rewrite_field',
        fromFieldId: statusField,
        toFieldId: replacementField,
        usages: ['filter', 'projection', 'sort'],
      },
    ]);
    expectRoundTrip(plan.preview!);
  });

  it('flags an ambiguous mapping instead of guessing', () => {
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_replaced',
      tableId,
      fieldId: statusField,
    });
    expect(plan.queries[0]).toMatchObject({
      classification: 'manual',
      reasons: ['ambiguous_field_mapping'],
    });
  });
});

describe('planDataQueryManifestRepair: diff and idempotency', () => {
  it('reports only queries the plan touched', () => {
    const manifest = parse(listManifest);
    const plan = planDataQueryManifestRepair(manifest, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    const diff = diffDataQueryManifestRepair(manifest, plan);
    expect(diff.queries.map((entry) => entry.queryId)).toEqual(['listOpen']);
    expect(diff.queries[0]?.patches).toContainEqual({
      path: 'queries.listOpen.definition.select[1]',
      before: { fieldId: statusField, alias: 'status' },
    });
  });

  it('is a no-op when the repaired manifest is planned again', () => {
    const repaired = planDataQueryManifestRepair(parse(listManifest), {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    }).preview!;
    const second = planDataQueryManifestRepair(repaired, {
      kind: 'field_deleted',
      tableId,
      fieldId: statusField,
    });
    expect(second.summary).toEqual({ auto: 0, manual: 1, noop: 1 });
    expect(second.repaired).toBeUndefined();
    expect(second.preview).toBeUndefined();
  });

  it('serializes deterministically', () => {
    const manifest = parse(listManifest);
    expect(serializeDataQueryManifest(manifest)).toBe(serializeDataQueryManifest(manifest));
    expect(serializeDataQueryManifest(manifest)).toContain('schemaVersion: 1');
  });

  it('matches SQL identifiers conservatively', () => {
    expect(sqlMentionsIdentifier('SELECT "Order Total" FROM x', 'Order Total')).toBe(true);
    expect(sqlMentionsIdentifier('SELECT "order_total" FROM x', 'Order Total')).toBe(false);
    expect(sqlMentionsIdentifier('SELECT status FROM x', 'status')).toBe(true);
    expect(sqlMentionsIdentifier('SELECT "status" FROM x', 'status')).toBe(true);
    expect(sqlMentionsIdentifier('SELECT status_code FROM x', 'status')).toBe(false);
  });
});

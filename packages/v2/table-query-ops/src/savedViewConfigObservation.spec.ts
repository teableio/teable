import {
  BaseId,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { buildSavedViewConfigObservation } from './savedViewConfigObservation';

const unwrap = <T>(label: string, result: Result<T, { readonly message: string }>): T => {
  if (result.isErr()) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.value;
};

const createTable = (formulaExpression?: (titleFieldId: string) => string) => {
  const titleFieldId = unwrap('title field id', FieldId.create(`fld${'t'.repeat(16)}`));
  const amountFieldId = unwrap('amount field id', FieldId.create(`fld${'a'.repeat(16)}`));
  const statusFieldId = unwrap('status field id', FieldId.create(`fld${'s'.repeat(16)}`));
  const formulaFieldId = unwrap('formula field id', FieldId.create(`fld${'f'.repeat(16)}`));
  const builder = Table.builder()
    .withId(unwrap('table id', TableId.create(`tbl${'v'.repeat(16)}`)))
    .withBaseId(unwrap('base id', BaseId.create(`bse${'v'.repeat(16)}`)))
    .withName(unwrap('table name', TableName.create('Saved View Source')));

  builder
    .field()
    .singleLineText()
    .withId(titleFieldId)
    .withName(unwrap('title field name', FieldName.create('Title')))
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(amountFieldId)
    .withName(unwrap('amount field name', FieldName.create('Amount')))
    .done();
  builder
    .field()
    .checkbox()
    .withId(statusFieldId)
    .withName(unwrap('status field name', FieldName.create('Status')))
    .done();
  builder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(unwrap('formula field name', FieldName.create('Formula Search')))
    .withExpression(
      FormulaExpression.create(
        formulaExpression?.(titleFieldId.toString()) ??
          `SEARCH("needle", {${titleFieldId.toString()}})`
      )._unsafeUnwrap()
    )
    .withDependencies([titleFieldId])
    .done();
  builder.view().defaultGrid().done();

  return {
    table: unwrap('table build', builder.build()),
    titleFieldId: titleFieldId.toString(),
    amountFieldId: amountFieldId.toString(),
    statusFieldId: statusFieldId.toString(),
    formulaFieldId: formulaFieldId.toString(),
  };
};

describe('buildSavedViewConfigObservation', () => {
  it('extracts saved view filter/sort/group shape without storing filter values', () => {
    const { table, titleFieldId, amountFieldId, statusFieldId } = createTable();

    const observation = unwrap(
      'saved view observation',
      buildSavedViewConfigObservation({
        table,
        viewId: `viw${'v'.repeat(16)}`,
        filter: JSON.stringify({
          conjunction: 'and',
          filterSet: [
            { fieldId: titleFieldId, operator: 'contains', value: 'secret customer search' },
            { fieldId: statusFieldId, operator: 'is', value: true },
          ],
        }),
        sort: JSON.stringify({ sortObjs: [{ fieldId: amountFieldId, order: 'desc' }] }),
        group: JSON.stringify([{ fieldId: statusFieldId, order: 'asc' }]),
        now: new Date('2026-06-01T00:01:00.000Z'),
      })
    );

    expect(observation).toBeDefined();
    const snapshot = observation!.shape().snapshot();
    expect(snapshot.queryKind).toBe('filter');
    expect(snapshot.whereShape?.conditionCount).toBe(2);
    expect(snapshot.whereShape?.fields.map((field) => field.operatorFamily)).toEqual([
      'text_contains',
      'equality',
    ]);
    expect(snapshot.orderShape?.fields).toEqual([
      { fieldId: amountFieldId, direction: 'desc', source: 'sort' },
      { fieldId: statusFieldId, direction: 'asc', source: 'group' },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret customer search');
    expect(observation!.snapshot().sqlDiagnostics?.[0]?.source).toBe('saved_view_config');
  });

  it('extracts formula source-field evidence without storing formula literals', () => {
    const { table, titleFieldId, formulaFieldId } = createTable();

    const observation = unwrap(
      'formula saved view observation',
      buildSavedViewConfigObservation({
        table,
        viewId: `viw${'f'.repeat(16)}`,
        filter: JSON.stringify({
          conjunction: 'and',
          filterSet: [{ fieldId: formulaFieldId, operator: 'is', value: 1 }],
        }),
        now: new Date('2026-06-01T00:01:00.000Z'),
      })
    );

    expect(observation).toBeDefined();
    const field = observation!.shape().snapshot().whereShape?.fields[0];
    expect(field).toMatchObject({
      fieldId: titleFieldId,
      operatorFamily: 'text_contains',
      sourceKind: 'formula_source',
      formula: {
        formulaFieldId,
        referencedFieldIds: [titleFieldId],
        functionNames: ['SEARCH'],
        sourceKind: 'formula_source',
        candidateIndexes: ['gin_trgm'],
      },
    });
    expect(JSON.stringify(observation!.shape().snapshot())).not.toContain('needle');
  });

  it('extracts IF predicate pushdown evidence for formula filters', () => {
    const { table, titleFieldId, formulaFieldId } = createTable(
      (fieldId) => `IF(SEARCH("needle", {${fieldId}}), 1, 2)`
    );

    const observation = unwrap(
      'formula predicate pushdown observation',
      buildSavedViewConfigObservation({
        table,
        viewId: `viw${'p'.repeat(16)}`,
        filter: JSON.stringify({
          conjunction: 'and',
          filterSet: [{ fieldId: formulaFieldId, operator: 'is', value: 1 }],
        }),
        now: new Date('2026-06-01T00:01:00.000Z'),
      })
    );

    const field = observation!.shape().snapshot().whereShape?.fields[0];
    expect(field).toMatchObject({
      fieldId: titleFieldId,
      operatorFamily: 'text_contains',
      sourceKind: 'formula_source',
      formula: {
        formulaFieldId,
        predicatePushdown: {
          supported: true,
          operatorFamilies: ['text_contains'],
          sourceFunctionNames: ['SEARCH'],
          skippedReasons: [],
        },
      },
    });
    expect(JSON.stringify(observation!.shape().snapshot())).not.toContain('needle');
  });
});

import {
  BaseId,
  ConditionalLookupOptions,
  FieldCondition,
  FieldId,
  FieldName,
  LinkFieldConfig,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { buildRelationFieldConfigObservation } from './relationFieldConfigObservation';

const unwrap = <T>(label: string, result: Result<T, { readonly message: string }>): T => {
  if (result.isErr()) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.value;
};

const createId = (prefix: 'tbl' | 'bse' | 'fld', seed: string) => `${prefix}${seed.repeat(16)}`;

const createTargetTable = () => {
  const baseId = unwrap('base id', BaseId.create(createId('bse', 'r')));
  const tableId = unwrap('target table id', TableId.create(createId('tbl', 't')));
  const orderFieldId = unwrap('order field id', FieldId.create(createId('fld', 'o')));
  const statusFieldId = unwrap('status field id', FieldId.create(createId('fld', 's')));
  const amountFieldId = unwrap('amount field id', FieldId.create(createId('fld', 'a')));
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(unwrap('target table name', TableName.create('Orders')));

  builder
    .field()
    .singleLineText()
    .withId(orderFieldId)
    .withName(unwrap('order field name', FieldName.create('Ding_Dan_Hao')))
    .primary()
    .done();
  builder
    .field()
    .singleLineText()
    .withId(statusFieldId)
    .withName(unwrap('status field name', FieldName.create('Status')))
    .done();
  builder
    .field()
    .number()
    .withId(amountFieldId)
    .withName(unwrap('amount field name', FieldName.create('Amount')))
    .done();
  builder.view().defaultGrid().done();

  const table = unwrap('target table build', builder.build());
  return {
    table,
    baseId,
    orderFieldId: orderFieldId.toString(),
    statusFieldId: statusFieldId.toString(),
    amountFieldId: amountFieldId.toString(),
    statusField: unwrap(
      'status field',
      table.getField((field) => field.id().equals(statusFieldId))
    ),
  };
};

describe('buildRelationFieldConfigObservation', () => {
  it('extracts conditional lookup target filter/sort shape without storing literal values', () => {
    const target = createTargetTable();
    const sourceTableId = unwrap('source table id', TableId.create(createId('tbl', 'u')));
    const sourceOrderFieldId = unwrap('source order id', FieldId.create(createId('fld', 'd')));
    const conditionalLookupFieldId = unwrap(
      'conditional lookup field id',
      FieldId.create(createId('fld', 'c'))
    );
    const condition = unwrap(
      'condition',
      FieldCondition.create({
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: target.orderFieldId,
              operator: 'is',
              value: { fieldId: sourceOrderFieldId.toString() },
              isSymbol: true,
            },
            { fieldId: target.statusFieldId, operator: 'is', value: 'secret-status' },
          ],
        },
        sort: { fieldId: target.amountFieldId, order: 'desc' },
        limit: 20,
      })
    );
    const sourceBuilder = Table.builder()
      .withId(sourceTableId)
      .withBaseId(target.baseId)
      .withName(unwrap('source table name', TableName.create('Inventory')));

    sourceBuilder
      .field()
      .singleLineText()
      .withId(sourceOrderFieldId)
      .withName(unwrap('source order field name', FieldName.create('Ding_Dan_Hao')))
      .primary()
      .done();
    sourceBuilder
      .field()
      .conditionalLookup()
      .withId(conditionalLookupFieldId)
      .withName(unwrap('conditional lookup name', FieldName.create('Matched Order Status')))
      .withConditionalLookupOptions(
        unwrap(
          'conditional lookup options',
          ConditionalLookupOptions.create({
            foreignTableId: target.table.id().toString(),
            lookupFieldId: target.statusFieldId,
            condition: condition.toDto(),
          })
        )
      )
      .withInnerField(target.statusField)
      .done();
    sourceBuilder.view().defaultGrid().done();
    const sourceTable = unwrap('source table build', sourceBuilder.build());

    const observation = unwrap(
      'relation field observation',
      buildRelationFieldConfigObservation({
        sourceTable,
        targetTable: target.table,
        fieldId: conditionalLookupFieldId.toString(),
        now: new Date('2026-06-01T00:01:00.000Z'),
      })
    );

    expect(observation).toBeDefined();
    const snapshot = observation!.shape().snapshot();
    expect(snapshot.queryKind).toBe('relation');
    expect(snapshot.relationShape).toMatchObject({
      relationKind: 'conditional_lookup',
      sourceTableId: sourceTableId.toString(),
      targetTableId: target.table.id().toString(),
      sourceFieldId: conditionalLookupFieldId.toString(),
      targetLookupFieldId: target.statusFieldId,
      fieldReferenceCount: 1,
      hasTargetFilter: true,
      hasTargetSort: true,
      limitBucket: 'medium',
    });
    expect(snapshot.whereShape?.fields).toEqual([
      { fieldId: target.orderFieldId, fieldType: 'singleLineText', operatorFamily: 'link' },
      { fieldId: target.statusFieldId, fieldType: 'singleLineText', operatorFamily: 'equality' },
    ]);
    expect(snapshot.orderShape?.fields).toEqual([
      { fieldId: target.amountFieldId, direction: 'desc', source: 'sort' },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret-status');
  });

  it('extracts link field custom filter as a relation access path on the foreign table', () => {
    const target = createTargetTable();
    const sourceTableId = unwrap('link source table id', TableId.create(createId('tbl', 'l')));
    const linkFieldId = unwrap('link field id', FieldId.create(createId('fld', 'l')));
    const sourceBuilder = Table.builder()
      .withId(sourceTableId)
      .withBaseId(target.baseId)
      .withName(unwrap('link source table name', TableName.create('Link Source')));

    sourceBuilder
      .field()
      .singleLineText()
      .withName(unwrap('title field name', FieldName.create('Title')))
      .primary()
      .done();
    sourceBuilder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(unwrap('link field name', FieldName.create('Filtered Orders')))
      .withConfig(
        unwrap(
          'link config',
          LinkFieldConfig.create({
            baseId: target.baseId.toString(),
            relationship: 'oneMany',
            foreignTableId: target.table.id().toString(),
            lookupFieldId: target.orderFieldId,
            isOneWay: true,
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: target.statusFieldId, operator: 'is', value: 'secret' }],
            },
          })
        )
      )
      .done();
    sourceBuilder.view().defaultGrid().done();
    const sourceTable = unwrap('link source table build', sourceBuilder.build());

    const observation = unwrap(
      'link relation observation',
      buildRelationFieldConfigObservation({
        sourceTable,
        targetTable: target.table,
        fieldId: linkFieldId.toString(),
        now: new Date('2026-06-01T00:01:00.000Z'),
      })
    );

    expect(observation).toBeDefined();
    const snapshot = observation!.shape().snapshot();
    expect(snapshot.relationShape).toMatchObject({
      relationKind: 'link',
      sourceTableId: sourceTableId.toString(),
      targetTableId: target.table.id().toString(),
      sourceFieldId: linkFieldId.toString(),
      hasTargetFilter: true,
    });
    expect(snapshot.whereShape?.fields).toEqual([
      { fieldId: target.statusFieldId, fieldType: 'singleLineText', operatorFamily: 'equality' },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
});

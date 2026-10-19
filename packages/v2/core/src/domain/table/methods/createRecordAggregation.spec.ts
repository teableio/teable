import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { AttachmentField } from '../fields/types/AttachmentField';
import { ConditionalLookupOptions } from '../fields/types/ConditionalLookupOptions';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { LinkRelationship } from '../fields/types/LinkRelationship';
import { LookupField } from '../fields/types/LookupField';
import { LookupOptions } from '../fields/types/LookupOptions';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';

const createTable = () => {
  const textId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const checkboxId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const attachmentId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Aggregation')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(textId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder
    .field()
    .checkbox()
    .withId(checkboxId)
    .withName(FieldName.create('Done')._unsafeUnwrap())
    .done();
  builder
    .field()
    .attachment()
    .withId(attachmentId)
    .withName(FieldName.create('Files')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return {
    table,
    viewId: table.defaultView()._unsafeUnwrap().id(),
    textId,
    numberId,
    checkboxId,
    attachmentId,
  };
};

const createLookupTable = () => {
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const primaryId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const attachmentId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const linkId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const lookupId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const nestedLookupId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const conditionalLookupId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'l'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'l'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Lookup Aggregation')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  const attachment = AttachmentField.create({
    id: attachmentId,
    name: FieldName.create('Files')._unsafeUnwrap(),
  })._unsafeUnwrap();
  builder
    .field()
    .link()
    .withId(linkId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: LinkRelationship.manyMany().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: attachmentId.toString(),
      })._unsafeUnwrap()
    )
    .done();
  const lookupOptions = LookupOptions.create({
    linkFieldId: linkId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: attachmentId.toString(),
  })._unsafeUnwrap();
  const lookup = LookupField.create({
    id: lookupId,
    name: FieldName.create('Files lookup')._unsafeUnwrap(),
    innerField: attachment,
    lookupOptions,
  })._unsafeUnwrap();
  builder
    .field()
    .lookup()
    .withId(lookupId)
    .withName(FieldName.create('Files lookup')._unsafeUnwrap())
    .withInnerField(attachment)
    .withLookupOptions(lookupOptions)
    .withIsMultipleCellValue(true)
    .done();
  builder
    .field()
    .lookup()
    .withId(nestedLookupId)
    .withName(FieldName.create('Files nested lookup')._unsafeUnwrap())
    .withInnerField(lookup)
    .withLookupOptions(lookupOptions)
    .withIsMultipleCellValue(true)
    .done();
  builder
    .field()
    .conditionalLookup()
    .withId(conditionalLookupId)
    .withName(FieldName.create('Files conditional lookup')._unsafeUnwrap())
    .withInnerField(attachment)
    .withConditionalLookupOptions(
      ConditionalLookupOptions.create({
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: attachmentId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: primaryId.toString(), operator: 'is', value: 'x' }],
          },
        },
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  return {
    table,
    viewId: table.defaultView()._unsafeUnwrap().id().toString(),
    lookupId,
    nestedLookupId,
    conditionalLookupId,
  };
};

describe('Table.createRecordAggregation', () => {
  it('derives the default statistic from the View child column metadata', () => {
    const { table, viewId, numberId } = createTable();
    const updatedTable = table
      .updateViewColumnMeta(viewId, [{ fieldId: numberId, columnMeta: { statisticFunc: 'sum' } }])
      ._unsafeUnwrap().updateResult!.table;

    const result = updatedTable.createRecordAggregation({ viewId: viewId.toString() });

    expect(
      result._unsafeUnwrap().fields.map(({ fieldId, statisticFunc }) => ({
        fieldId: fieldId.toString(),
        statisticFunc,
      }))
    ).toEqual([{ fieldId: numberId.toString(), statisticFunc: 'sum' }]);
  });

  it('does not derive view columnMeta statistics when viewId is omitted', () => {
    const { table, viewId, numberId } = createTable();
    const updatedTable = table
      .updateViewColumnMeta(viewId, [{ fieldId: numberId, columnMeta: { statisticFunc: 'sum' } }])
      ._unsafeUnwrap().updateResult!.table;

    expect(updatedTable.createRecordAggregation({})._unsafeUnwrap().fields).toEqual([]);
    expect(
      updatedTable
        .createRecordAggregation({
          fields: [{ fieldId: numberId.toString(), statisticFunc: 'sum' }],
        })
        .isOk()
    ).toBe(true);
  });

  it('validates functions against the Field child value type', () => {
    const { table, viewId, textId, numberId, checkboxId, attachmentId } = createTable();

    expect(
      table
        .createRecordAggregation({
          viewId: viewId.toString(),
          fields: [
            { fieldId: numberId.toString(), statisticFunc: 'average' },
            { fieldId: checkboxId.toString(), statisticFunc: 'percentChecked' },
            { fieldId: attachmentId.toString(), statisticFunc: 'totalAttachmentSize' },
          ],
        })
        .isOk()
    ).toBe(true);

    const invalid = table.createRecordAggregation({
      viewId: viewId.toString(),
      fields: [{ fieldId: textId.toString(), statisticFunc: 'sum' }],
    });
    expect(invalid._unsafeUnwrapErr()).toMatchObject({
      code: 'record_aggregation.function_not_supported',
      tags: ['validation'],
    });
  });

  it('rejects unknown fields and aggregation functions', () => {
    const { table, viewId, textId } = createTable();

    expect(
      table
        .createRecordAggregation({
          viewId: viewId.toString(),
          fields: [{ fieldId: `fld${'z'.repeat(16)}`, statisticFunc: 'count' }],
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'record_aggregation.field_not_found' });
    expect(
      table
        .createRecordAggregation({
          viewId: viewId.toString(),
          fields: [{ fieldId: textId.toString(), statisticFunc: 'mystery' }],
        })
        ._unsafeUnwrapErr()
    ).toMatchObject({ code: 'record_aggregation.function_invalid' });
  });

  it('protects hidden statistic and group fields unless the share explicitly includes them', () => {
    const { table, viewId, numberId } = createTable();
    const updatedTable = table
      .updateViewColumnMeta(viewId, [
        { fieldId: numberId, columnMeta: { hidden: true, statisticFunc: 'sum' } },
      ])
      ._unsafeUnwrap().updateResult!.table;

    for (const input of [
      { fields: [{ fieldId: numberId.toString(), statisticFunc: 'sum' }] },
      { groupBy: [{ fieldId: numberId.toString(), order: 'asc' as const }] },
      {},
    ]) {
      const result = updatedTable.createRecordAggregation({
        viewId: viewId.toString(),
        ...input,
      });
      if ('fields' in input || 'groupBy' in input) {
        expect(result._unsafeUnwrapErr()).toMatchObject({
          code: 'record_aggregation.field_hidden',
          tags: ['forbidden'],
        });
      } else {
        expect(result._unsafeUnwrap().fields).toEqual([]);
      }
    }

    expect(
      updatedTable
        .createRecordAggregation({
          viewId: viewId.toString(),
          fields: [{ fieldId: numberId.toString(), statisticFunc: 'sum' }],
          groupBy: [{ fieldId: numberId.toString(), order: 'desc' }],
          includeHiddenFields: true,
        })
        .isOk()
    ).toBe(true);
  });

  it('keeps ordered group fields inside the Table-owned specification and limits depth to three', () => {
    const { table, viewId, textId, numberId, checkboxId, attachmentId } = createTable();

    const aggregation = table
      .createRecordAggregation({
        viewId: viewId.toString(),
        fields: [{ fieldId: textId.toString(), statisticFunc: 'count' }],
        groupBy: [
          { fieldId: textId.toString(), order: 'desc' },
          { fieldId: numberId.toString(), order: 'asc' },
          { fieldId: checkboxId.toString(), order: 'desc' },
          { fieldId: attachmentId.toString(), order: 'asc' },
        ],
      })
      ._unsafeUnwrap();

    expect(
      aggregation.groupBy.map(({ fieldId, fieldType, order }) => ({
        fieldId: fieldId.toString(),
        fieldType,
        order,
      }))
    ).toEqual([
      { fieldId: textId.toString(), fieldType: 'singleLineText', order: 'desc' },
      { fieldId: numberId.toString(), fieldType: 'number', order: 'asc' },
      { fieldId: checkboxId.toString(), fieldType: 'checkbox', order: 'desc' },
    ]);
  });

  it('applies the inner attachment statistics to a lookup', () => {
    const { table, viewId, lookupId, nestedLookupId, conditionalLookupId } = createLookupTable();

    for (const fieldId of [lookupId, nestedLookupId, conditionalLookupId]) {
      expect(
        table
          .createRecordAggregation({
            viewId,
            fields: [{ fieldId: fieldId.toString(), statisticFunc: 'totalAttachmentSize' }],
          })
          .isOk()
      ).toBe(true);
      expect(
        table
          .createRecordAggregation({
            viewId,
            fields: [{ fieldId: fieldId.toString(), statisticFunc: 'unique' }],
          })
          ._unsafeUnwrapErr()
      ).toMatchObject({ code: 'record_aggregation.function_not_supported' });
    }
  });
});

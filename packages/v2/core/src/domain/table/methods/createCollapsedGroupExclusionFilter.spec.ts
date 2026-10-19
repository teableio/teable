import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { LinkRelationship } from '../fields/types/LinkRelationship';
import { LookupOptions } from '../fields/types/LookupOptions';
import { MultipleSelectField } from '../fields/types/MultipleSelectField';
import { SelectOption } from '../fields/types/SelectOption';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';

const hash = (value: string) => {
  let result = 5381;
  let index = value.length;
  while (index) result = (result * 33) ^ value.charCodeAt(--index);
  return result >>> 0;
};

const createLookupTable = () => {
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const primaryId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const tagsId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const linkId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const lookupId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const tags = MultipleSelectField.create({
    id: tagsId,
    name: FieldName.create('Tags')._unsafeUnwrap(),
    options: ['x', 'y'].map((name) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap()),
  })._unsafeUnwrap();
  const lookupOptions = LookupOptions.create({
    linkFieldId: linkId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: tagsId.toString(),
  })._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Collapsed lookup group')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: tagsId.toString(),
      })._unsafeUnwrap()
    )
    .done();
  builder
    .field()
    .lookup()
    .withId(lookupId)
    .withName(FieldName.create('Tags lookup')._unsafeUnwrap())
    .withInnerField(tags)
    .withLookupOptions(lookupOptions)
    .withIsMultipleCellValue(true)
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), lookupId };
};

describe('createCollapsedGroupExclusionFilter', () => {
  it('uses the lookup inner type for a multiple-select group', () => {
    const { table, lookupId } = createLookupTable();
    const groupId = String(hash(`${lookupId.toString()}_${JSON.stringify(['x'])}`));

    expect(
      table
        .createCollapsedGroupExclusionFilter(
          [{ fieldId: lookupId.toString(), order: 'asc' }],
          [{ groupValues: [['x']] }],
          new Set([groupId])
        )
        ._unsafeUnwrap()
    ).toEqual({
      conjunction: 'and',
      items: [
        {
          conjunction: 'or',
          items: [
            {
              fieldId: lookupId.toString(),
              operator: 'isNotExactly',
              value: ['x'],
            },
          ],
        },
      ],
    });
  });
});

import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { ConditionalLookupField } from '../../fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../../fields/types/ConditionalLookupOptions';
import { LookupField } from '../../fields/types/LookupField';
import { LookupOptions } from '../../fields/types/LookupOptions';
import { SelectOption } from '../../fields/types/SelectOption';
import { Table } from '../../Table';
import { TableId } from '../../TableId';
import { TableName } from '../../TableName';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import {
  conditionNullMatch,
  conditionNullMatchForSpec,
  fieldIsArrayLikeForFilter,
} from './ConditionNullSemantics';
import {
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
} from './RecordConditionValues';

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Null Semantics')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().checkbox().withName(FieldName.create('Done')._unsafeUnwrap()).done();
  builder.field().number().withName(FieldName.create('Score')._unsafeUnwrap()).done();
  builder
    .field()
    .multipleSelect()
    .withName(FieldName.create('Tags')._unsafeUnwrap())
    .withOptions([SelectOption.create({ name: 'a', color: 'blue' })._unsafeUnwrap()])
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('conditionNullMatch', () => {
  it('classifies emptiness and literal negatives', () => {
    const table = buildTable();
    const title = table.getField((f) => f.name().toString() === 'Title')._unsafeUnwrap();
    expect(conditionNullMatch(title, 'isEmpty')).toBe('true');
    expect(conditionNullMatch(title, 'isNotEmpty')).toBe('false');
    expect(conditionNullMatch(title, 'isNot')).toBe('true');
    expect(conditionNullMatch(title, 'is')).toBe('unknown');
    expect(conditionNullMatch(title, 'contains')).toBe('unknown');
  });

  it('doesNotContain empty string is false on NULL (NOT ILIKE %%)', () => {
    const table = buildTable();
    const title = table.getField((f) => f.name().toString() === 'Title')._unsafeUnwrap();
    const empty = RecordConditionLiteralValue.create('')._unsafeUnwrap();
    const nonEmpty = RecordConditionLiteralValue.create('x')._unsafeUnwrap();
    expect(conditionNullMatch(title, 'doesNotContain', empty)).toBe('false');
    expect(conditionNullMatch(title, 'doesNotContain', nonEmpty)).toBe('true');
  });

  it('only CheckboxConditionSpec maps NULL to unchecked (not plain boolean equality)', () => {
    const table = buildTable();
    const done = table.getField((f) => f.name().toString() === 'Done')._unsafeUnwrap();
    const title = table.getField((f) => f.name().toString() === 'Title')._unsafeUnwrap();
    const falseLit = RecordConditionLiteralValue.create(false)._unsafeUnwrap();
    const trueLit = RecordConditionLiteralValue.create(true)._unsafeUnwrap();

    const checkboxSpec = CheckboxConditionSpec.create(done, 'is', falseLit);
    expect(conditionNullMatchForSpec(checkboxSpec)).toBe('true');
    expect(conditionNullMatchForSpec(CheckboxConditionSpec.create(done, 'is', trueLit))).toBe(
      'false'
    );

    const checkboxLookup = LookupField.create({
      id: FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Lookup Done')._unsafeUnwrap(),
      innerField: done,
      lookupOptions: LookupOptions.create({
        linkFieldId: `fld${'k'.repeat(16)}`,
        lookupFieldId: done.id().toString(),
        foreignTableId: `tbl${'f'.repeat(16)}`,
      })._unsafeUnwrap(),
      isMultipleCellValue: false,
    })._unsafeUnwrap();
    const lookupSpec = checkboxLookup
      .spec()
      .create({ operator: 'is', value: falseLit })
      ._unsafeUnwrap();
    expect(lookupSpec).toBeInstanceOf(CheckboxConditionSpec);
    expect(conditionNullMatchForSpec(lookupSpec)).toBe('true');

    // Non-checkbox field form: ordinary equality stays UNKNOWN.
    expect(conditionNullMatch(title, 'is', falseLit)).toBe('unknown');
  });

  it('classifies multi-value positive ops and comparisons as false on NULL', () => {
    const table = buildTable();
    const tags = table.getField((f) => f.name().toString() === 'Tags')._unsafeUnwrap();
    expect(fieldIsArrayLikeForFilter(tags)).toBe(true);
    const list = RecordConditionLiteralListValue.create(['a'])._unsafeUnwrap();
    expect(conditionNullMatch(tags, 'hasAnyOf', list)).toBe('false');
    expect(conditionNullMatch(tags, 'isExactly', list)).toBe('false');
    expect(conditionNullMatch(tags, 'hasNoneOf', list)).toBe('true');
    expect(conditionNullMatch(tags, 'isNotExactly', list)).toBe('true');
    // Multi comparisons use EXISTS over [] → definite false.
    expect(
      conditionNullMatch(tags, 'isGreater', RecordConditionLiteralValue.create(5)._unsafeUnwrap())
    ).toBe('false');
  });

  it('classifies real lookup and conditional-lookup comparison dispatch', () => {
    const table = buildTable();
    const score = table.getField((f) => f.name().toString() === 'Score')._unsafeUnwrap();
    const scoreLookup = LookupField.create({
      id: FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Lookup Score')._unsafeUnwrap(),
      innerField: score,
      lookupOptions: LookupOptions.create({
        linkFieldId: `fld${'r'.repeat(16)}`,
        lookupFieldId: score.id().toString(),
        foreignTableId: `tbl${'s'.repeat(16)}`,
      })._unsafeUnwrap(),
      isMultipleCellValue: true,
    })._unsafeUnwrap();
    const numberValue = RecordConditionLiteralValue.create(5)._unsafeUnwrap();
    const lookupSpec = scoreLookup
      .spec()
      .create({ operator: 'isGreater', value: numberValue })
      ._unsafeUnwrap();
    expect(conditionNullMatchForSpec(lookupSpec)).toBe('false');

    const conditionalLookup = ConditionalLookupField.create({
      id: FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Conditional Score')._unsafeUnwrap(),
      innerField: score,
      conditionalLookupOptions: ConditionalLookupOptions.create({
        foreignTableId: TableId.create(`tbl${'d'.repeat(16)}`)
          ._unsafeUnwrap()
          .toString(),
        lookupFieldId: score.id().toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: score.id().toString(), operator: 'isNotEmpty' }],
          },
        },
      })._unsafeUnwrap(),
      isMultipleCellValue: true,
    })._unsafeUnwrap();
    const conditionalSpec = conditionalLookup
      .spec()
      .create({ operator: 'isGreater', value: numberValue })
      ._unsafeUnwrap();
    expect(conditionNullMatchForSpec(conditionalSpec)).toBe('true');
  });

  it('returns dynamic for field-reference RHS', () => {
    const table = buildTable();
    const title = table.getField((f) => f.name().toString() === 'Title')._unsafeUnwrap();
    const fieldRef = RecordConditionFieldReferenceValue.create(title)._unsafeUnwrap();
    expect(conditionNullMatch(title, 'isNot', fieldRef)).toBe('dynamic');
  });
});

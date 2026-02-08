import { BaseId } from '../../../base/BaseId';
import { FieldName } from '../../fields/FieldName';
import { FieldType } from '../../fields/FieldType';
import type { NumberField } from '../../fields/types/NumberField';
import type { SingleLineTextField } from '../../fields/types/SingleLineTextField';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { ViewName } from '../../views/ViewName';
import { RecordId } from '../RecordId';
import { TableRecord } from '../TableRecord';
import { TableRecordCellValue } from '../TableRecordFields';
import { RecordConditionSpecBuilder } from './RecordConditionSpecBuilder';
import { RecordConditionLiteralValue } from './RecordConditionValues';
import { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';

const buildTable = () => {
  const baseId = BaseId.generate()._unsafeUnwrap();
  const name = FieldName.create('Name')._unsafeUnwrap();
  const score = FieldName.create('Score')._unsafeUnwrap();
  const viewName = ViewName.create('Grid')._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Records')._unsafeUnwrap());

  builder.field().singleLineText().withName(name).primary().done();
  builder.field().number().withName(score).done();
  builder.view().grid().withName(viewName).done();

  return builder.build()._unsafeUnwrap();
};

describe('RecordConditionSpec', () => {
  it('evaluates single line text conditions', () => {
    const table = buildTable();
    const textField = table
      .getField((field): field is SingleLineTextField =>
        field.type().equals(FieldType.singleLineText())
      )
      ._unsafeUnwrap();

    const record = TableRecord.create({
      id: RecordId.generate()._unsafeUnwrap(),
      tableId: table.id(),
      fieldValues: [
        {
          fieldId: textField.id(),
          value: TableRecordCellValue.create('hello world')._unsafeUnwrap(),
        },
      ],
    })._unsafeUnwrap();

    const containsValue = RecordConditionLiteralValue.create('hello')._unsafeUnwrap();
    const containsSpec = SingleLineTextConditionSpec.create(textField, 'contains', containsValue);
    expect(containsSpec.isSatisfiedBy(record)).toBe(true);

    const missValue = RecordConditionLiteralValue.create('nope')._unsafeUnwrap();
    const missSpec = SingleLineTextConditionSpec.create(textField, 'contains', missValue);
    expect(missSpec.isSatisfiedBy(record)).toBe(false);
  });

  it('composes and/not specs with the builder', () => {
    const table = buildTable();
    const textField = table
      .getField((field): field is SingleLineTextField =>
        field.type().equals(FieldType.singleLineText())
      )
      ._unsafeUnwrap();
    const numberField = table
      .getField((field): field is NumberField => field.type().equals(FieldType.number()))
      ._unsafeUnwrap();

    const record = TableRecord.create({
      id: RecordId.generate()._unsafeUnwrap(),
      tableId: table.id(),
      fieldValues: [
        {
          fieldId: textField.id(),
          value: TableRecordCellValue.create('hello world')._unsafeUnwrap(),
        },
        {
          fieldId: numberField.id(),
          value: TableRecordCellValue.create(5)._unsafeUnwrap(),
        },
      ],
    })._unsafeUnwrap();

    const builder = RecordConditionSpecBuilder.create('and');
    builder.addCondition({
      field: textField,
      operator: 'contains',
      value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
    });
    builder.addCondition({
      field: numberField,
      operator: 'isGreater',
      value: RecordConditionLiteralValue.create(3)._unsafeUnwrap(),
    });

    const spec = builder.build()._unsafeUnwrap();
    expect(spec.isSatisfiedBy(record)).toBe(true);

    const notBuilder = RecordConditionSpecBuilder.create('and');
    notBuilder.not((child) =>
      child.addCondition({
        field: textField,
        operator: 'contains',
        value: RecordConditionLiteralValue.create('hello')._unsafeUnwrap(),
      })
    );

    const notSpec = notBuilder.build()._unsafeUnwrap();
    expect(notSpec.isSatisfiedBy(record)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { AndSpec } from '../../shared/specification/AndSpec';
import { OrSpec } from '../../shared/specification/OrSpec';
import { createSingleLineTextField } from '../fields/FieldFactory';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { TableId } from '../TableId';
import { ViewId } from '../views/ViewId';
import { RecordId } from './RecordId';
import { materializeRecordSpec } from './RecordSpecMaterializer';
import { recordToFieldValues } from './recordToFieldValues';
import { ClearFieldValueSpec } from './specs/values/ClearFieldValueSpec';
import type { ICellValueSpec, ICellValueSpecVisitor } from './specs/values/ICellValueSpecVisitor';
import { SetLinkValueByTitleSpec } from './specs/values/SetLinkValueByTitleSpec';
import { SetNumberValueSpec } from './specs/values/SetNumberValueSpec';
import { SetRowOrderValueSpec } from './specs/values/SetRowOrderValueSpec';
import { SetSingleLineTextValueSpec } from './specs/values/SetSingleLineTextValueSpec';
import { SetUserValueByIdentifierSpec } from './specs/values/SetUserValueByIdentifierSpec';
import { TableRecord } from './TableRecord';
import { TableRecordCellValue } from './TableRecordFields';
import { CellValue } from './values/CellValue';

const tableId = TableId.create('tbl0000000000000001')._unsafeUnwrap();
const recordId = RecordId.create('rec0000000000000001')._unsafeUnwrap();
const textFieldId = FieldId.create('fld0000000000000001')._unsafeUnwrap();
const numberFieldId = FieldId.create('fld0000000000000002')._unsafeUnwrap();
const notesFieldId = FieldId.create('fld0000000000000003')._unsafeUnwrap();

const textField = createSingleLineTextField({
  id: textFieldId,
  name: FieldName.create('Title')._unsafeUnwrap(),
})._unsafeUnwrap();

const and = (left: ICellValueSpec, right: ICellValueSpec): ICellValueSpec =>
  new AndSpec<TableRecord, ICellValueSpecVisitor>(left, right);

const emptyRecord = TableRecord.create({ id: recordId, tableId, fieldValues: [] })._unsafeUnwrap();

describe('materializeRecordSpec', () => {
  it('matches ordered mutation semantics while replacing duplicate fields in place', () => {
    const firstText = new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('first'));
    const number = new SetNumberValueSpec(numberFieldId, CellValue.fromValidated(42));
    const clearText = ClearFieldValueSpec.create(textField);
    const finalText = new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('last'));
    const spec = and(and(firstText, number), and(clearText, finalText));

    const sequential = spec.mutate(emptyRecord)._unsafeUnwrap();
    const materialized = materializeRecordSpec({
      id: recordId,
      tableId,
      spec,
    })._unsafeUnwrap();

    expect(recordToFieldValues(materialized)).toEqual(recordToFieldValues(sequential));
    expect(recordToFieldValues(materialized)).toEqual([
      { fieldId: textFieldId.toString(), value: 'last' },
      { fieldId: numberFieldId.toString(), value: 42 },
    ]);
  });

  it('preserves deferred lookup and row-order specs as in-memory no-ops', () => {
    const deferredLink = SetLinkValueByTitleSpec.create(textFieldId, tableId, ['Example']);
    const deferredUser = SetUserValueByIdentifierSpec.create(
      numberFieldId,
      ['user@example.com'],
      false
    );
    const rowOrder = new SetRowOrderValueSpec(
      ViewId.create('viw0000000000000001')._unsafeUnwrap(),
      1
    );
    const spec = and(and(deferredLink, deferredUser), rowOrder);

    const sequential = spec.mutate(emptyRecord)._unsafeUnwrap();
    const materialized = materializeRecordSpec({
      id: recordId,
      tableId,
      spec,
    })._unsafeUnwrap();

    expect(recordToFieldValues(materialized)).toEqual(recordToFieldValues(sequential));
    expect(recordToFieldValues(materialized)).toEqual([]);
  });

  it('merges spec cells into an existing record without moving untouched fields', () => {
    const baseRecord = TableRecord.create({
      id: recordId,
      tableId,
      fieldValues: [
        {
          fieldId: textFieldId,
          value: TableRecordCellValue.create('old')._unsafeUnwrap(),
        },
        {
          fieldId: numberFieldId,
          value: TableRecordCellValue.create(1)._unsafeUnwrap(),
        },
      ],
    })._unsafeUnwrap();
    const spec = and(
      new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('new')),
      new SetSingleLineTextValueSpec(notesFieldId, CellValue.fromValidated('added'))
    );

    const sequential = spec.mutate(baseRecord)._unsafeUnwrap();
    const materialized = materializeRecordSpec({
      id: recordId,
      tableId,
      spec,
      baseFields: baseRecord.fields().entries(),
    })._unsafeUnwrap();

    expect(recordToFieldValues(materialized)).toEqual(recordToFieldValues(sequential));
    expect(recordToFieldValues(materialized)).toEqual([
      { fieldId: textFieldId.toString(), value: 'new' },
      { fieldId: numberFieldId.toString(), value: 1 },
      { fieldId: notesFieldId.toString(), value: 'added' },
    ]);
  });
  it('rejects conditional OR mutation instead of applying both branches', () => {
    const spec = new OrSpec<TableRecord, ICellValueSpecVisitor>(
      new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('first')),
      new SetSingleLineTextValueSpec(textFieldId, CellValue.fromValidated('second'))
    );
    const result = materializeRecordSpec({ id: recordId, tableId, spec });
    expect(result._unsafeUnwrapErr().code).toBe('record.materialize.unsupported_mutation_spec');
  });
});

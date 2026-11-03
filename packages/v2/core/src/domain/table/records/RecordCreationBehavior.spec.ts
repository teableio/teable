import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import { AndSpec } from '../../shared/specification/AndSpec';
import { isRecordCreatedEvent } from '../events/RecordCreated';
import type { RecordCreateSource } from '../events/RecordFieldValuesDTO';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { FieldNotNull } from '../fields/types/FieldNotNull';
import { NumberDefaultValue } from '../fields/types/NumberDefaultValue';
import { TextDefaultValue } from '../fields/types/TextDefaultValue';
import { UserMultiplicity } from '../fields/types/UserMultiplicity';
import { Table } from '../Table';
import { TableId } from '../TableId';
import { TableName } from '../TableName';
import { RecordId } from './RecordId';
import { recordToFieldValues } from './recordToFieldValues';
import type { ICellValueSpec, ICellValueSpecVisitor } from './specs/values/ICellValueSpecVisitor';
import { SetUserValueByIdentifierSpec } from './specs/values/SetUserValueByIdentifierSpec';
import { SetUserValueSpec } from './specs/values/SetUserValueSpec';
import { TableRecord } from './TableRecord';
import { CellValue } from './values/CellValue';

const createFieldId = (seed: string): FieldId =>
  FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const createFieldName = (name: string): FieldName => FieldName.create(name)._unsafeUnwrap();

type FieldDefinition =
  | { type: 'text'; id: FieldId; name: string; primary?: boolean; defaultValue?: string }
  | { type: 'number'; id: FieldId; name: string; defaultValue?: number; notNull?: boolean }
  | { type: 'checkbox'; id: FieldId; name: string }
  | { type: 'user'; id: FieldId; name: string; multiple?: boolean };

const buildTable = (seed: string, fieldDefinitions: ReadonlyArray<FieldDefinition>): Table => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create(`Creation ${seed}`)._unsafeUnwrap());

  for (const definition of fieldDefinitions) {
    switch (definition.type) {
      case 'text': {
        const textFieldBuilder = builder
          .field()
          .singleLineText()
          .withId(definition.id)
          .withName(createFieldName(definition.name));
        if (definition.defaultValue !== undefined) {
          textFieldBuilder.withDefaultValue(
            TextDefaultValue.create(definition.defaultValue)._unsafeUnwrap()
          );
        }
        if (definition.primary) textFieldBuilder.primary();
        textFieldBuilder.done();
        break;
      }
      case 'number': {
        const numberFieldBuilder = builder
          .field()
          .number()
          .withId(definition.id)
          .withName(createFieldName(definition.name));
        if (definition.defaultValue !== undefined) {
          numberFieldBuilder.withDefaultValue(
            NumberDefaultValue.create(definition.defaultValue)._unsafeUnwrap()
          );
        }
        if (definition.notNull) numberFieldBuilder.withNotNull(FieldNotNull.required());
        numberFieldBuilder.done();
        break;
      }
      case 'checkbox': {
        builder
          .field()
          .checkbox()
          .withId(definition.id)
          .withName(createFieldName(definition.name))
          .done();
        break;
      }
      case 'user': {
        const userFieldBuilder = builder
          .field()
          .user()
          .withId(definition.id)
          .withName(createFieldName(definition.name));
        if (definition.multiple) userFieldBuilder.withMultiplicity(UserMultiplicity.multiple());
        userFieldBuilder.done();
        break;
      }
    }
  }

  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
  return table;
};

const isAndSpec = (spec: ICellValueSpec): spec is AndSpec<TableRecord, ICellValueSpecVisitor> =>
  spec instanceof AndSpec;

const flattenSpec = (spec: ICellValueSpec): ReadonlyArray<ICellValueSpec> =>
  isAndSpec(spec) ? [...flattenSpec(spec.leftSpec()), ...flattenSpec(spec.rightSpec())] : [spec];

describe('record creation key resolution', () => {
  it('keeps the last value and surviving key when a field is addressed by name and id', () => {
    const titleFieldId = createFieldId('a');
    const table = buildTable('a', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
    ]);

    const nameThenIdValues = new Map<string, unknown>([
      ['Title', 'by-name'],
      [titleFieldId.toString(), 'by-id'],
    ]);
    const nameThenId = table.createRecord(nameThenIdValues)._unsafeUnwrap();
    expect(nameThenId.record.fields().get(titleFieldId)?.toValue()).toBe('by-id');
    expect(nameThenId.fieldKeyMapping.get(titleFieldId.toString())).toBe(titleFieldId.toString());

    const idThenNameValues = new Map<string, unknown>([
      [titleFieldId.toString(), 'by-id'],
      ['Title', 'by-name'],
    ]);
    const idThenName = table.createRecord(idThenNameValues)._unsafeUnwrap();
    expect(idThenName.record.fields().get(titleFieldId)?.toValue()).toBe('by-name');
    expect(idThenName.fieldKeyMapping.get(titleFieldId.toString())).toBe('Title');
    expect(recordToFieldValues(idThenName.record)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'by-name' },
    ]);
  });

  it('validates only the alias value that survives key resolution', () => {
    const titleFieldId = createFieldId('b');
    const scoreFieldId = createFieldId('c');
    const table = buildTable('b', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: scoreFieldId, name: 'Score' },
    ]);

    const overwrittenValues = new Map<string, unknown>([
      ['Score', 'not-a-number'],
      [scoreFieldId.toString(), 42],
    ]);
    const overwritten = table.createRecord(overwrittenValues)._unsafeUnwrap();
    expect(overwritten.record.fields().get(scoreFieldId)?.toValue()).toBe(42);

    const survivingValues = new Map<string, unknown>([
      [scoreFieldId.toString(), 42],
      ['Score', 'not-a-number'],
    ]);
    const surviving = table.createRecord(survivingValues);
    expect(surviving._unsafeUnwrapErr().code).toBe('validation.field.invalid_value');
  });
});

describe('record creation value resolution', () => {
  it('distinguishes explicit null, present undefined and omitted values in one batch', () => {
    const titleFieldId = createFieldId('d');
    const countFieldId = createFieldId('e');
    const approvedFieldId = createFieldId('f');
    const table = buildTable('d', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true, defaultValue: 'Default' },
      { type: 'number', id: countFieldId, name: 'Count', defaultValue: 7 },
      { type: 'checkbox', id: approvedFieldId, name: 'Approved' },
    ]);

    const clearedValues = new Map<string, unknown>([
      ['Title', null],
      ['Count', undefined],
      ['Approved', false],
    ]);
    const typedValues = new Map<string, unknown>([
      ['Title', '  Hello\tworld  '],
      ['Count', 0],
    ]);
    const defaultedValues = new Map<string, unknown>([]);

    const createResult = table.createRecords([clearedValues, typedValues, defaultedValues]);
    const { records } = createResult._unsafeUnwrap();

    expect(records.map((record) => recordToFieldValues(record))).toEqual([
      [
        { fieldId: titleFieldId.toString(), value: null },
        { fieldId: countFieldId.toString(), value: null },
        { fieldId: approvedFieldId.toString(), value: null },
      ],
      [
        { fieldId: titleFieldId.toString(), value: 'Hello world' },
        { fieldId: countFieldId.toString(), value: 0 },
      ],
      [
        { fieldId: titleFieldId.toString(), value: 'Default' },
        { fieldId: countFieldId.toString(), value: 7 },
      ],
    ]);
    expect(records[1]?.fields().get(approvedFieldId)).toBeUndefined();
    expect(records[2]?.fields().get(approvedFieldId)).toBeUndefined();
  });

  it('reports a missing notNull field before collected value errors', () => {
    const titleFieldId = createFieldId('g');
    const scoreFieldId = createFieldId('h');
    const amountFieldId = createFieldId('i');
    const table = buildTable('g', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: scoreFieldId, name: 'Score' },
      { type: 'number', id: amountFieldId, name: 'Amount', notNull: true },
    ]);

    const missingValues = new Map<string, unknown>([['Score', 'not-a-number']]);
    const missingRequiredError = table.createRecord(missingValues)._unsafeUnwrapErr();
    expect(missingRequiredError.code).toBe('validation.field.not_null');
    expect(missingRequiredError.details?.fieldId).toBe(amountFieldId.toString());

    const explicitNullValues = new Map<string, unknown>([
      ['Amount', null],
      ['Score', 1],
    ]);
    const explicitNullError = table.createRecord(explicitNullValues)._unsafeUnwrapErr();
    expect(explicitNullError.code).toBe('validation.field.not_null');
    expect(explicitNullError.details?.fieldId).toBe(amountFieldId.toString());

    const invalidValues = new Map<string, unknown>([
      ['Amount', 5],
      ['Score', 'not-a-number'],
    ]);
    const invalidValueError = table.createRecord(invalidValues)._unsafeUnwrapErr();
    expect(invalidValueError.code).toBe('validation.field.invalid_value');
    expect(invalidValueError.details?.fieldId).toBe(scoreFieldId.toString());
  });

  it('converts typecast input through the field visitors', () => {
    const titleFieldId = createFieldId('j');
    const scoreFieldId = createFieldId('k');
    const table = buildTable('j', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'number', id: scoreFieldId, name: 'Score' },
    ]);

    const strictValues = new Map<string, unknown>([['Score', '1,234']]);
    const strict = table.createRecord(strictValues);
    expect(strict._unsafeUnwrapErr().code).toBe('validation.field.invalid_value');

    const typecastValues = new Map<string, unknown>([
      ['Title', 42],
      ['Score', '1,234'],
    ]);
    const typecast = table.createRecord(typecastValues, { typecast: true })._unsafeUnwrap();
    expect(typecast.record.fields().get(scoreFieldId)?.toValue()).toBe(1234);
    expect(typecast.record.fields().get(titleFieldId)?.toValue()).toBe('42');
  });
});

describe('record creation deferred values', () => {
  it('materializes concrete user values while keeping deferred identifiers in the spec', () => {
    const titleFieldId = createFieldId('m');
    const ownerFieldId = createFieldId('n');
    const reviewersFieldId = createFieldId('o');
    const table = buildTable('m', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'user', id: ownerFieldId, name: 'Owner' },
      { type: 'user', id: reviewersFieldId, name: 'Reviewers', multiple: true },
    ]);

    // A single-user cell normalizes the item list down to its first item.
    const owner = { id: 'usr0000000000000001', title: 'Alpha' };
    const values = new Map<string, unknown>([
      ['Title', 'Planning'],
      ['Owner', [owner]],
      ['Reviewers', 'reviewer@example.com'],
    ]);
    const result = table.createRecord(values, { typecast: true })._unsafeUnwrap();

    expect(recordToFieldValues(result.record)).toEqual([
      { fieldId: titleFieldId.toString(), value: 'Planning' },
      { fieldId: ownerFieldId.toString(), value: owner },
    ]);
    expect(result.record.fields().get(reviewersFieldId)).toBeUndefined();

    const mutateSpec = result.mutateSpec;
    expect(mutateSpec).not.toBeNull();
    if (!mutateSpec) throw new Error('expected a mutation spec for provided values');

    const leaves = flattenSpec(mutateSpec);
    expect(leaves.some((leaf) => leaf instanceof SetUserValueSpec)).toBe(true);

    const deferred = leaves.find((leaf) => leaf instanceof SetUserValueByIdentifierSpec);
    expect(deferred).toBeInstanceOf(SetUserValueByIdentifierSpec);
    if (!(deferred instanceof SetUserValueByIdentifierSpec)) {
      throw new Error('expected a deferred user identifier spec');
    }
    expect(deferred.fieldId.toString()).toBe(reviewersFieldId.toString());
    expect(deferred.identifiers).toEqual(['reviewer@example.com']);

    const emptyRecordResult = TableRecord.create({
      id: RecordId.create('rec0000000000000001')._unsafeUnwrap(),
      tableId: table.id(),
      fieldValues: [],
    });
    const emptyRecord = emptyRecordResult._unsafeUnwrap();
    expect(recordToFieldValues(mutateSpec.mutate(emptyRecord)._unsafeUnwrap())).toEqual(
      recordToFieldValues(result.record)
    );

    const replacedResult = result.record.setFieldValue(
      titleFieldId,
      CellValue.fromValidated('Changed')
    );
    const replaced = replacedResult._unsafeUnwrap();
    expect(result.record.fields().get(titleFieldId)?.toValue()).toBe('Planning');
    expect(replaced.fields().get(titleFieldId)?.toValue()).toBe('Changed');
  });
});

describe('record creation events', () => {
  it('emits RecordCreated with the materialized identity, normalized fields and source', () => {
    const titleFieldId = createFieldId('p');
    const approvedFieldId = createFieldId('q');
    const table = buildTable('p', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
      { type: 'checkbox', id: approvedFieldId, name: 'Approved' },
    ]);
    const source: RecordCreateSource = { type: 'form', formId: 'frm0000000000000001' };
    const values = new Map<string, unknown>([
      ['Title', '  padded\ttext '],
      ['Approved', false],
    ]);

    const result = table.createRecord(values, { source })._unsafeUnwrap();

    const events = table.pullDomainEvents().filter(isRecordCreatedEvent);
    expect(events).toHaveLength(1);
    const [event] = events;
    if (!event) throw new Error('expected a RecordCreated event');
    expect(event.recordId.toString()).toBe(result.record.id().toString());
    expect(event.fieldValues).toEqual(recordToFieldValues(result.record));
    expect(event.fieldValues).toEqual([
      { fieldId: titleFieldId.toString(), value: 'padded text' },
      { fieldId: approvedFieldId.toString(), value: null },
    ]);
    expect(event.source).toEqual(source);
  });

  it('suppresses RecordCreated events when the batch caller publishes its own', () => {
    const titleFieldId = createFieldId('r');
    const table = buildTable('r', [
      { type: 'text', id: titleFieldId, name: 'Title', primary: true },
    ]);
    const batch = [
      new Map<string, unknown>([['Title', 'first']]),
      new Map<string, unknown>([['Title', 'second']]),
    ];

    const created = table.createRecords(batch)._unsafeUnwrap();
    const events = table.pullDomainEvents().filter(isRecordCreatedEvent);
    expect(events.map((event) => event.recordId.toString())).toEqual(
      created.records.map((record) => record.id().toString())
    );
    expect(events.map((event) => event.fieldValues)).toEqual(
      created.records.map((record) => recordToFieldValues(record))
    );

    table.createRecords(batch, { emitRecordCreatedEvents: false })._unsafeUnwrap();
    expect(table.pullDomainEvents()).toEqual([]);
  });
});

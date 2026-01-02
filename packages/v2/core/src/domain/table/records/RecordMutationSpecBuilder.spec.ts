import { describe, expect, it } from 'vitest';

import {
  createNumberField,
  createRatingField,
  createSingleLineTextField,
  createSingleSelectField,
} from '../fields/FieldFactory';
import { FieldId } from '../fields/FieldId';
import { FieldName } from '../fields/FieldName';
import { RatingMax } from '../fields/types/RatingMax';
import { SelectOption } from '../fields/types/SelectOption';
import { TableId } from '../TableId';
import { RecordId } from './RecordId';
import { RecordMutationSpecBuilder } from './RecordMutationSpecBuilder';
import { TableRecord } from './TableRecord';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const createTableIdHelper = (seed: string) =>
  TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createRecordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();

describe('RecordMutationSpecBuilder', () => {
  const textField = createSingleLineTextField({
    id: createFieldId('a'),
    name: createFieldName('Name'),
  })._unsafeUnwrap();

  const numberField = createNumberField({
    id: createFieldId('b'),
    name: createFieldName('Age'),
  })._unsafeUnwrap();

  const ratingMaxResult = RatingMax.create(5)._unsafeUnwrap();
  const ratingField = createRatingField({
    id: createFieldId('c'),
    name: createFieldName('Rating'),
    max: ratingMaxResult,
  })._unsafeUnwrap();

  const optionResult = SelectOption.create({ name: 'Option1', color: 'blue' })._unsafeUnwrap();
  const selectField = createSingleSelectField({
    id: createFieldId('d'),
    name: createFieldName('Status'),
    options: [optionResult],
  })._unsafeUnwrap();

  const tableId = createTableIdHelper('t');
  const recordId = createRecordId('r');

  const createEmptyRecord = () =>
    TableRecord.create({
      id: recordId,
      tableId,
      fieldValues: [],
    })._unsafeUnwrap();

  describe('create', () => {
    it('should create an empty builder', () => {
      const builder = RecordMutationSpecBuilder.create();
      expect(builder.hasSpecs()).toBe(false);
      expect(builder.hasErrors()).toBe(false);
    });
  });

  describe('set', () => {
    it('should add a valid text value', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John');
      expect(builder.hasSpecs()).toBe(true);
      expect(builder.hasErrors()).toBe(false);
    });

    it('should add a valid number value', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(numberField, 42);
      expect(builder.hasSpecs()).toBe(true);
      expect(builder.hasErrors()).toBe(false);
    });

    it('should add a valid rating value within range', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(ratingField, 3);
      expect(builder.hasSpecs()).toBe(true);
      expect(builder.hasErrors()).toBe(false);
    });

    it('should collect error for invalid rating value', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(ratingField, 10); // Max is 5
      expect(builder.hasSpecs()).toBe(false);
      expect(builder.hasErrors()).toBe(true);
    });

    it('should add null value for nullable field', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, null);
      expect(builder.hasSpecs()).toBe(true);
      expect(builder.hasErrors()).toBe(false);
    });

    it('should chain multiple set calls', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John').set(numberField, 30);
      expect(builder.hasSpecs()).toBe(true);
    });

    it('should add a valid select value', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(selectField, optionResult.id().toString());
      expect(builder.hasSpecs()).toBe(true);
      expect(builder.hasErrors()).toBe(false);
    });
  });

  describe('build', () => {
    it('should return error when no specs', () => {
      const builder = RecordMutationSpecBuilder.create();
      const result = builder.build();
      expect(result.isErr()).toBe(true);
    });

    it('should return error when has validation errors', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(ratingField, 100); // Invalid
      const result = builder.build();
      expect(result.isErr()).toBe(true);
    });

    it('should return single spec when only one set', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John');
      const result = builder.build();
      expect(result.isOk()).toBe(true);
    });

    it('should return combined spec when multiple sets', () => {
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John').set(numberField, 30);
      const result = builder.build();
      expect(result.isOk()).toBe(true);
    });
  });

  describe('buildAndMutate', () => {
    it('should mutate record with single field', () => {
      const record = createEmptyRecord();
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John');

      const result = builder.buildAndMutate(record);
      expect(result.isOk()).toBe(true);

      const mutatedRecord = result._unsafeUnwrap();
      const fieldValue = mutatedRecord.fields().get(textField.id());
      expect(fieldValue).toBeDefined();
      expect(fieldValue?.toValue()).toBe('John');
    });

    it('should mutate record with multiple fields', () => {
      const record = createEmptyRecord();
      const builder = RecordMutationSpecBuilder.create();
      builder.set(textField, 'John').set(numberField, 30);

      const result = builder.buildAndMutate(record);
      expect(result.isOk()).toBe(true);

      const mutatedRecord = result._unsafeUnwrap();
      expect(mutatedRecord.fields().get(textField.id())?.toValue()).toBe('John');
      expect(mutatedRecord.fields().get(numberField.id())?.toValue()).toBe(30);
    });

    it('should return error for invalid values', () => {
      const record = createEmptyRecord();
      const builder = RecordMutationSpecBuilder.create();
      builder.set(ratingField, 100); // Invalid

      const result = builder.buildAndMutate(record);
      expect(result.isErr()).toBe(true);
    });
  });
});

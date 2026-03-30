import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { BaseId } from '../domain/base/BaseId';
import { BaseId as ConcreteBaseId } from '../domain/base/BaseId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { Field } from '../domain/table/fields/Field';
import { createNumberField, createSingleLineTextField } from '../domain/table/fields/FieldFactory';
import type { LinkForeignTableReference } from '../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import type { TableId } from '../domain/table/TableId';
import { TypeConversionUpdateSpec } from './TypeConversionUpdateSpec';
import type { ICreateTableFieldSpec } from './TableFieldSpecs';

const createTextField = (seed: string) =>
  createSingleLineTextField({
    id: FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create(`Text ${seed}`)._unsafeUnwrap(),
  })._unsafeUnwrap();

const createNumberFieldInstance = (seed: string) =>
  createNumberField({
    id: FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create(`Number ${seed}`)._unsafeUnwrap(),
  })._unsafeUnwrap();

class FakeCreateTableFieldSpec implements ICreateTableFieldSpec {
  constructor(
    private readonly fieldResult: ReturnType<typeof ok<Field>> | ReturnType<typeof err>,
    private readonly refs: ReadonlyArray<LinkForeignTableReference> = []
  ) {}

  createField(_params?: { baseId?: BaseId; tableId?: TableId }) {
    return this.fieldResult;
  }

  foreignTableReferences() {
    return ok(this.refs);
  }
}

describe('TypeConversionUpdateSpec', () => {
  it('builds a single TableUpdateFieldTypeSpec for successful conversion', () => {
    const oldField = createTextField('h');
    const newField = createNumberFieldInstance('i');
    const spec = TypeConversionUpdateSpec.create(
      oldField,
      new FakeCreateTableFieldSpec(ok(newField))
    );

    const result = spec.buildSpecs(oldField);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(spec.isTypeConversion()).toBe(true);
    expect(spec.oldFieldType()).toBe('singleLineText');
    expect(spec.newFieldType()._unsafeUnwrap()).toBe('number');
  });

  it('rejects when currentField does not match the original field', () => {
    const oldField = createTextField('j');
    const otherField = createTextField('k');
    const spec = TypeConversionUpdateSpec.create(
      oldField,
      new FakeCreateTableFieldSpec(ok(createNumberFieldInstance('l')))
    );

    const result = spec.buildSpecs(otherField);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('currentField does not match oldField');
  });

  it('propagates createField failures and foreign table references', () => {
    const oldField = createTextField('m');
    const baseId = ConcreteBaseId.create(`bse${'n'.repeat(16)}`)._unsafeUnwrap();
    const failure = domainError.validation({
      code: 'type_conversion.create_failed',
      message: 'create failed',
    });
    const refs = [
      { fieldId: oldField.id(), tableId: oldField.id() } as unknown as LinkForeignTableReference,
    ];
    const spec = TypeConversionUpdateSpec.create(
      oldField,
      new FakeCreateTableFieldSpec(err(failure), refs)
    );

    const buildResult = spec.buildSpecs(oldField);
    const createResult = spec.createField({ baseId });

    expect(buildResult.isErr()).toBe(true);
    expect(buildResult._unsafeUnwrapErr().code).toBe('type_conversion.create_failed');
    expect(createResult.isErr()).toBe(true);
    expect(spec.foreignTableReferences()._unsafeUnwrap()).toEqual(refs);
  });
});

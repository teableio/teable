import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { DbFieldName } from '../../fields/DbFieldName';
import { FieldId } from '../../fields/FieldId';
import { FieldName } from '../../fields/FieldName';
import { FieldNotNull } from '../../fields/types/FieldNotNull';
import { FieldUnique } from '../../fields/types/FieldUnique';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';
import { TableUpdateFieldConstraintsSpec } from '../TableUpdateFieldConstraintsSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = (fieldId: FieldId) => {
  const baseId = createBaseId('a');
  const tableName = TableName.create('Test')._unsafeUnwrap();
  const primaryName = FieldName.create('Title')._unsafeUnwrap();
  const numberName = FieldName.create('Amount')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(primaryName).done();
  builder.field().number().withId(fieldId).withName(numberName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('TableUpdateFieldConstraintsSpec', () => {
  it('detects notNull change', () => {
    const fieldId = createFieldId('1');
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    });

    expect(spec.isNotNullChanging()).toBe(true);
    expect(spec.isUniqueChanging()).toBe(false);
  });

  it('detects unique change', () => {
    const fieldId = createFieldId('2');
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.optional(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.enabled(),
    });

    expect(spec.isNotNullChanging()).toBe(false);
    expect(spec.isUniqueChanging()).toBe(true);
  });

  it('detects no change when values are the same', () => {
    const fieldId = createFieldId('3');
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.optional(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    });

    expect(spec.isNotNullChanging()).toBe(false);
    expect(spec.isUniqueChanging()).toBe(false);
  });

  it('exposes field id and dbFieldName', () => {
    const fieldId = createFieldId('4');
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    });

    expect(spec.fieldId().equals(fieldId)).toBe(true);
    expect(spec.dbFieldName()).toBe(dbFieldName);
    expect(spec.previousNotNull().toBoolean()).toBe(false);
    expect(spec.nextNotNull().toBoolean()).toBe(true);
  });

  it('mutates table to update constraints', () => {
    const fieldId = createFieldId('5');
    const table = buildTable(fieldId);
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.enabled(),
    });

    const result = spec.mutate(table);
    result._unsafeUnwrap();
  });

  it('accepts visitor', () => {
    const fieldId = createFieldId('6');
    const dbFieldName = DbFieldName.rehydrate('fld_amount')._unsafeUnwrap();

    const spec = TableUpdateFieldConstraintsSpec.create({
      fieldId,
      dbFieldName,
      previousNotNull: FieldNotNull.optional(),
      nextNotNull: FieldNotNull.required(),
      previousUnique: FieldUnique.disabled(),
      nextUnique: FieldUnique.disabled(),
    });

    const visitor = {
      visitTableUpdateFieldConstraints: () => ok(undefined),
    };
    spec.accept(visitor as any)._unsafeUnwrap();
  });
});

import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { SingleLineTextField } from '../../../fields/types/SingleLineTextField';
import { SingleLineTextShowAs } from '../../../fields/types/SingleLineTextShowAs';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import type { ITableSpecVisitor } from '../../ITableSpecVisitor';
import { UpdateSingleLineTextShowAsSpec } from '../UpdateSingleLineTextShowAsSpec';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTextTable = (fieldId: FieldId, showAs?: SingleLineTextShowAs) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withName(TableName.create('Text Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  const textBuilder = builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create('Email')._unsafeUnwrap());
  if (showAs) {
    textBuilder.withShowAs(showAs);
  }
  textBuilder.done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildNumberTable = (fieldId: FieldId) => {
  const builder = Table.builder()
    .withBaseId(createBaseId('b'))
    .withName(TableName.create('Wrong Type Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(fieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('UpdateSingleLineTextShowAsSpec', () => {
  const fieldId = createFieldId('c');
  const previousShowAs = SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
  const nextShowAs = SingleLineTextShowAs.create({ type: 'url' })._unsafeUnwrap();

  it('mutates the table to replace the showAs setting', () => {
    const table = buildTextTable(fieldId, previousShowAs);
    const spec = UpdateSingleLineTextShowAsSpec.create(fieldId, previousShowAs, nextShowAs);

    const result = spec.mutate(table);

    expect(result.isOk()).toBe(true);
    const updatedField = result
      ._unsafeUnwrap()
      .getField((candidate) => candidate.id().equals(fieldId))
      ._unsafeUnwrap();
    expect(updatedField).toBeInstanceOf(SingleLineTextField);
    expect((updatedField as SingleLineTextField).showAs()).toEqual(nextShowAs);
  });

  it('errors when the field is missing or not a single line text field', () => {
    const spec = UpdateSingleLineTextShowAsSpec.create(fieldId, previousShowAs, nextShowAs);

    const missingFieldTable = buildTextTable(createFieldId('d'), previousShowAs);
    expect(spec.mutate(missingFieldTable).isErr()).toBe(true);

    const wrongTypeResult = spec.mutate(buildNumberTable(fieldId));
    expect(wrongTypeResult.isErr()).toBe(true);
    expect(wrongTypeResult._unsafeUnwrapErr().message).toContain('not a single line text field');
  });

  it('accepts the table spec visitor', () => {
    let visited = false;
    const spec = UpdateSingleLineTextShowAsSpec.create(fieldId, previousShowAs, nextShowAs);
    const visitor = {
      visitUpdateSingleLineTextShowAs: () => {
        visited = true;
        return ok(undefined);
      },
    };

    expect(spec.accept(visitor as unknown as ITableSpecVisitor<void>).isOk()).toBe(true);
    expect(visited).toBe(true);
  });
});

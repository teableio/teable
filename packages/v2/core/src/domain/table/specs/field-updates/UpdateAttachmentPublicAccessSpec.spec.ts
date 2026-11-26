import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../base/BaseId';
import { FieldName } from '../../fields/FieldName';
import type { AttachmentField } from '../../fields/types/AttachmentField';
import { AttachmentPublicAccess } from '../../fields/types/AttachmentPublicAccess';
import { FieldNotNull } from '../../fields/types/FieldNotNull';
import { FieldUnique } from '../../fields/types/FieldUnique';
import { Table } from '../../Table';
import { TableName } from '../../TableName';
import { UpdateAttachmentPublicAccessSpec } from './UpdateAttachmentPublicAccessSpec';

describe('UpdateAttachmentPublicAccessSpec', () => {
  it('switches public links and keeps what the switch does not touch', () => {
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Products')._unsafeUnwrap());
    builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
    builder
      .field()
      .attachment()
      .withName(FieldName.create('Files')._unsafeUnwrap())
      .withNotNull(FieldNotNull.required())
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const field = table.getFields()[1]!;
    field.setDescription('Product photos')._unsafeUnwrap();
    field.setAiConfig({ type: 'extraction' })._unsafeUnwrap();
    field.setUnique(FieldUnique.enabled())._unsafeUnwrap();

    const next = UpdateAttachmentPublicAccessSpec.create(
      field.id(),
      AttachmentPublicAccess.disabled(),
      AttachmentPublicAccess.enabled()
    )
      .mutate(table)
      ._unsafeUnwrap();

    const switched = next.getField((f) => f.id().equals(field.id()))._unsafeUnwrap();
    expect((switched as AttachmentField).publicAccess().toBoolean()).toBe(true);
    expect(switched.description()).toBe('Product photos');
    expect(switched.aiConfig()).toEqual({ type: 'extraction' });
    expect(switched.notNull().equals(FieldNotNull.required())).toBe(true);
    expect(switched.unique().equals(FieldUnique.enabled())).toBe(true);
  });
});

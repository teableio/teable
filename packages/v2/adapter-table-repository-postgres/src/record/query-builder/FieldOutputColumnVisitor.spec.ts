import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldOutputColumnVisitor } from './FieldOutputColumnVisitor';

const asField = (id: string, columnAlias: string) =>
  ({
    id: () => ({ toString: () => id }),
    dbFieldName: () =>
      ok({
        value: () => ok(columnAlias),
      }),
  }) as never;

describe('FieldOutputColumnVisitor', () => {
  it('marks only user-like fields as user values', () => {
    const visitor = new FieldOutputColumnVisitor();

    expect(visitor.visitUserField(asField('fldUser', 'col_user'))._unsafeUnwrap()).toEqual({
      fieldId: expect.objectContaining({ toString: expect.any(Function) }),
      columnAlias: 'col_user',
      valueKind: 'user',
    });

    expect(
      visitor.visitCreatedByField(asField('fldCreatedBy', 'col_created_by'))._unsafeUnwrap()
    ).toMatchObject({
      columnAlias: 'col_created_by',
      valueKind: 'user',
    });

    expect(
      visitor
        .visitLastModifiedByField(asField('fldLastModifiedBy', 'col_last_modified_by'))
        ._unsafeUnwrap()
    ).toMatchObject({
      columnAlias: 'col_last_modified_by',
      valueKind: 'user',
    });
  });

  it('does not mark link fields as user values', () => {
    const visitor = new FieldOutputColumnVisitor();

    expect(visitor.visitLinkField(asField('fldLink', 'col_link'))._unsafeUnwrap()).toMatchObject({
      columnAlias: 'col_link',
      valueKind: undefined,
    });
  });
});

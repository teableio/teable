import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldDeleteValueVisitor } from './FieldDeleteValueVisitor';

const createLinkField = (params: {
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  hostTableName?: string;
  selfKeyName?: string;
  hasOrderColumn?: boolean;
  orderColumnName?: string;
}) => ({
  relationship: () => ({ toString: () => params.relationship }),
  isOneWay: () => params.isOneWay ?? false,
  fkHostTableName: () => ({
    split: () => {
      const raw = params.hostTableName ?? 'public.link_host';
      const [schema, tableName] = raw.includes('.') ? raw.split('.') : [undefined, raw];
      return ok({ schema, tableName });
    },
  }),
  selfKeyNameString: () => ok(params.selfKeyName ?? '__fk_self'),
  hasOrderColumn: () => params.hasOrderColumn ?? false,
  orderColumnName: () => ok(params.orderColumnName ?? '__order'),
});

describe('FieldDeleteValueVisitor', () => {
  it('returns no-op for non-link fields', () => {
    const visitor = FieldDeleteValueVisitor.create({ recordIds: ['recSource00000001'] });
    const methods = [
      'visitSingleLineTextField',
      'visitLongTextField',
      'visitNumberField',
      'visitRatingField',
      'visitFormulaField',
      'visitRollupField',
      'visitLookupField',
      'visitSingleSelectField',
      'visitMultipleSelectField',
      'visitCheckboxField',
      'visitDateField',
      'visitAttachmentField',
      'visitUserField',
      'visitCreatedTimeField',
      'visitLastModifiedTimeField',
      'visitCreatedByField',
      'visitLastModifiedByField',
      'visitAutoNumberField',
      'visitButtonField',
      'visitConditionalRollupField',
      'visitConditionalLookupField',
    ] as const;

    for (const method of methods) {
      expect(visitor[method]({} as never)._unsafeUnwrap()).toEqual({ operation: null });
    }
  });

  it('describes junction-table deletes for many-many and one-way one-many links', () => {
    const visitor = FieldDeleteValueVisitor.create({ recordIds: ['recSource00000001'] });

    const manyMany = visitor.visitLinkField(
      createLinkField({
        relationship: 'manyMany',
        hostTableName: 'public.junction_links',
        selfKeyName: '__fk_source',
      }) as never
    );
    const oneWay = visitor.visitLinkField(
      createLinkField({
        relationship: 'oneMany',
        isOneWay: true,
        hostTableName: 'junction_oneway',
        selfKeyName: '__fk_source',
      }) as never
    );

    expect(manyMany._unsafeUnwrap()).toEqual({
      operation: {
        type: 'junction-delete',
        tableName: 'public.junction_links',
        selfKeyName: '__fk_source',
      },
    });
    expect(oneWay._unsafeUnwrap()).toEqual({
      operation: {
        type: 'junction-delete',
        tableName: 'junction_oneway',
        selfKeyName: '__fk_source',
      },
    });
  });

  it('describes fk nullification for two-way one-many links and no-op for many-one/one-one', () => {
    const visitor = FieldDeleteValueVisitor.create({ recordIds: ['recSource00000001'] });

    const oneMany = visitor.visitLinkField(
      createLinkField({
        relationship: 'oneMany',
        isOneWay: false,
        hostTableName: 'public.foreign_table',
        selfKeyName: '__fk_parent',
        hasOrderColumn: true,
        orderColumnName: '__fk_parent_order',
      }) as never
    );
    const manyOne = visitor.visitLinkField(
      createLinkField({
        relationship: 'manyOne',
      }) as never
    );
    const oneOne = visitor.visitLinkField(
      createLinkField({
        relationship: 'oneOne',
      }) as never
    );

    expect(oneMany._unsafeUnwrap()).toEqual({
      operation: {
        type: 'fk-nullify',
        tableName: 'public.foreign_table',
        selfKeyName: '__fk_parent',
        orderColumnName: '__fk_parent_order',
      },
    });
    expect(manyOne._unsafeUnwrap()).toEqual({ operation: null });
    expect(oneOne._unsafeUnwrap()).toEqual({ operation: null });
  });
});

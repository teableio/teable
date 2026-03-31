import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldInsertValueVisitor } from './FieldInsertValueVisitor';

const createSelectOption = (id: string, name: string) => ({
  id: () => ({ toString: () => id }),
  name: () => ({ toString: () => name }),
});

const createSingleSelectField = () => ({
  selectOptions: () => [
    createSelectOption('choRed00000001', 'Red'),
    createSelectOption('choBlue0000001', 'Blue'),
  ],
});

const createMultipleSelectField = () => ({
  selectOptions: () => [
    createSelectOption('choRed00000001', 'Red'),
    createSelectOption('choBlue0000001', 'Blue'),
  ],
});

const createLinkField = (params: {
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  isMultipleValue?: boolean;
  hostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  hasOrderColumn?: boolean;
  orderColumnName?: string;
}) => ({
  relationship: () => ({ toString: () => params.relationship }),
  isOneWay: () => params.isOneWay ?? false,
  isMultipleValue: () =>
    params.isMultipleValue ??
    (params.relationship === 'manyMany' || params.relationship === 'oneMany'),
  fkHostTableName: () => ({
    split: () =>
      ok({
        schema: params.hostTableName?.includes('.')
          ? params.hostTableName.split('.')[0]
          : undefined,
        tableName: params.hostTableName?.includes('.')
          ? params.hostTableName.split('.')[1]
          : params.hostTableName ?? 'junction_links',
      }),
  }),
  selfKeyNameString: () => ok(params.selfKeyName ?? '__fk_self'),
  foreignKeyNameString: () => ok(params.foreignKeyName ?? '__fk_foreign'),
  hasOrderColumn: () => params.hasOrderColumn ?? false,
  orderColumnName: () => ok(params.orderColumnName ?? '__order'),
});

describe('FieldInsertValueVisitor', () => {
  it('maps primitive and computed fields into insert payloads', () => {
    const ctx = { recordId: 'recSource00000001', dbFieldName: 'title_col' };
    const primitiveVisitor = FieldInsertValueVisitor.create('plain-value', ctx);
    const computedVisitor = FieldInsertValueVisitor.create('ignored', ctx);

    expect(primitiveVisitor.visitSingleLineTextField({} as never)._unsafeUnwrap()).toEqual({
      columnValues: { title_col: 'plain-value' },
      queryExecutors: [],
    });
    expect(primitiveVisitor.visitAttachmentField({} as never)._unsafeUnwrap()).toEqual({
      columnValues: { title_col: '"plain-value"' },
      queryExecutors: [],
    });

    for (const method of [
      'visitFormulaField',
      'visitRollupField',
      'visitLookupField',
      'visitCreatedTimeField',
      'visitLastModifiedTimeField',
      'visitCreatedByField',
      'visitLastModifiedByField',
      'visitAutoNumberField',
      'visitButtonField',
      'visitConditionalRollupField',
      'visitConditionalLookupField',
    ] as const) {
      expect(computedVisitor[method]({} as never)._unsafeUnwrap()).toEqual({
        columnValues: {},
        queryExecutors: [],
      });
    }
  });

  it('maps single and multiple select values into stored payloads', () => {
    const singleVisitor = FieldInsertValueVisitor.create('choRed00000001', {
      recordId: 'recSource00000001',
      dbFieldName: 'single_sel',
    });
    const multipleVisitor = FieldInsertValueVisitor.create(['choRed00000001', 'Blue'], {
      recordId: 'recSource00000001',
      dbFieldName: 'multi_sel',
    });

    expect(
      singleVisitor.visitSingleSelectField(createSingleSelectField() as never)._unsafeUnwrap()
    ).toEqual({
      columnValues: { single_sel: 'Red' },
      queryExecutors: [],
    });
    expect(
      multipleVisitor.visitMultipleSelectField(createMultipleSelectField() as never)._unsafeUnwrap()
    ).toEqual({
      columnValues: { multi_sel: JSON.stringify(['Red', 'Blue']) },
      queryExecutors: [],
    });
  });

  it('builds junction-table executors for many-many and one-way one-many links', () => {
    const rawValue = [{ id: 'recForeign0000001' }, { id: 'recForeign0000002' }];
    const manyManyField = createLinkField({
      relationship: 'manyMany',
      isOneWay: false,
      hasOrderColumn: true,
      orderColumnName: '__order_links',
      hostTableName: 'public.junction_links',
    });
    const oneWayOneManyField = createLinkField({
      relationship: 'oneMany',
      isOneWay: true,
      hostTableName: 'junction_oneway',
    });

    const manyMany = FieldInsertValueVisitor.create(rawValue, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(manyManyField as never)
      ._unsafeUnwrap();
    const oneWay = FieldInsertValueVisitor.create(rawValue, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(oneWayOneManyField as never)
      ._unsafeUnwrap();

    expect(manyMany.columnValues.link_json).toBe(JSON.stringify(rawValue));
    expect(manyMany.queryExecutors).toHaveLength(2);
    expect(oneWay.queryExecutors).toHaveLength(2);
  });

  it('writes foreign key columns or foreign-table updates for fk-based links', () => {
    const rawValue = [{ id: 'recForeign0000001' }, { id: 'recForeign0000002' }];

    const manyOne = FieldInsertValueVisitor.create(rawValue, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(
        createLinkField({
          relationship: 'manyOne',
          foreignKeyName: '__fk_target',
          isMultipleValue: false,
        }) as never
      )
      ._unsafeUnwrap();

    const symmetric = FieldInsertValueVisitor.create(rawValue, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(
        createLinkField({
          relationship: 'oneOne',
          foreignKeyName: '__id',
          selfKeyName: '__fk_backref',
          hostTableName: 'public.foreign_table',
          hasOrderColumn: true,
        }) as never
      )
      ._unsafeUnwrap();

    const oneMany = FieldInsertValueVisitor.create(rawValue, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(
        createLinkField({
          relationship: 'oneMany',
          isOneWay: false,
          selfKeyName: '__fk_parent',
          hostTableName: 'public.foreign_table',
          hasOrderColumn: true,
          orderColumnName: '__fk_parent_order',
        }) as never
      )
      ._unsafeUnwrap();

    expect(manyOne.columnValues.__fk_target).toBe('recForeign0000001');
    expect(manyOne.queryExecutors).toHaveLength(0);
    expect(symmetric.queryExecutors).toHaveLength(1);
    expect(oneMany.queryExecutors).toHaveLength(2);
  });

  it('stores null when link values are empty or absent', () => {
    const linkField = createLinkField({
      relationship: 'manyMany',
      hostTableName: 'public.junction_links',
    });

    const absent = FieldInsertValueVisitor.create(null, {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(linkField as never)
      ._unsafeUnwrap();
    const empty = FieldInsertValueVisitor.create([], {
      recordId: 'recSource00000001',
      dbFieldName: 'link_json',
    })
      .visitLinkField(linkField as never)
      ._unsafeUnwrap();

    expect(absent.columnValues.link_json).toBeNull();
    expect(absent.queryExecutors).toHaveLength(0);
    expect(empty.columnValues.link_json).toBe(JSON.stringify([]));
    expect(empty.queryExecutors).toHaveLength(0);
  });
});

import {
  CellValue,
  FieldId,
  SetLinkValueByTitleSpec,
  SetLinkValueSpec,
  SetUserValueByIdentifierSpec,
  TableId,
  domainError,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { MAX_FILLED_LINK_VALUE_ITEMS } from '../buildFilledLinkValueExpression';
import { createTestDb } from '../../schema/visitors/__tests__/helpers/createTestDb';
import { CellValueMutateVisitor } from './CellValueMutateVisitor';

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const mkFieldId = (seed: string) =>
  FieldId.create(`fld${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkTableId = (seed: string) =>
  TableId.create(`tbl${seed.padEnd(16, '0').slice(0, 16)}`)._unsafeUnwrap();
const mkRecordId = (seed: string) => `rec${seed.padEnd(16, '0').slice(0, 16)}`;

const createType = (name: string) => ({
  toString: () => name,
  equals: (other: { toString(): string }) => other.toString() === name,
});

const createField = (params: {
  fieldId: string;
  type: string;
  dbFieldName: string;
  computed?: boolean;
}) => {
  const fieldId = mkFieldId(params.fieldId);
  return {
    id: () => fieldId,
    type: () => createType(params.type),
    computed: () => ({ toBoolean: () => params.computed ?? false }),
    dbFieldName: () =>
      ok({
        value: () => ok(params.dbFieldName),
      }),
  };
};

const createLinkField = (params: {
  fieldId: string;
  dbFieldName: string;
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  isMultipleValue?: boolean;
  foreignTableId?: string;
  lookupFieldId?: string;
  hostTableName?: string;
  selfKeyName?: string;
  foreignKeyName?: string;
  hasOrderColumn?: boolean;
  orderColumnName?: string;
}) => {
  const baseField = createField({
    fieldId: params.fieldId,
    type: 'link',
    dbFieldName: params.dbFieldName,
  });
  return {
    ...baseField,
    relationship: () => ({ toString: () => params.relationship }),
    isOneWay: () => params.isOneWay ?? false,
    isMultipleValue: () =>
      params.isMultipleValue ??
      (params.relationship === 'manyMany' || params.relationship === 'oneMany'),
    foreignTableId: () => mkTableId(params.foreignTableId ?? 'foreign'),
    lookupFieldId: () => mkFieldId(params.lookupFieldId ?? 'lookup'),
    fkHostTableName: () => ({
      split: () => {
        const raw = params.hostTableName ?? 'public.link_host';
        const [schema, tableName] = raw.includes('.') ? raw.split('.') : [undefined, raw];
        return ok({ schema, tableName });
      },
    }),
    selfKeyNameString: () => ok(params.selfKeyName ?? '__fk_self'),
    foreignKeyNameString: () => ok(params.foreignKeyName ?? '__fk_foreign'),
    hasOrderColumn: () => params.hasOrderColumn ?? false,
    orderColumnName: () => ok(params.orderColumnName ?? '__order'),
  };
};

const createTrackedLastModifiedTimeField = (params: {
  fieldId: string;
  dbFieldName: string;
  trackedFieldIds?: FieldId[];
  persistedAsGeneratedColumn?: boolean;
}) => {
  const baseField = createField({
    fieldId: params.fieldId,
    type: 'lastModifiedTime',
    dbFieldName: params.dbFieldName,
    computed: true,
  });
  const field = {
    ...baseField,
    trackedFieldIds: () => params.trackedFieldIds ?? [],
    isPersistedAsGeneratedColumn: () => ok(params.persistedAsGeneratedColumn ?? false),
    accept: (visitor: { visitLastModifiedTimeField: (field: unknown) => unknown }) =>
      visitor.visitLastModifiedTimeField(field as never) as never,
  };
  return field;
};

const createTrackedLastModifiedByField = (params: {
  fieldId: string;
  dbFieldName: string;
  trackedFieldIds?: FieldId[];
  persistedAsGeneratedColumn?: boolean;
}) => {
  const baseField = createField({
    fieldId: params.fieldId,
    type: 'lastModifiedBy',
    dbFieldName: params.dbFieldName,
    computed: true,
  });
  const field = {
    ...baseField,
    trackedFieldIds: () => params.trackedFieldIds ?? [],
    isPersistedAsGeneratedColumn: () => ok(params.persistedAsGeneratedColumn ?? false),
    accept: (visitor: { visitLastModifiedByField: (field: unknown) => unknown }) =>
      visitor.visitLastModifiedByField(field as never) as never,
  };
  return field;
};

const createTable = (...fields: Array<ReturnType<typeof createField>>) => ({
  getField: (predicate: (field: ReturnType<typeof createField>) => boolean) => {
    const field = fields.find(predicate);
    return field ? ok(field) : err(domainError.notFound({ message: 'Field not found' }));
  },
  getFields: (
    predicate?: (field: ReturnType<typeof createField>) => boolean
  ): Array<ReturnType<typeof createField>> => (predicate ? fields.filter(predicate) : fields),
});

const createVisitor = (...fields: Array<ReturnType<typeof createField>>) =>
  CellValueMutateVisitor.create(
    createTestDb() as never,
    createTable(...fields) as never,
    'public.records',
    {
      recordId: mkRecordId('source'),
      actorId: 'usrActor000000001',
      now: '2025-01-01T00:00:00.000Z',
    }
  );

const createForeignTable = (params: {
  tableId?: string;
  dbTableName: string;
  lookupFieldId?: string;
  lookupDbFieldName: string;
}) => ({
  id: () => mkTableId(params.tableId ?? 'foreign'),
  dbTableName: () =>
    ok({
      value: () => ok(params.dbTableName),
    }),
  getField: (predicate: (field: ReturnType<typeof createField>) => boolean) => {
    const expectedFieldId = mkFieldId(params.lookupFieldId ?? 'lookup');
    const field = createField({
      fieldId: params.lookupFieldId ?? 'lookup',
      type: 'singleLineText',
      dbFieldName: params.lookupDbFieldName,
    });
    if (!predicate({ ...field, id: () => expectedFieldId })) {
      return err(domainError.notFound({ message: 'Lookup field not found' }));
    }
    return ok(field);
  },
});

describe('CellValueMutateVisitor', () => {
  it('returns an error when user identifiers are not pre-resolved', () => {
    const visitor = createVisitor();
    const spec = SetUserValueByIdentifierSpec.create(mkFieldId('userField'), ['alice'], false);
    const result = visitor.visitSetUserValueByIdentifier(spec);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.user_requires_resolution',
    });
  });

  it('skips non-system computed fields when setting scalar values', () => {
    const computedField = createField({
      fieldId: 'formulaField',
      type: 'formula',
      dbFieldName: 'formula_col',
      computed: true,
    });
    const visitor = createVisitor(computedField);

    const result = visitor.visitSetSingleLineTextValue({
      fieldId: computedField.id(),
      value: CellValue.fromValidated('ignored'),
    } as never);

    expect(result.isOk()).toBe(true);
    expect(visitor.getChangedFieldIds()).toEqual([]);
    expect(visitor.getSetClausesRaw().setClauses).not.toHaveProperty('formula_col');
  });

  it('clears non-link fields directly and records changed ids', () => {
    const textField = createField({
      fieldId: 'textField',
      type: 'singleLineText',
      dbFieldName: 'text_col',
    });
    const visitor = createVisitor(textField);

    const result = visitor.visitClearFieldValue({
      field: textField,
    } as never);

    expect(result.isOk()).toBe(true);
    expect(visitor.getSetClausesRaw().setClauses.text_col).toBeNull();
    expect(visitor.getChangedFieldIds().map((id) => id.toString())).toEqual([
      textField.id().toString(),
    ]);
  });

  it('delegates link clearing to junction cleanup for many-many fields', () => {
    const linkField = createLinkField({
      fieldId: 'linkField',
      dbFieldName: 'link_json',
      relationship: 'manyMany',
      hostTableName: 'public.junction_links',
      selfKeyName: '__fk_source',
      foreignKeyName: '__fk_foreign',
      hasOrderColumn: true,
      orderColumnName: '__order_links',
    });
    const visitor = createVisitor(linkField);

    const result = visitor.visitClearFieldValue({
      field: linkField,
    } as never);

    expect(result.isOk()).toBe(true);
    const raw = visitor.getSetClausesRaw();
    expect(raw.setClauses.link_json).toBe(JSON.stringify([]));
    expect(raw.additionalStatements).toHaveLength(1);
    expect(normalizeSql(raw.additionalStatements[0].sql)).toContain(
      'delete from "public"."junction_links" where "__fk_source" = $1'
    );
  });

  it('returns an error when SetLinkValue targets a non-link field', () => {
    const textField = createField({
      fieldId: 'textField',
      type: 'singleLineText',
      dbFieldName: 'text_col',
    });
    const visitor = createVisitor(textField);
    const spec = new SetLinkValueSpec(
      textField.id(),
      CellValue.fromValidated([{ id: mkRecordId('foreign') }])
    );

    const result = visitor.visitSetLinkValue(spec);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      message: 'Field is not a link field',
    });
  });

  it('stores fk values on the main table for many-one links', () => {
    const linkField = createLinkField({
      fieldId: 'manyOneField',
      dbFieldName: 'link_json',
      relationship: 'manyOne',
      isMultipleValue: false,
      foreignKeyName: '__fk_target',
    });
    const visitor = createVisitor(linkField);
    const spec = new SetLinkValueSpec(
      linkField.id(),
      CellValue.fromValidated([{ id: mkRecordId('foreignA') }, { id: mkRecordId('foreignB') }])
    );

    const result = visitor.visitSetLinkValue(spec);

    expect(result.isOk()).toBe(true);
    const raw = visitor.getSetClausesRaw();
    expect(raw.setClauses.link_json).toBe(JSON.stringify({ id: mkRecordId('foreignA') }));
    expect(raw.setClauses.__fk_target).toBe(mkRecordId('foreignA'));
    expect(raw.additionalStatements).toHaveLength(0);
  });

  it('fills missing link titles using the foreign table dbTableName instead of tableId', () => {
    const linkField = createLinkField({
      fieldId: 'manyOneField',
      dbFieldName: 'link_json',
      relationship: 'manyOne',
      isMultipleValue: false,
      foreignTableId: 'legacyForeign',
      lookupFieldId: 'legacyLookup',
      foreignKeyName: '__fk_target',
    });
    const foreignTable = createForeignTable({
      tableId: 'legacyForeign',
      dbTableName: 'bseLegacy.Legacy_Name',
      lookupFieldId: 'legacyLookup',
      lookupDbFieldName: 'Primary_Field',
    });
    const visitor = CellValueMutateVisitor.create(
      createTestDb() as never,
      createTable(linkField) as never,
      'public.records',
      {
        recordId: mkRecordId('source'),
        actorId: 'usrActor000000001',
        now: '2025-01-01T00:00:00.000Z',
        fillLinkTitles: true,
        fillLinkTitleForeignTables: new Map([
          [foreignTable.id().toString(), foreignTable as never],
        ]),
      }
    );
    const spec = new SetLinkValueSpec(
      linkField.id(),
      CellValue.fromValidated([{ id: mkRecordId('foreignA') }]),
      foreignTable.id()
    );

    const result = visitor.visitSetLinkValue(spec);

    expect(result.isOk()).toBe(true);
    const built = visitor.build()._unsafeUnwrap();
    expect(built.additionalStatements).toHaveLength(0);
    expect(normalizeSql(built.mainUpdate.sql)).toContain('LEFT JOIN "bseLegacy"."Legacy_Name" ft');
    expect(normalizeSql(built.mainUpdate.sql)).toContain('"ft"."Primary_Field"');
    expect(normalizeSql(built.mainUpdate.sql)).not.toContain(`"${foreignTable.id().toString()}"`);
  });

  it('rejects oversized multi-link title fill writes before compiling SQL', () => {
    const linkField = createLinkField({
      fieldId: 'manyManyField',
      dbFieldName: 'link_json',
      relationship: 'manyMany',
      isMultipleValue: true,
      foreignTableId: 'legacyForeign',
      lookupFieldId: 'legacyLookup',
    });
    const foreignTable = createForeignTable({
      tableId: 'legacyForeign',
      dbTableName: 'bseLegacy.Legacy_Name',
      lookupFieldId: 'legacyLookup',
      lookupDbFieldName: 'Primary_Field',
    });
    const visitor = CellValueMutateVisitor.create(
      createTestDb() as never,
      createTable(linkField) as never,
      'public.records',
      {
        recordId: mkRecordId('source'),
        actorId: 'usrActor000000001',
        now: '2025-01-01T00:00:00.000Z',
        fillLinkTitles: true,
        fillLinkTitleForeignTables: new Map([
          [foreignTable.id().toString(), foreignTable as never],
        ]),
      }
    );
    const oversizedItems = Array.from({ length: MAX_FILLED_LINK_VALUE_ITEMS + 1 }, (_, index) => ({
      id: mkRecordId(`foreign${index}`),
    }));
    const spec = new SetLinkValueSpec(
      linkField.id(),
      CellValue.fromValidated(oversizedItems),
      foreignTable.id()
    );

    const result = visitor.visitSetLinkValue(spec);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.link_title_fill_limit_exceeded',
    });
  });

  it('builds symmetric clear/update statements when the foreign table owns the fk', () => {
    const linkField = createLinkField({
      fieldId: 'symmetricField',
      dbFieldName: 'link_json',
      relationship: 'oneOne',
      isMultipleValue: false,
      hostTableName: 'public.foreign_table',
      selfKeyName: '__fk_backref',
      foreignKeyName: '__id',
      hasOrderColumn: true,
    });
    const visitor = createVisitor(linkField);
    const spec = new SetLinkValueSpec(
      linkField.id(),
      CellValue.fromValidated([{ id: mkRecordId('foreignA') }, { id: mkRecordId('foreignB') }])
    );

    const result = visitor.visitSetLinkValue(spec);

    expect(result.isOk()).toBe(true);
    const raw = visitor.getSetClausesRaw();
    expect(raw.additionalStatements).toHaveLength(2);
    expect(normalizeSql(raw.additionalStatements[0].sql)).toContain(
      'update "public"."foreign_table" set "__fk_backref" = $1, "__fk_backref_order" = $2 where "__fk_backref" = $3'
    );
    expect(normalizeSql(raw.additionalStatements[1].sql)).toContain(
      'update "public"."foreign_table" as t set "__fk_backref" = "v"."record_id", "__fk_backref_order" = "v"."order_index"::integer'
    );
  });

  it('supports clearing link-by-title specs and errors on unresolved titles', () => {
    const manyOneField = createLinkField({
      fieldId: 'titleField',
      dbFieldName: 'link_json',
      relationship: 'manyOne',
      isMultipleValue: false,
      foreignKeyName: '__fk_target',
    });
    const visitor = createVisitor(manyOneField);

    const clearSpec = SetLinkValueByTitleSpec.create(manyOneField.id(), mkTableId('foreign'), []);
    const clearResult = visitor.visitSetLinkValueByTitle(clearSpec);
    expect(clearResult.isOk()).toBe(true);
    expect(visitor.getSetClausesRaw().setClauses.__fk_target).toBeNull();

    const unresolvedResult = visitor.visitSetLinkValueByTitle(
      SetLinkValueByTitleSpec.create(manyOneField.id(), mkTableId('foreign'), ['Project A'])
    );
    expect(unresolvedResult.isErr()).toBe(true);
    expect(unresolvedResult._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.link.title_resolution_required',
    });
  });

  it('clears junction-backed and foreign-table-backed links when titles are empty', () => {
    const junctionField = createLinkField({
      fieldId: 'titleJunction',
      dbFieldName: 'link_json_junction',
      relationship: 'manyMany',
      hostTableName: 'public.junction_links',
      selfKeyName: '__fk_source',
    });
    const oneManyField = createLinkField({
      fieldId: 'titleOneMany',
      dbFieldName: 'link_json_one_many',
      relationship: 'oneMany',
      isOneWay: false,
      hostTableName: 'public.foreign_table',
      selfKeyName: '__fk_parent',
      hasOrderColumn: true,
      orderColumnName: '__fk_parent_order',
    });

    const junctionVisitor = createVisitor(junctionField);
    const oneManyVisitor = createVisitor(oneManyField);

    expect(
      junctionVisitor
        .visitSetLinkValueByTitle(
          SetLinkValueByTitleSpec.create(junctionField.id(), mkTableId('foreign'), [])
        )
        .isOk()
    ).toBe(true);
    expect(
      oneManyVisitor
        .visitSetLinkValueByTitle(
          SetLinkValueByTitleSpec.create(oneManyField.id(), mkTableId('foreign'), [])
        )
        .isOk()
    ).toBe(true);

    expect(normalizeSql(junctionVisitor.getSetClausesRaw().additionalStatements[0].sql)).toContain(
      'delete from "public"."junction_links" where "__fk_source" = $1'
    );
    expect(normalizeSql(oneManyVisitor.getSetClausesRaw().additionalStatements[0].sql)).toContain(
      'update "public"."foreign_table" set "__fk_parent" = $1, "__fk_parent_order" = $2 where "__fk_parent" = $3'
    );
  });

  it('updates foreign-table fk rows for two-way one-many links', () => {
    const linkField = createLinkField({
      fieldId: 'oneManyField',
      dbFieldName: 'link_json',
      relationship: 'oneMany',
      isOneWay: false,
      hostTableName: 'public.foreign_table',
      selfKeyName: '__fk_parent',
      hasOrderColumn: true,
      orderColumnName: '__fk_parent_order',
    });
    const visitor = createVisitor(linkField);

    const result = visitor.visitSetLinkValue(
      new SetLinkValueSpec(
        linkField.id(),
        CellValue.fromValidated([{ id: mkRecordId('foreignA') }, { id: mkRecordId('foreignB') }])
      )
    );

    expect(result.isOk()).toBe(true);
    const raw = visitor.getSetClausesRaw();
    expect(raw.additionalStatements).toHaveLength(2);
    expect(normalizeSql(raw.additionalStatements[0].sql)).toContain(
      'update "public"."foreign_table" set "__fk_parent" = $1, "__fk_parent_order" = $2 where "__fk_parent" = $3'
    );
    expect(normalizeSql(raw.additionalStatements[1].sql)).toContain(
      'update "public"."foreign_table" as t set "__fk_parent" = "v"."record_id", "__fk_parent_order" = "v"."order_index"::integer'
    );
  });

  it('applies tracked last-modified fields during build', () => {
    const textField = createField({
      fieldId: 'trackedText',
      type: 'singleLineText',
      dbFieldName: 'text_col',
    });
    const lastModifiedTimeField = createTrackedLastModifiedTimeField({
      fieldId: 'trackedTime',
      dbFieldName: 'lmt_col',
      trackedFieldIds: [textField.id()],
    });
    const lastModifiedByField = createTrackedLastModifiedByField({
      fieldId: 'trackedBy',
      dbFieldName: 'lmb_col',
      trackedFieldIds: [textField.id()],
    });
    const visitor = createVisitor(
      textField,
      lastModifiedTimeField as never,
      lastModifiedByField as never
    );

    expect(
      visitor
        .visitSetSingleLineTextValue({
          fieldId: textField.id(),
          value: CellValue.fromValidated('updated'),
        } as never)
        .isOk()
    ).toBe(true);

    const buildResult = visitor.build();
    expect(buildResult.isOk()).toBe(true);
    const built = buildResult._unsafeUnwrap();
    expect(built.changedFieldIds.map((id) => id.toString())).toEqual([
      textField.id().toString(),
      lastModifiedTimeField.id().toString(),
      lastModifiedByField.id().toString(),
    ]);
    expect(normalizeSql(built.mainUpdate.sql)).toContain('"lmt_col" = $');
    expect(normalizeSql(built.mainUpdate.sql)).toContain('jsonb_build_object');
  });

  it('handles row-order updates and unsupported logical combinators', () => {
    const visitor = createVisitor();

    expect(
      visitor.visitSetRowOrderValue({
        viewId: { toRowOrderColumnName: () => '__row_order_viw123' },
        orderValue: 42,
      } as never)
    ).toMatchObject({ isOk: expect.any(Function) });
    expect(visitor.getSetClausesRaw().setClauses.__row_order_viw123).toBe(42);

    expect(visitor.visit({})).toMatchObject({ isOk: expect.any(Function) });
    expect(visitor.and().isOk()).toBe(true);
    expect(visitor.or().isErr()).toBe(true);
    expect(visitor.not().isErr()).toBe(true);
  });
});

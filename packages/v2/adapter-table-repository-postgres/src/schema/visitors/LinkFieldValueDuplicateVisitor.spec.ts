import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createTestDb } from './__tests__/helpers/createTestDb';
import { LinkFieldValueDuplicateVisitor } from './LinkFieldValueDuplicateVisitor';

const createLinkField = (params: {
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  isOneWay?: boolean;
  hostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  hasOrderColumn?: boolean;
  orderColumnName?: string;
}) => ({
  relationship: () => ({
    toString: () => params.relationship,
  }),
  isOneWay: () => params.isOneWay ?? false,
  fkHostTableNameString: () => ok(params.hostTableName),
  selfKeyNameString: () => ok(params.selfKeyName),
  foreignKeyNameString: () => ok(params.foreignKeyName),
  hasOrderColumn: () => params.hasOrderColumn ?? false,
  orderColumnName: () => ok(params.orderColumnName ?? '__order'),
});

describe('LinkFieldValueDuplicateVisitor', () => {
  it('copies junction-table relationships with order columns', () => {
    const db = createTestDb() as never;
    const sourceField = createLinkField({
      relationship: 'manyMany',
      hostTableName: 'public.old_junction',
      selfKeyName: '__fk_old_self',
      foreignKeyName: '__fk_old_foreign',
      hasOrderColumn: true,
      orderColumnName: '__order_old',
    });
    const newField = createLinkField({
      relationship: 'manyMany',
      hostTableName: 'public.new_junction',
      selfKeyName: '__fk_new_self',
      foreignKeyName: '__fk_new_foreign',
      hasOrderColumn: true,
      orderColumnName: '__order_new',
    });

    const result = LinkFieldValueDuplicateVisitor.create(db, {
      sourceField: sourceField as never,
      newField: newField as never,
      schema: 'public',
      tableName: 'tasks',
    }).generateStatements();

    expect(result.isOk()).toBe(true);
    const query = result._unsafeUnwrap()[0];
    expect(query?.sql).toContain('INSERT INTO "public"."new_junction"');
    expect(query?.sql).toContain('"__fk_new_self", "__fk_new_foreign", "__order_new"');
    expect(query?.sql).toContain('SELECT "__fk_old_self", "__fk_old_foreign", "__order_old"');
    expect(query?.sql).toContain('FROM "public"."old_junction"');
  });

  it('uses junction-table copy for one-way one-many links and errors on malformed host table names', () => {
    const db = createTestDb() as never;
    const oneWayField = createLinkField({
      relationship: 'oneMany',
      isOneWay: true,
      hostTableName: 'junction_copy',
      selfKeyName: '__fk_self',
      foreignKeyName: '__fk_foreign',
    });
    const malformedField = createLinkField({
      relationship: 'manyMany',
      hostTableName: 'bad.',
      selfKeyName: '__fk_self',
      foreignKeyName: '__fk_foreign',
    });

    const oneWayResult = LinkFieldValueDuplicateVisitor.create(db, {
      sourceField: oneWayField as never,
      newField: oneWayField as never,
      schema: null,
      tableName: 'tasks',
    }).generateStatements();
    const malformedResult = LinkFieldValueDuplicateVisitor.create(db, {
      sourceField: malformedField as never,
      newField: malformedField as never,
      schema: null,
      tableName: 'tasks',
    }).generateStatements();

    expect(oneWayResult._unsafeUnwrap()[0]?.sql).toContain('FROM "junction_copy"');
    expect(malformedResult.isErr()).toBe(true);
    expect(malformedResult._unsafeUnwrapErr()).toMatchObject({
      message: 'Invalid junction table name',
    });
  });
});

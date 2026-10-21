import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../../visitors/__tests__/helpers/createTestDb';
import {
  createForeignKeyConstraintStatement,
  dropColumnStatement,
  dropConstraintStatement,
  dropTableStatement,
} from '../StatementBuilders';

const target = { schema: 'bseExampleSchema', tableName: 'tblExampleTable' };

describe('StatementBuilders', () => {
  // T6538/T6539: orphan link cleanup must tolerate a foreign table whose data
  // relation is already gone, so destructive statements stay idempotent.
  it('builds drop column statements that tolerate missing tables and columns', () => {
    const db = createTestDb();
    const builder = dropColumnStatement(target, '__fk_fldExample');

    expect(builder.scope).toBe('data');
    const compiled = builder.compile(db);
    expect(compiled.sql).toBe(
      'alter table if exists "bseExampleSchema"."tblExampleTable" drop column if exists "__fk_fldExample" cascade'
    );
    expect(compiled.parameters).toEqual([]);
  });

  // T6809: a rule mistakenly built with a system column name must fail loudly at
  // construction time instead of silently destroying record data on down() (T6807).
  it('refuses to build drop column statements for system record columns', () => {
    for (const columnName of ['__id', '__version', '__auto_number']) {
      expect(() => dropColumnStatement(target, columnName)).toThrow(
        `Refusing to build DROP COLUMN for system column "${columnName}"`
      );
    }
  });

  it('allows dropping system columns only with an explicit opt-in', () => {
    const db = createTestDb();
    const builder = dropColumnStatement(target, '__id', { allowSystemColumn: true });

    expect(builder.scope).toBe('data');
    const compiled = builder.compile(db);
    expect(compiled.sql).toBe(
      'alter table if exists "bseExampleSchema"."tblExampleTable" drop column if exists "__id" cascade'
    );
  });

  it('builds drop constraint statements that tolerate missing tables and constraints', () => {
    const db = createTestDb();
    const builder = dropConstraintStatement(target, 'fk_example');

    expect(builder.scope).toBe('data');
    const compiled = builder.compile(db);
    expect(compiled.sql).toBe(
      'alter table if exists "bseExampleSchema"."tblExampleTable" drop constraint if exists "fk_example"'
    );
    expect(compiled.parameters).toEqual([]);
  });

  it('builds drop table statements that tolerate missing tables', () => {
    const db = createTestDb();
    const builder = dropTableStatement(target);

    expect(builder.scope).toBe('data');
    const compiled = builder.compile(db);
    expect(compiled.sql).toBe('drop table if exists "bseExampleSchema"."tblExampleTable" cascade');
    expect(compiled.parameters).toEqual([]);
  });

  it('keeps meta-resolved FK compile SQL off the data plane', () => {
    const db = createTestDb();
    const builder = createForeignKeyConstraintStatement(
      target,
      'fk_example',
      '__fk_fldExample',
      { schema: 'bseForeignSchema', tableName: 'tblLogicalTarget' },
      '__id',
      'CASCADE',
      'tblLogicalTarget'
    );

    expect(builder.scope).toBe('data');
    expect(builder.execute).toBeTypeOf('function');
    const compiled = builder.compile(db);
    expect(compiled.sql).not.toMatch(/\btable_meta\b/i);
    expect(compiled.sql).toContain('ALTER TABLE');
    expect(compiled.sql).toContain('FOREIGN KEY');
  });
});

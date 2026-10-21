import Knex from 'knex';
import { describe, expect, it } from 'vitest';
import {
  postgresAddForeignKeyNotValidSql,
  toPostgresFkDeleteAction,
} from './postgres-fk-delete-action';

describe('toPostgresFkDeleteAction', () => {
  it('keeps known PostgreSQL referential actions', () => {
    expect(toPostgresFkDeleteAction('SET NULL')).toBe('SET NULL');
    expect(toPostgresFkDeleteAction('CASCADE')).toBe('CASCADE');
    expect(toPostgresFkDeleteAction('RESTRICT')).toBe('RESTRICT');
    expect(toPostgresFkDeleteAction('NO ACTION')).toBe('NO ACTION');
    expect(toPostgresFkDeleteAction('SET DEFAULT')).toBe('SET DEFAULT');
  });

  it('normalizes underscored and mixed-case values', () => {
    expect(toPostgresFkDeleteAction('set_null')).toBe('SET NULL');
    expect(toPostgresFkDeleteAction('cascade')).toBe('CASCADE');
  });

  it('falls back to NO ACTION for unknown values', () => {
    expect(toPostgresFkDeleteAction(undefined)).toBe('NO ACTION');
    expect(toPostgresFkDeleteAction('DROP')).toBe('NO ACTION');
  });
});

describe('postgresAddForeignKeyNotValidSql', () => {
  it('emits ON DELETE from the captured referential action', () => {
    const knex = Knex({ client: 'pg' });
    const sql = postgresAddForeignKeyNotValidSql(knex, {
      schema: 'bseCopy',
      tableName: 'tblHost',
      constraintName: 'fk___fk_fldLink',
      columnName: '__fk_fldLink',
      referencedTableSchema: 'bsePeople',
      referencedTableName: 'tblPeople',
      referencedColumnName: '__id',
      deleteRule: 'SET NULL',
    });
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('NOT VALID');
  });
});

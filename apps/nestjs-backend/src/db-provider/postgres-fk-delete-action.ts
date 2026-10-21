import type { Knex } from 'knex';

export const POSTGRES_FK_DELETE_ACTIONS = [
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
  'RESTRICT',
  'NO ACTION',
] as const;

export type PostgresFkDeleteAction = (typeof POSTGRES_FK_DELETE_ACTIONS)[number];

const POSTGRES_FK_DELETE_ACTION_SET = new Set<string>(POSTGRES_FK_DELETE_ACTIONS);

export const toPostgresFkDeleteAction = (value: unknown): PostgresFkDeleteAction => {
  if (typeof value !== 'string') {
    return 'NO ACTION';
  }
  const normalized = value.trim().toUpperCase().replaceAll('_', ' ');
  if (POSTGRES_FK_DELETE_ACTION_SET.has(normalized)) {
    return normalized as PostgresFkDeleteAction;
  }
  return 'NO ACTION';
};

export const postgresAddForeignKeyNotValidSql = (
  knex: Knex,
  params: {
    schema: string;
    tableName: string;
    constraintName: string;
    columnName: string;
    referencedTableSchema: string;
    referencedTableName: string;
    referencedColumnName: string;
    deleteRule: unknown;
  }
): string => {
  const onDelete = toPostgresFkDeleteAction(params.deleteRule);
  return knex
    .raw(
      `ALTER TABLE ??.?? ADD CONSTRAINT ?? FOREIGN KEY (??) REFERENCES ??.??(??) ON DELETE ${onDelete} NOT VALID`,
      [
        params.schema,
        params.tableName,
        params.constraintName,
        params.columnName,
        params.referencedTableSchema,
        params.referencedTableName,
        params.referencedColumnName,
      ]
    )
    .toQuery();
};

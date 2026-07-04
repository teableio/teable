import type { CompiledQuery } from 'kysely';

import type { TableSchemaStatementBuilder } from './ISchemaRule';

export type SchemaStatementRelationAccess = {
  readonly relation: string;
  readonly plane: 'meta' | 'data';
};

const metaRelations = [
  'space',
  'base',
  'table_meta',
  'field',
  'view',
  'reference',
  'schema_operation',
  'data_db_connection',
  'space_data_db_binding',
  'users',
  'collaborator',
] as const;

const dataRelations = [
  'record_history',
  'record_trash',
  'table_trash',
  '__undo_log',
  'computed_update_outbox',
  'computed_update_outbox_seed',
  'computed_update_dead_letter',
  'computed_update_pause_scope',
] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const relationAccessPattern = (relation: string): RegExp => {
  const escaped = escapeRegExp(relation);
  return new RegExp(
    [
      `\\b(?:from|join|update|into|table)\\s+(?:only\\s+)?(?:(?:"public"|public)\\s*\\.\\s*)?(?:"${escaped}"|${escaped})\\b`,
      `\\bto_regclass\\(\\s*'(?:(?:"public"|public)\\.)?(?:"${escaped}"|${escaped})'\\s*\\)`,
    ].join('|'),
    'i'
  );
};

const findAccesses = (
  sql: string,
  relations: ReadonlyArray<string>,
  plane: SchemaStatementRelationAccess['plane']
): ReadonlyArray<SchemaStatementRelationAccess> =>
  relations
    .filter((relation) => relationAccessPattern(relation).test(sql))
    .map((relation) => ({ relation, plane }));

export const findSchemaStatementRelationAccessViolations = (
  statement: TableSchemaStatementBuilder,
  compiled: CompiledQuery
): ReadonlyArray<SchemaStatementRelationAccess> => {
  if (statement.scope === 'data') {
    return findAccesses(compiled.sql, metaRelations, 'meta');
  }

  return findAccesses(compiled.sql, dataRelations, 'data');
};

export const assertSchemaStatementRelationAccess = (
  statement: TableSchemaStatementBuilder,
  compiled: CompiledQuery
): void => {
  const violations = findSchemaStatementRelationAccessViolations(statement, compiled);
  if (violations.length === 0) {
    return;
  }

  const relationList = violations
    .map((violation) => `${violation.plane}:${violation.relation}`)
    .join(', ');
  throw new Error(
    `Schema statement scope "${statement.scope}" cannot access relations owned by another storage plane: ${relationList}`
  );
};

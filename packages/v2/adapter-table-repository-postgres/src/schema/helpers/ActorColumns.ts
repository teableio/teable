import { sql, type CreateTableBuilder, type Kysely, type Transaction } from 'kysely';

import { toQualifiedIdentifierLiteral } from '../../shared/sqlIdentifiers';

export class ActorColumnsIncompatibleSchemaError extends Error {}

const actorPairs = [
  {
    typeColumn: '__created_by_actor_type',
    idColumn: '__created_by_actor_id',
    constraintName: '__created_by_actor_pair_check',
  },
  {
    typeColumn: '__last_modified_by_actor_type',
    idColumn: '__last_modified_by_actor_id',
    constraintName: '__last_modified_by_actor_pair_check',
  },
] as const;

const actorPairCheck = (pair: (typeof actorPairs)[number]) => {
  const type = sql.ref(pair.typeColumn);
  const id = sql.ref(pair.idColumn);
  return sql<boolean>`((${type} IS NULL AND ${id} IS NULL) OR
    (${type} IS NOT NULL AND ${id} IS NOT NULL
      AND length(${type}) > 0 AND length(${id}) > 0))`;
};

/** Only new physical CREATEs and the explicit enable operation own actor storage. */
export const addActorColumnsToCreateTable = <TB extends string, C extends string>(
  builder: CreateTableBuilder<TB, C>
) => {
  const withColumns = builder
    .addColumn('__created_by_actor_type', 'text')
    .addColumn('__created_by_actor_id', 'text')
    .addColumn('__last_modified_by_actor_type', 'text')
    .addColumn('__last_modified_by_actor_id', 'text');
  return actorPairs.reduce(
    (current, pair) => current.addCheckConstraint(pair.constraintName, actorPairCheck(pair)),
    withColumns
  );
};

/** The caller owns the exclusive schema lease, data transaction, and later capability publication. */
export const ensureActorColumnsInTransaction = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  schema: string | null,
  tableName: string
): Promise<void> => {
  const identifier = toQualifiedIdentifierLiteral(schema, tableName);
  const target = sql.raw(identifier);

  // Enable may wait for live writers or scan a populated table. Both waits are
  // bounded; an error aborts the caller's transaction without publishing capability.
  await sql`SET LOCAL lock_timeout = '3s'`.execute(db);
  await sql`SET LOCAL statement_timeout = '30s'`.execute(db);

  // Serialize catalog inspection and DDL even when an enable operation is retried.
  await sql`LOCK TABLE ${target} IN ACCESS EXCLUSIVE MODE`.execute(db);
  const columns = await sql<{
    name: string;
    type: string;
    nullable: boolean;
    plain_text: boolean;
    default_expression: string | null;
    identity_kind: string;
    generated_kind: string;
  }>`
    SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
      NOT a.attnotnull AS nullable,
      (a.atttypid = 'pg_catalog.text'::regtype AND a.atttypmod = -1) AS plain_text,
      pg_get_expr(d.adbin, d.adrelid) AS default_expression,
      a.attidentity AS identity_kind, a.attgenerated AS generated_kind
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ${identifier}::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname IN (${sql.join(actorPairs.flatMap((pair) => [pair.typeColumn, pair.idColumn]))})
  `.execute(db);
  const existing = new Map(columns.rows.map((column) => [column.name, column]));
  for (const pair of actorPairs) {
    for (const name of [pair.typeColumn, pair.idColumn]) {
      const column = existing.get(name);
      if (
        column &&
        (!column.plain_text ||
          !column.nullable ||
          column.identity_kind !== '' ||
          column.generated_kind !== '' ||
          (column.default_expression !== null && column.default_expression !== 'NULL::text'))
      ) {
        throw new ActorColumnsIncompatibleSchemaError(
          'Actor columns must be nullable text without a non-null default or generation'
        );
      }
    }
  }

  const constraints = await sql<{ name: string; kind: string }>`
    SELECT conname AS name, contype AS kind FROM pg_constraint
    WHERE conrelid = ${identifier}::regclass
      AND conname IN (${sql.join(actorPairs.map((pair) => pair.constraintName))})
  `.execute(db);
  for (const constraint of constraints.rows) {
    if (constraint.kind !== 'c') {
      throw new ActorColumnsIncompatibleSchemaError(
        'Actor pair constraints must be CHECK constraints'
      );
    }
  }

  for (const pair of actorPairs) {
    for (const name of [pair.typeColumn, pair.idColumn]) {
      if (!existing.has(name)) {
        await sql`ALTER TABLE ${target} ADD COLUMN ${sql.id(name)} text`.execute(db);
      }
    }
    // Reinstall the owned check rather than trusting a same-name, weaker expression.
    // NOT VALID permits installation before validating existing rows (legacy nulls are valid).
    await sql`ALTER TABLE ${target}
      DROP CONSTRAINT IF EXISTS ${sql.id(pair.constraintName)},
      ADD CONSTRAINT ${sql.id(pair.constraintName)} CHECK ${actorPairCheck(pair)} NOT VALID`.execute(
      db
    );
  }
  // Validate both checks in one ALTER so PostgreSQL can share the existing-row scan.
  await sql`ALTER TABLE ${target} ${sql.join(
    actorPairs.map((pair) => sql`VALIDATE CONSTRAINT ${sql.id(pair.constraintName)}`)
  )}`.execute(db);
};

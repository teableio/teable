export const v2PostgresDbTokens = {
  db: Symbol('v2.db.postgres.db'),
  config: Symbol('v2.db.postgres.config'),
} as const;

export const v2MetaDbTokens = {
  db: Symbol('v2.db.postgres.meta.db'),
  config: Symbol('v2.db.postgres.meta.config'),
} as const;

export const v2DataDbTokens = {
  db: Symbol('v2.db.postgres.data.db'),
  config: Symbol('v2.db.postgres.data.config'),
} as const;

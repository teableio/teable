export const v2PostgresStateTokens = {
  db: Symbol('v2.adapter.postgresState.db'),
  config: Symbol('v2.adapter.postgresState.config'),
  tableMapper: Symbol('v2.adapter.postgresState.tableMapper'),
} as const;

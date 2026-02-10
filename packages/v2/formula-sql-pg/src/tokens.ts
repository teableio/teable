/**
 * DI tokens for formula-sql-pg package.
 *
 * Only exports Symbols to avoid introducing tsyringe dependency into this package.
 * The actual DI registration happens in the adapter layer.
 */
export const formulaSqlPgTokens = {
  /** Type validation strategy - injected by adapter layer */
  typeValidationStrategy: Symbol.for('formula-sql-pg.typeValidationStrategy'),
} as const;

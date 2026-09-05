import type { Knex } from 'knex';

export abstract class IntegrityQueryAbstract {
  constructor(protected readonly knex: Knex) {}

  abstract checkLinks(params: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string;

  abstract fixLinks(params: {
    dbTableName: string;
    fkHostTableName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string;

  /**
   * Atomically detect and fix InvalidLinkReference issues in a single SQL
   * statement, eliminating the window between detection and fix where
   * concurrent writes can re-introduce or worsen desyncs.
   *
   * Returns null if the database engine does not support atomic detect+fix
   * (e.g., SQLite), in which case the caller should fall back to the
   * two-step checkLinks() + fixLinks() approach.
   *
   * Currently implemented for PostgreSQL only.
   */
  atomicFixLinks(_params: {
    dbTableName: string;
    foreignDbTableName: string;
    fkHostTableName: string;
    lookupDbFieldName: string;
    selfKeyName: string;
    foreignKeyName: string;
    linkDbFieldName: string;
    isMultiValue: boolean;
  }): string | null {
    // Default: not supported. Subclasses override for specific databases.
    return null;
  }

  /**
   * Deprecated: Do NOT use in new code.
   * Link fields do not persist a display JSON column; their values are derived
   * from junction tables or foreign key columns. This helper was only used by
   * legacy tests to mutate a hypothetical JSON display column to simulate
   * inconsistencies. Prefer modifying the junction/fk data directly.
   *
   * @deprecated Use junction table / foreign key mutations instead.
   */
  abstract updateJsonField(params: {
    recordIds: string[];
    dbTableName: string;
    field: string;
    value: string | number | boolean | null;
    arrayIndex?: number;
  }): Knex.QueryBuilder;
}

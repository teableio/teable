import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { toQualifiedIdentifierLiteral } from './sqlIdentifiers';
import { ensureUndoCaptureInfrastructure } from './undoCapture';

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly rowProvider: RowProvider
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    return { rows: this.rowProvider(compiledQuery) as R[] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  constructor(private readonly rowProvider: RowProvider) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries, this.rowProvider);
  }

  async beginTransaction(): Promise<void> {
    return undefined;
  }

  async commitTransaction(): Promise<void> {
    return undefined;
  }

  async rollbackTransaction(): Promise<void> {
    return undefined;
  }

  async releaseConnection(): Promise<void> {
    return undefined;
  }

  async destroy(): Promise<void> {
    return undefined;
  }
}

const defaultRowsForUndoProbe: RowProvider = (compiledQuery) => {
  const text = compiledQuery.sql;
  if (text.includes('FROM information_schema.tables')) {
    return [{ exists: true }];
  }
  if (text.includes('FROM information_schema.columns')) {
    return [{ exists: true }];
  }
  if (text.includes('FROM pg_proc')) {
    return [{ exists: true }];
  }
  if (text.includes('FROM pg_trigger AS t')) {
    return [{ exists: true }];
  }
  return [];
};

const createRecordingDb = (rowProvider?: RowProvider) => {
  const driver = new RecordingDriver((compiledQuery) => {
    const providedRows = rowProvider?.(compiledQuery) ?? [];
    return providedRows.length > 0 ? providedRows : defaultRowsForUndoProbe(compiledQuery);
  });
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
};

describe('ensureUndoCaptureInfrastructure', () => {
  it('accepts an existing undo trigger only when it targets the current schema function', async () => {
    const { db, driver } = createRecordingDb();
    try {
      const result = await ensureUndoCaptureInfrastructure(
        db,
        db,
        toQualifiedIdentifierLiteral('bseMigrated', 'tblRecords'),
        'bseMigrated.tblRecords'
      );

      expect(result).toBe('ready');
      const triggerProbe = driver.queries.find((query) =>
        query.sql.includes('FROM pg_trigger AS t')
      );
      expect(triggerProbe?.sql).toContain('JOIN pg_proc AS p ON p.oid = t.tgfoid');
      expect(triggerProbe?.sql).toContain('p.pronamespace = current_schema()::regnamespace');
      expect(
        driver.queries.some((query) =>
          query.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
        )
      ).toBe(false);
    } finally {
      await db.destroy();
    }
  });

  it('reinstalls stale restored triggers that point outside the current schema', async () => {
    const { db, driver } = createRecordingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
        return [{ exists: false }];
      }
      return [];
    });
    try {
      const result = await ensureUndoCaptureInfrastructure(
        db,
        db,
        toQualifiedIdentifierLiteral('bseMigrated', 'tblRecords'),
        'bseMigrated.tblRecords'
      );

      expect(result).toBe('ready');
      expect(
        driver.queries.some((query) =>
          query.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
        )
      ).toBe(true);
    } finally {
      await db.destroy();
    }
  });
});

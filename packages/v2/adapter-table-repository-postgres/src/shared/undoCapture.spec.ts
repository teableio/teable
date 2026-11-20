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
import {
  clearUndoLogRows,
  ensureUndoCaptureInfrastructure,
  loadAndClearUndoLogRows,
  matchesUndoCaptureTableName,
  runWithoutUndoCapture,
} from './undoCapture';

type RowProvider = (compiledQuery: CompiledQuery) => unknown[];

type RecordingDriverState = {
  inTransaction: boolean;
  sessionBatchId?: string;
  txBatchId?: string;
};

class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly queries: CompiledQuery[],
    private readonly rowProvider: RowProvider,
    private readonly state: RecordingDriverState
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    if (compiledQuery.sql.includes("set_config('teable.undo_batch_id'")) {
      const val = compiledQuery.parameters[0];
      const isLocal = Boolean(compiledQuery.parameters[1]);
      const normalized = typeof val === 'string' && val.length > 0 ? val : undefined;
      if (this.state.inTransaction) {
        this.state.txBatchId = normalized;
      } else if (!isLocal) {
        this.state.sessionBatchId = normalized;
      }
      return { rows: [{ set_config: normalized ?? '' }] as R[] };
    }
    if (compiledQuery.sql.includes("current_setting('teable.undo_batch_id', true)")) {
      const active = this.state.inTransaction ? this.state.txBatchId : this.state.sessionBatchId;
      return { rows: [{ batch_id: active ?? null }] as R[] };
    }
    return { rows: this.rowProvider(compiledQuery) as R[] };
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];
  readonly state: RecordingDriverState = { inTransaction: false };

  constructor(private readonly rowProvider: RowProvider) {}

  async init(): Promise<void> {
    return undefined;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries, this.rowProvider, this.state);
  }

  async beginTransaction(): Promise<void> {
    this.state.inTransaction = true;
    this.state.txBatchId = this.state.sessionBatchId;
  }

  async commitTransaction(): Promise<void> {
    this.state.inTransaction = false;
    this.state.txBatchId = undefined;
  }

  async rollbackTransaction(): Promise<void> {
    this.state.inTransaction = false;
    this.state.txBatchId = undefined;
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
      expect(triggerProbe?.sql).toContain("t.tgenabled = 'O'");
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

  it('checks restored triggers through the scoped transaction connection', async () => {
    const root = createRecordingDb();
    const scoped = createRecordingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
        return [{ exists: false }];
      }
      return [];
    });

    try {
      const result = await ensureUndoCaptureInfrastructure(
        root.db,
        scoped.db,
        toQualifiedIdentifierLiteral('bseMigrated', 'tblRecords'),
        'bseMigrated.tblRecords'
      );

      expect(result).toBe('ready');
      expect(
        scoped.driver.queries.some((query) => query.sql.includes('FROM pg_trigger AS t'))
      ).toBe(true);
      expect(
        scoped.driver.queries.some((query) =>
          query.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
        )
      ).toBe(true);
      expect(root.driver.queries.some((query) => query.sql.includes('FROM pg_trigger AS t'))).toBe(
        false
      );
    } finally {
      await Promise.all([root.db.destroy(), scoped.db.destroy()]);
    }
  });

  it('does not poison the durable trigger cache when a transaction installs a trigger and then rolls back', async () => {
    const root = createRecordingDb();
    let tx1Installed = false;
    const tx1 = createRecordingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')) {
        tx1Installed = true;
        return [];
      }
      if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
        return [{ exists: tx1Installed }];
      }
      return [];
    });
    Object.defineProperty(tx1.db, 'isTransaction', { get: () => true, configurable: true });

    const tx2 = createRecordingDb((compiledQuery) => {
      if (compiledQuery.sql.includes('FROM pg_trigger AS t')) {
        return [{ exists: false }];
      }
      return [];
    });
    Object.defineProperty(tx2.db, 'isTransaction', { get: () => true, configurable: true });

    try {
      const tableRef = toQualifiedIdentifierLiteral('bseRetry', 'tblRetry');
      const tableKey = 'bseRetry.tblRetry';

      // Step 1 inside tx1 (e.g., CreateTableCommand): installs trigger in uncommitted tx1
      expect(await ensureUndoCaptureInfrastructure(root.db, tx1.db, tableRef, tableKey)).toBe(
        'ready'
      );
      expect(
        tx1.driver.queries.filter((q) =>
          q.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
        )
      ).toHaveLength(1);

      // Step 2 inside the same tx1 (e.g., CreateRecordsCommand): must not promote uncommitted trigger to rootDb cache
      expect(await ensureUndoCaptureInfrastructure(root.db, tx1.db, tableRef, tableKey)).toBe(
        'ready'
      );

      // Suppose tx1 rolls back (e.g., 40P01 deadlock) and a fresh retry tx2 runs against clean DB:
      expect(await ensureUndoCaptureInfrastructure(root.db, tx2.db, tableRef, tableKey)).toBe(
        'ready'
      );
      expect(
        tx2.driver.queries.some((q) =>
          q.sql.includes('CREATE OR REPLACE TRIGGER "__teable_undo_capture"')
        )
      ).toBe(true);
    } finally {
      await Promise.all([root.db.destroy(), tx1.db.destroy(), tx2.db.destroy()]);
    }
  });
});

describe('matchesUndoCaptureTableName', () => {
  it('accepts schema-qualified and unqualified names for the same table', () => {
    expect(matchesUndoCaptureTableName('ledger_rows', 'bseTestBase.ledger_rows')).toBe(true);
    expect(matchesUndoCaptureTableName('bseTestBase.ledger_rows', 'ledger_rows')).toBe(true);
    expect(matchesUndoCaptureTableName('bseTestBase.ledger_rows', 'bseTestBase.ledger_rows')).toBe(
      true
    );
    expect(matchesUndoCaptureTableName('other_table', 'bseTestBase.ledger_rows')).toBe(false);
  });
});

describe('runWithoutUndoCapture', () => {
  it('runs work directly without set_config when no batch id is active', async () => {
    const { db, driver } = createRecordingDb((q) => {
      if (q.sql.includes("current_setting('teable.undo_batch_id', true)")) {
        return [{ batch_id: null }];
      }
      return [];
    });

    try {
      const result = await runWithoutUndoCapture(db, async () => 'ok');
      expect(result).toBe('ok');
      expect(driver.queries.some((q) => q.sql.includes('set_config'))).toBe(false);
    } finally {
      await db.destroy();
    }
  });

  it('temporarily clears an active batch id and restores it in finally using tx-aware is_local', async () => {
    const seenInside: Array<string | undefined> = [];
    const { db, driver } = createRecordingDb(() => []);
    driver.state.sessionBatchId = 'batch_session';

    try {
      // Session-level GUC outside tx -> clears & restores with is_local = false
      await runWithoutUndoCapture(db, async () => {
        seenInside.push(driver.state.sessionBatchId);
      });
      expect(seenInside).toEqual([undefined]);
      expect(driver.state.sessionBatchId).toBe('batch_session');
      expect(
        driver.queries
          .filter((q) => q.sql.includes("set_config('teable.undo_batch_id'"))
          .map((q) => q.parameters)
      ).toEqual([
        ['', false],
        ['batch_session', false],
      ]);

      // Transaction-local GUC inside db.transaction() -> clears & restores with is_local = true
      await db.transaction().execute(async (trx) => {
        await runWithoutUndoCapture(trx, async () => {
          seenInside.push(driver.state.txBatchId);
        });
      });
      expect(seenInside).toEqual([undefined, undefined]);
      expect(
        driver.queries
          .filter((q) => q.sql.includes("set_config('teable.undo_batch_id'"))
          .slice(-2)
          .map((q) => q.parameters)
      ).toEqual([
        ['', true],
        ['batch_session', true],
      ]);

      await expect(
        runWithoutUndoCapture(db, async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(driver.state.sessionBatchId).toBe('batch_session');
    } finally {
      await db.destroy();
    }
  });
});

describe('loadAndClearUndoLogRows & clearUndoLogRows', () => {
  it('selects old_tuple directly without to_jsonb("__undo_log") when the column exists', async () => {
    const { db, driver } = createRecordingDb((q) => {
      if (q.sql.includes('information_schema.columns')) {
        return [{ exists: true }];
      }
      if (q.sql.includes('DELETE FROM "__undo_log"')) {
        return [
          { id: '1', operation: 'UPDATE', table_name: 't', record_id: 'r1', old_tuple: null },
        ];
      }
      return [];
    });

    try {
      const rows = await loadAndClearUndoLogRows(db, 'b1', { rootDb: db });
      expect(rows).toHaveLength(1);
      const deleteQuery = driver.queries.find((q) => q.sql.includes('DELETE FROM "__undo_log"'));
      expect(deleteQuery?.sql).toContain('"old_tuple"');
      expect(deleteQuery?.sql).not.toContain('to_jsonb("__undo_log")');
    } finally {
      await db.destroy();
    }
  });

  it('deletes undo log rows without returning payloads in clearUndoLogRows', async () => {
    const { db, driver } = createRecordingDb(() => []);
    try {
      await clearUndoLogRows(db, 'b1');
      const deleteQuery = driver.queries.find((q) => q.sql.includes('DELETE FROM "__undo_log"'));
      expect(deleteQuery?.sql).not.toContain('RETURNING');
    } finally {
      await db.destroy();
    }
  });
});

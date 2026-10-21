import type { ClsService } from 'nestjs-cls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { classifyDatabaseError } from './database-error-classification';
import {
  DATABASE_HEALTH_DB_ERROR_EVENT,
  DATABASE_HEALTH_MAX_PER_HOUR,
  DATABASE_HEALTH_MAX_PER_WINDOW,
  DATABASE_HEALTH_WINDOW_MS,
  DatabaseHealthDiagnostics,
  fingerprintDatabaseError,
  normalizeDatabaseErrorSummary,
  type IDatabaseHealthErrorInput,
} from './database-health.diagnostics';

const errorInput = (
  overrides: Partial<IDatabaseHealthErrorInput> = {}
): IDatabaseHealthErrorInput => ({
  instanceId: 'dbh_a',
  role: 'data',
  operation: 'SELECT',
  durationMs: 12,
  classification: classifyDatabaseError({ code: '23505' }),
  message: 'duplicate key value violates unique constraint "users_email_key"',
  traceId: 'trace-1',
  spanId: 'span-1',
  spanName: 'pg.query:SELECT app',
  ...overrides,
});

const createHarness = (options: { now?: () => number; maxWindowKeys?: number } = {}) => {
  let clock = 1_700_000_000_000;
  const logged: Array<{ event: string; payload: unknown }> = [];
  const diagnostics = new DatabaseHealthDiagnostics({
    now: options.now ?? (() => clock),
    ...(options.maxWindowKeys === undefined ? {} : { maxWindowKeys: options.maxWindowKeys }),
    logSink: {
      log: (event, payload) => {
        logged.push({ event, payload });
      },
    },
  });
  return {
    diagnostics,
    logged,
    advance: (ms: number) => {
      clock += ms;
    },
  };
};

const fakeCls = (store: Record<string, unknown>): ClsService<IClsStore> =>
  ({
    get: (key?: string) => (key === undefined ? store : store[key]),
  }) as unknown as ClsService<IClsStore>;

/**
 * Golden vectors from docs/operations/database-instance-evidence-contract.md §5. The collector
 * normalizes `status_message` with the same rules, so these pairs are the byte-compatibility
 * contract between the two layers: any drift here breaks fingerprint joins.
 */
const GOLDEN_VECTORS: ReadonlyArray<readonly [string, string]> = [
  [
    'column "__fk_fldgzhmllvca8c23mz2" does not exist',
    'column "__fk_fldgzhmllvca8c23mz2" does not exist',
  ],
  [
    'current transaction is aborted, commands ignored until end of transaction block',
    'current transaction is aborted, commands ignored until end of transaction block',
  ],
  [
    'duplicate key value violates unique constraint "tblHoY7qebeIfQdpME1_MessageId_unique"',
    'duplicate key value violates unique constraint "tblHoY7qebeIfQdpME1_MessageId_unique"',
  ],
  ['invalid input syntax for type integer: "abc"', 'invalid input syntax for type integer: ?'],
  [
    'password authentication failed for user "app"',
    'password authentication failed for user "app"',
  ],
  ['cancel statement due to statement timeout', 'cancel statement due to statement timeout'],
  [
    '(ENOTFOUND) tenant/user postgres.wqqgmqigruyghkeedobx not found',
    '(ENOTFOUND) tenant/user postgres.wqqgmqigruyghkeedobx not found',
  ],
];

describe('database health diagnostics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('emits one structured record per accounted failure', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', 'staging');
    const { diagnostics, logged } = createHarness();

    const event = diagnostics.emitDatabaseError(
      errorInput({
        classification: classifyDatabaseError(
          { message: 'x' },
          {
            dataDbClassification: {
              code: 'data_db.tenant_missing',
              message: 'gone',
              retryable: false,
              userActionable: true,
              driverCode: 'ENOTFOUND',
            },
          }
        ),
      })
    );

    expect(logged).toHaveLength(1);
    expect(logged[0].event).toBe(DATABASE_HEALTH_DB_ERROR_EVENT);
    expect(logged[0].payload).toBe(event);
    expect(event).toEqual({
      event: DATABASE_HEALTH_DB_ERROR_EVENT,
      occurredAt: new Date(1_700_000_000_000).toISOString(),
      environment: 'staging',
      instanceId: 'dbh_a',
      role: 'data',
      operation: 'SELECT',
      durationMs: 12,
      errorClass: 'database_missing',
      retryable: false,
      redactedSummary: 'duplicate key value violates unique constraint "users_email_key"',
      fingerprint: fingerprintDatabaseError(
        'dbh_a',
        'database_missing',
        'duplicate key value violates unique constraint "users_email_key"'
      ),
      traceId: 'trace-1',
      spanId: 'span-1',
      spanName: 'pg.query:SELECT app',
      sampling: { suppressedSinceLastEmit: 0, emittedInWindow: 1 },
      dataDbCode: 'data_db.tenant_missing',
      driverCode: 'ENOTFOUND',
    });
  });

  it('allows the first occurrences of a window, then suppresses and reports the count', () => {
    const { diagnostics, logged } = createHarness();

    for (let attempt = 0; attempt < DATABASE_HEALTH_MAX_PER_WINDOW; attempt += 1) {
      expect(diagnostics.emitDatabaseError(errorInput())).toBeDefined();
    }
    expect(logged).toHaveLength(DATABASE_HEALTH_MAX_PER_WINDOW);

    expect(diagnostics.emitDatabaseError(errorInput())).toBeUndefined();
    expect(diagnostics.emitDatabaseError(errorInput())).toBeUndefined();
    expect(logged).toHaveLength(DATABASE_HEALTH_MAX_PER_WINDOW);

    // A different error class and a different instance keep their own windows.
    const otherClass = diagnostics.emitDatabaseError(
      errorInput({ classification: classifyDatabaseError({ code: '57014' }) })
    );
    const otherInstance = diagnostics.emitDatabaseError(errorInput({ instanceId: 'dbh_b' }));
    expect(otherClass).toBeDefined();
    expect(otherInstance).toBeDefined();
  });

  it('reports the suppressed count on the next emitted record of the same window', () => {
    const { diagnostics, advance } = createHarness();

    for (let attempt = 0; attempt < DATABASE_HEALTH_MAX_PER_WINDOW + 3; attempt += 1) {
      diagnostics.emitDatabaseError(errorInput());
    }
    advance(DATABASE_HEALTH_WINDOW_MS);

    const event = diagnostics.emitDatabaseError(errorInput());

    expect(event?.sampling).toEqual({ suppressedSinceLastEmit: 3, emittedInWindow: 1 });
  });

  it('caps emissions per hour even when every minute window has room', () => {
    const { diagnostics, advance } = createHarness();
    let emitted = 0;

    for (let window = 0; window < 12; window += 1) {
      for (let attempt = 0; attempt < DATABASE_HEALTH_MAX_PER_WINDOW; attempt += 1) {
        if (diagnostics.emitDatabaseError(errorInput())) {
          emitted += 1;
        }
      }
      advance(DATABASE_HEALTH_WINDOW_MS);
    }

    expect(emitted).toBe(DATABASE_HEALTH_MAX_PER_HOUR);
  });

  it('bounds the window map so instance churn cannot leak memory', () => {
    const { diagnostics } = createHarness({ maxWindowKeys: 2 });
    const emitFor = (instanceId: string) =>
      diagnostics.emitDatabaseError(errorInput({ instanceId }));

    for (let attempt = 0; attempt < DATABASE_HEALTH_MAX_PER_WINDOW; attempt += 1) {
      expect(emitFor('dbh_a')).toBeDefined();
    }
    expect(emitFor('dbh_a')).toBeUndefined();

    expect(emitFor('dbh_b')?.sampling).toEqual({ suppressedSinceLastEmit: 0, emittedInWindow: 1 });
    // dbh_c evicts the least recently used window (dbh_a) ...
    expect(emitFor('dbh_c')?.sampling).toEqual({ suppressedSinceLastEmit: 0, emittedInWindow: 1 });
    // ... so its next failure starts a fresh window instead of staying suppressed forever.
    expect(emitFor('dbh_a')?.sampling).toEqual({ suppressedSinceLastEmit: 0, emittedInWindow: 1 });
    // Re-inserting dbh_a evicted dbh_b: the map never holds more than `maxWindowKeys`, and an
    // evicted window only loses its suppression counters, never an error class.
    expect(emitFor('dbh_b')?.sampling).toEqual({ suppressedSinceLastEmit: 0, emittedInWindow: 1 });
  });

  it.each(GOLDEN_VECTORS)('normalizes the golden vector %s', (input, expected) => {
    expect(normalizeDatabaseErrorSummary(input)).toBe(expected);
  });

  it.each([
    'relation "public.users" does not exist',
    'schema "internal" does not exist',
    'column "email" of relation "users" does not exist',
    'constraint "Base_pkey" of relation "Base"',
    'null value in column "name" violates not-null constraint',
    'permission denied for table "Record"',
    'permission denied for sequence "Record_id_seq"',
    'role "teable" does not exist',
    'database "teable" already exists',
    'column "id" specified more than once',
  ])('keeps the schema identifier of the PG template in %s', (input) => {
    expect(normalizeDatabaseErrorSummary(input)).toBe(input);
  });

  it('redacts quoted spans that no template covers, and values outside quotes', () => {
    // A quoted token is only trusted inside a template: this table name is not covered by
    // the foreign-key template, so it is treated as a value.
    expect(
      normalizeDatabaseErrorSummary(
        'insert or update on table "SecretTable" violates foreign key constraint "fk_base"'
      )
    ).toBe('insert or update on table ? violates foreign key constraint "fk_base"');
    expect(
      normalizeDatabaseErrorSummary(
        "invalid input syntax for type uuid: '550e8400-e29b-41d4-a716-446655440000'"
      )
    ).toBe('invalid input syntax for type uuid: ?');
    expect(
      normalizeDatabaseErrorSummary(
        'invalid input syntax for type uuid: 550e8400-e29b-41d4-a716-446655440000'
      )
    ).toBe('invalid input syntax for type uuid: ?');
    expect(
      normalizeDatabaseErrorSummary('invalid byte sequence for encoding: 0xdeadbeefdeadbeef')
    ).toBe('invalid byte sequence for encoding: ?');
    expect(
      normalizeDatabaseErrorSummary('could not connect to https://db.example.com:5432/teable')
    ).toBe('could not connect to ?');
    expect(normalizeDatabaseErrorSummary('role app@example.com was rejected')).toBe(
      'role ? was rejected'
    );
    expect(normalizeDatabaseErrorSummary("deadlock detected on table 'recAbc' update 42")).toBe(
      'deadlock detected on table ? update ?'
    );
    expect(normalizeDatabaseErrorSummary('value out of range: -12.5')).toBe(
      'value out of range: ?'
    );
    expect(
      normalizeDatabaseErrorSummary(
        "token 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef'"
      )
    ).toBe('token ?');
    expect(normalizeDatabaseErrorSummary('   ')).toBeNull();
    expect(normalizeDatabaseErrorSummary(undefined)).toBeNull();
    expect(normalizeDatabaseErrorSummary('canceling statement '.repeat(20))).toHaveLength(200);
  });

  it('never logs raw error text, and reports an empty redaction instead', () => {
    const { diagnostics } = createHarness();

    const redacted = diagnostics.emitDatabaseError(
      errorInput({
        message:
          'invalid input syntax for type uuid: "550e8400-e29b-41d4-a716-446655440000" at "recSecret"',
      })
    );
    expect(redacted?.redactedSummary).toBe('invalid input syntax for type uuid: ? at ?');
    expect(JSON.stringify(redacted)).not.toContain('550e8400');
    expect(JSON.stringify(redacted)).not.toContain('recSecret');

    const empty = diagnostics.emitDatabaseError(errorInput({ message: '   ' }));
    expect(empty?.redactedSummary).toBeNull();
    expect(empty?.redactedSummaryReason).toBe('no_redactable_error_text');
  });

  it('fingerprints the normalized input, so it is stable and value free', () => {
    const { diagnostics } = createHarness();
    const first = diagnostics.emitDatabaseError(
      errorInput({ message: 'invalid input syntax for type integer: "users"' })
    );
    const second = diagnostics.emitDatabaseError(
      errorInput({ message: 'invalid input syntax for type integer: "customers"' })
    );

    expect(first?.fingerprint).toMatch(/^dbh_fp_[0-9a-f]{24}$/);
    // Different values, same failure shape: one fingerprint.
    expect(second?.fingerprint).toBe(first?.fingerprint);
    // A template identifier is part of the shape, so it separates fingerprints instead.
    expect(
      diagnostics.emitDatabaseError(
        errorInput({
          message: 'duplicate key value violates unique constraint "users_email_key"',
        })
      )?.fingerprint
    ).not.toBe(
      diagnostics.emitDatabaseError(
        errorInput({
          message: 'duplicate key value violates unique constraint "customers_pkey"',
        })
      )?.fingerprint
    );
    expect(
      diagnostics.emitDatabaseError(errorInput({ instanceId: 'dbh_other' }))?.fingerprint
    ).not.toBe(
      diagnostics.emitDatabaseError(
        errorInput({ classification: classifyDatabaseError({ code: '08006' }) })
      )?.fingerprint
    );
    expect(fingerprintDatabaseError('dbh_a', 'other', 'relation does not exist')).not.toBe(
      fingerprintDatabaseError('dbh_b', 'other', 'relation does not exist')
    );
  });

  it.each(GOLDEN_VECTORS)(
    'fingerprints the production shape %s deterministically and per instance',
    (input) => {
      const summary = normalizeDatabaseErrorSummary(input);
      const onInstanceA = fingerprintDatabaseError('dbh_a', 'other', summary);

      expect(onInstanceA).toBe(fingerprintDatabaseError('dbh_a', 'other', summary));
      expect(onInstanceA).not.toBe(fingerprintDatabaseError('dbh_b', 'other', summary));
      expect(onInstanceA).toMatch(/^dbh_fp_[0-9a-f]{24}$/);
    }
  );

  it('collapses different values of the same production message into one fingerprint', () => {
    const messageWithValue = (value: string) => `invalid input syntax for type integer: "${value}"`;

    expect(normalizeDatabaseErrorSummary(messageWithValue('999999999'))).toBe(
      normalizeDatabaseErrorSummary(messageWithValue('abc'))
    );
    expect(
      fingerprintDatabaseError(
        'dbh_a',
        'data_validation',
        normalizeDatabaseErrorSummary(messageWithValue('999999999'))
      )
    ).toBe(
      fingerprintDatabaseError(
        'dbh_a',
        'data_validation',
        normalizeDatabaseErrorSummary(messageWithValue('abc'))
      )
    );
  });

  it('omits correlation entirely without a CLS context and reports it with one', () => {
    const { diagnostics } = createHarness();

    expect(diagnostics.readDataDbContext()).toBeUndefined();
    expect(diagnostics.emitDatabaseError(errorInput())?.correlation).toBeUndefined();

    diagnostics.bindClsService(
      fakeCls({
        spaceId: 'spc1',
        baseId: 'bse1',
        tableId: 'tbl1',
        taskId: 'tsk1',
        dataDb: { connectionId: 'cmr1' },
      })
    );

    expect(diagnostics.readDataDbContext()).toEqual({ connectionId: 'cmr1' });
    expect(diagnostics.readDataDbConnectionId()).toBe('cmr1');
    expect(diagnostics.emitDatabaseError(errorInput())?.correlation).toEqual({
      spaceId: 'spc1',
      baseId: 'bse1',
      tableId: 'tbl1',
      taskId: 'tsk1',
      dataDbConnectionId: 'cmr1',
    });
  });

  it('drops correlation fields that CLS cannot provide', () => {
    const { diagnostics } = createHarness();
    diagnostics.bindClsService(fakeCls({ spaceId: 'spc1', dataDb: {} }));

    expect(diagnostics.readDataDbContext()).toEqual({});
    expect(diagnostics.emitDatabaseError(errorInput())?.correlation).toEqual({
      spaceId: 'spc1',
    });
  });

  it('survives a CLS that throws and a log sink that throws', () => {
    const throwingCls = {
      get: () => {
        throw new Error('no active context');
      },
    } as unknown as ClsService<IClsStore>;
    const { diagnostics } = createHarness();
    diagnostics.bindClsService(throwingCls);

    expect(diagnostics.readDataDbContext()).toBeUndefined();
    const event = diagnostics.emitDatabaseError(errorInput());
    expect(event?.correlation).toBeUndefined();
    expect(event?.instanceId).toBe('dbh_a');

    const failing = new DatabaseHealthDiagnostics({
      logSink: {
        log: () => {
          throw new Error('logger down');
        },
      },
    });
    expect(() => failing.emitDatabaseError(errorInput())).not.toThrow();
  });

  it('falls back to NODE_ENV when no deployment environment is configured', () => {
    vi.stubEnv('DEPLOYMENT_ENVIRONMENT', undefined);
    const { diagnostics } = createHarness();

    expect(diagnostics.emitDatabaseError(errorInput())?.environment).toBe('test');
  });
});

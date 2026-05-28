/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable sonarjs/no-duplicate-string */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataDbPreflightClient } from './data-db-preflight.service';
import {
  DataDbPreflightService,
  fingerprintDatabaseUrl,
  maskDatabaseUrl,
} from './data-db-preflight.service';

type IFakeDbState = {
  schemas?: string[];
  tables?: Array<{ table_schema: string; table_name: string }>;
  functions?: string[];
  databases?: string[];
  failCreateSchema?: boolean;
  failConnect?: boolean;
  failMessage?: string;
  failCode?: string;
};

class FakePreflightClient implements IDataDbPreflightClient {
  constructor(private readonly state: IFakeDbState) {}

  async raw<T = unknown>(sql: string): Promise<{ rows: T[] }> {
    if (this.state.failConnect) {
      const error = new Error(this.state.failMessage ?? 'connection failed');
      Object.assign(error, { code: this.state.failCode });
      throw error;
    }
    if (sql.includes('CREATE SCHEMA') && this.state.failCreateSchema) {
      throw new Error('permission denied for database');
    }
    if (sql.includes('SHOW server_version')) {
      return { rows: [{ server_version: '14.12' }] as T[] };
    }
    if (sql.includes('has_database_privilege')) {
      return { rows: [{ can_create: true }] as T[] };
    }
    if (sql.includes('pg_roles')) {
      return { rows: [{ can_create_role: false }] as T[] };
    }
    if (sql.includes('pg_stat_activity')) {
      return { rows: [{ count: '0' }] as T[] };
    }
    if (sql.includes('pg_database')) {
      return {
        rows: (this.state.databases ?? ['postgres', 'teable_data']).map((datname) => ({
          datname,
        })) as T[],
      };
    }
    if (sql.includes('information_schema.schemata')) {
      return {
        rows: (this.state.schemas ?? ['public']).map((schema_name) => ({ schema_name })) as T[],
      };
    }
    if (sql.includes('information_schema.tables')) {
      return { rows: (this.state.tables ?? []) as T[] };
    }
    if (sql.includes('information_schema.routines')) {
      return {
        rows: (this.state.functions ?? []).map((routine_name) => ({ routine_name })) as T[],
      };
    }
    return { rows: [] };
  }

  async destroy(): Promise<void> {
    return undefined;
  }
}

const DATA_URL = 'postgresql://teable:secret@example.com:5432/teable_data';
const internalSchema = 'teable_meta_test';
const BASELINE_TABLES = [
  'computed_update_outbox',
  'computed_update_outbox_seed',
  'computed_update_dead_letter',
  'computed_update_pause_scope',
  'record_history',
  'table_trash',
  'record_trash',
  '__undo_log',
];
const DATA_SCHEMA_MIGRATION_TABLE = '__teable_data_schema_migrations';

const createService = (state: IFakeDbState) =>
  new DataDbPreflightService(undefined, () => new FakePreflightClient(state));

describe('database URL helpers', () => {
  it('masks database URL passwords', () => {
    expect(maskDatabaseUrl(DATA_URL)).toBe('postgresql://teable:***@example.com:5432/teable_data');
  });

  it('creates a stable fingerprint without exposing the URL', () => {
    const fingerprint = fingerprintDatabaseUrl(DATA_URL);

    expect(fingerprint).toBe(fingerprintDatabaseUrl(DATA_URL));
    expect(fingerprint).toMatch(/^dbfp_[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain('secret');
  });
});

describe('DataDbPreflightService', () => {
  beforeEach(() => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
  });

  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('classifies an empty database as usable', async () => {
    const result = await createService({ schemas: ['public'], tables: [] }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(true);
    expect(result.classification).toBe('empty');
    expect(result.capabilities.createSchema).toBe(true);
    expect(result.capabilities.createTable).toBe(true);
    expect(result.capabilities.createFunction).toBe(true);
    expect(result.capabilities.createTrigger).toBe(true);
    expect(result.maskedUrl).not.toContain('secret');
  });

  it('classifies a compatible Teable data database', async () => {
    const result = await createService({
      schemas: ['public', internalSchema, 'bseabc'],
      tables: [...BASELINE_TABLES, DATA_SCHEMA_MIGRATION_TABLE].map((table_name) => ({
        table_schema: internalSchema,
        table_name,
      })),
      functions: ['__teable_capture_undo_row'],
    }).preflight({
      url: DATA_URL,
      targetMode: 'adopt-existing',
      internalSchema,
    });

    expect(result.ok).toBe(true);
    expect(result.classification).toBe('teable-managed-compatible');
    expect(result.errors).toEqual([]);
  });

  it('allows the internal data schema migration history table in Teable-managed schemas', async () => {
    const result = await createService({
      schemas: ['public', internalSchema],
      tables: [...BASELINE_TABLES, DATA_SCHEMA_MIGRATION_TABLE].map((table_name) => ({
        table_schema: internalSchema,
        table_name,
      })),
      functions: ['__teable_capture_undo_row'],
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
      internalSchema,
    });

    expect(result.ok).toBe(true);
    expect(result.classification).toBe('teable-managed-compatible');
    expect(result.errors).toEqual([]);
  });

  it('rejects a partial Teable data database as incompatible', async () => {
    const result = await createService({
      schemas: ['public', internalSchema],
      tables: [{ table_schema: internalSchema, table_name: 'record_history' }],
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
      internalSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.classification).toBe('teable-managed-incompatible');
    expect(result.errors.map((error) => error.code)).toContain('INCOMPATIBLE_TEABLE_DATABASE');
  });

  it('allows non-empty public schemas because BYODB uses Teable internal schemas', async () => {
    const result = await createService({
      schemas: ['public'],
      tables: [{ table_schema: 'public', table_name: 'customer_table' }],
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(true);
    expect(result.classification).toBe('empty');
    expect(result.errors).toEqual([]);
  });

  it('allows other base schemas while initializing an empty internal schema', async () => {
    const result = await createService({
      schemas: ['public', internalSchema, 'bse_existing_base'],
      tables: [
        { table_schema: 'bse_existing_base', table_name: 'sheet_table' },
        { table_schema: 'public', table_name: 'customer_table' },
      ],
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
      internalSchema,
    });

    expect(result.ok).toBe(true);
    expect(result.classification).toBe('empty');
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown objects inside the Teable internal schema', async () => {
    const result = await createService({
      schemas: ['public', internalSchema],
      tables: [{ table_schema: internalSchema, table_name: 'customer_table' }],
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
      internalSchema,
    });

    expect(result.ok).toBe(false);
    expect(result.classification).toBe('non-empty-unknown');
    expect(result.errors.map((error) => error.code)).toContain('NON_EMPTY_UNKNOWN_DATABASE');
  });

  it('reports missing DDL privileges', async () => {
    const result = await createService({
      schemas: ['public'],
      failCreateSchema: true,
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(false);
    expect(result.capabilities.createSchema).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('DDL_PRIVILEGE_CHECK_FAILED');
  });

  it('does not leak passwords in connection errors', async () => {
    const result = await createService({
      failConnect: true,
      failMessage: `failed to connect to ${DATA_URL}`,
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
    });

    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.errors.map((error) => error.code)).toContain('CONNECTION_FAILED');
  });

  it('returns a specific error when an IPv6 address is unreachable', async () => {
    const result = await createService({
      failConnect: true,
      failCode: 'ENETUNREACH',
      failMessage: 'connect ENETUNREACH 2406:da1c:4c7:f800:9d0b:f8d1:c668:930:5432',
    }).preflight({
      url: DATA_URL,
      targetMode: 'initialize-empty',
    });

    expect(result.errors.map((error) => error.code)).toContain('IPV6_NETWORK_UNREACHABLE');
    expect(result.errors[0]?.remediation).toContain('IPv4-reachable');
  });

  it('returns database choices when the URL database does not exist', async () => {
    const requestedUrl = 'postgresql://teable:secret@example.com:5432/missing_db';
    const clients: Record<string, IFakeDbState> = {
      [requestedUrl]: {
        failConnect: true,
        failCode: '3D000',
        failMessage: 'database "missing_db" does not exist',
      },
      ['postgresql://teable:secret@example.com:5432/postgres']: {
        databases: ['postgres', 'teable_data'],
      },
    };
    const service = new DataDbPreflightService(
      undefined,
      (url) => new FakePreflightClient(clients[url] ?? {})
    );

    const result = await service.preflight({
      url: requestedUrl,
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(false);
    expect(result.displayDatabase).toBe('missing_db');
    expect(result.serverVersion).toBe('14.12');
    expect(result.availableDatabases).toEqual(['postgres', 'teable_data']);
    expect(result.errors.map((error) => error.code)).toContain('CONNECTION_FAILED');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('returns database choices when the URL omits the database name', async () => {
    const requestedUrl = 'postgresql://teable:secret@example.com:5432';
    const clients: Record<string, IFakeDbState> = {
      ['postgresql://teable:secret@example.com:5432/postgres']: {
        databases: ['postgres', 'teable_data'],
      },
    };
    const service = new DataDbPreflightService(
      undefined,
      (url) => new FakePreflightClient(clients[url] ?? {})
    );

    const result = await service.preflight({
      url: requestedUrl,
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(false);
    expect(result.displayDatabase).toBe('');
    expect(result.availableDatabases).toEqual(['postgres', 'teable_data']);
    expect(result.requiresDatabaseSelection).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects unsupported database URL drivers', async () => {
    const result = await createService({}).preflight({
      url: 'mysql://teable:secret@example.com:3306/teable_data',
      targetMode: 'initialize-empty',
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.errors.map((error) => error.code)).toContain('INVALID_DATABASE_URL');
  });

  it('returns default summary when a space has no explicit binding', async () => {
    const service = new DataDbPreflightService({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(service.getSummary('spcxxx')).resolves.toEqual({
      mode: 'default',
      state: 'ready',
    });
  });

  it('returns a BYODB summary without encrypted URL material', async () => {
    const service = new DataDbPreflightService({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            provider: 'postgres',
            displayHost: 'example.com:5432',
            displayDatabase: 'teable_data',
            internalSchema,
            schemaVersion: '20260421000000_init_data_db_baseline',
            lastValidatedAt: new Date('2026-05-06T00:00:00.000Z'),
            lastError: null,
            encryptedUrl: 'encrypted-secret',
            capabilities: {
              createSchema: true,
              createTable: true,
              createFunction: true,
              createTrigger: true,
              createRole: false,
              grantPrivileges: true,
              inspectActivity: true,
            },
          },
        }),
      },
    } as never);

    const summary = await service.getSummary('spcxxx');

    expect(summary).toMatchObject({
      mode: 'byodb',
      state: 'ready',
      provider: 'postgres',
      displayHost: 'example.com:5432',
      displayDatabase: 'teable_data',
      internalSchema,
      schemaVersion: '20260421000000_init_data_db_baseline',
      lastValidatedAt: '2026-05-06T00:00:00.000Z',
    });
    expect(JSON.stringify(summary)).not.toContain('encrypted-secret');
  });
});

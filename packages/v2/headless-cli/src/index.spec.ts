import { describe, expect, it } from 'vitest';

import { resolveBackendFromEnv } from './index';

describe('resolveBackendFromEnv', () => {
  it('selects PGlite from TEABLE_PGLITE_DIR', () => {
    const backend = resolveBackendFromEnv({ TEABLE_PGLITE_DIR: './data' });
    expect(backend).toMatchObject({ kind: 'pglite', dataDir: './data', bootstrap: true });
  });

  it('selects PostgreSQL from a database URL', () => {
    const backend = resolveBackendFromEnv({
      TEABLE_DATABASE_URL: 'postgres://localhost/teable',
    });
    expect(backend).toMatchObject({
      kind: 'postgres',
      connectionString: 'postgres://localhost/teable',
      bootstrap: false,
    });
  });

  it('requires a backend configuration', () => {
    expect(() => resolveBackendFromEnv({})).toThrow('Set TEABLE_PGLITE_DIR');
  });
});

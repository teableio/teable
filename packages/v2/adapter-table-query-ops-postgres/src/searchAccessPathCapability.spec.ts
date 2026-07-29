import { describe, expect, it } from 'vitest';

import { resolveSearchAccessPathCapability } from './searchAccessPathCapability';

describe('resolveSearchAccessPathCapability', () => {
  it.each([
    {
      name: 'installed and preloaded pg_bigm is ready',
      input: {
        name: 'pg_bigm',
        available: true,
        installed: true,
        shared_preload_libraries: 'pg_stat_statements,pg_bigm',
        operator_class_schema: 'public',
      },
      expected: {
        provider: 'pg_bigm',
        state: 'ready',
        operatorClass: 'gin_bigm_ops',
        minimumProbeLength: 2,
        operatorClassInstalled: true,
      },
    },
    {
      name: 'pg_bigm without preload requires a cluster restart',
      input: {
        name: 'pg_bigm',
        available: true,
        installed: false,
        shared_preload_libraries: 'pg_stat_statements',
        operator_class_schema: null,
      },
      expected: {
        provider: 'pg_bigm',
        state: 'requires_cluster_restart',
        reason: 'pg_bigm_not_preloaded',
      },
    },
    {
      name: 'bundled pg_trgm only requires database installation',
      input: {
        name: 'pg_trgm',
        available: true,
        installed: false,
        shared_preload_libraries: '',
        operator_class_schema: null,
      },
      expected: {
        provider: 'pg_trgm',
        state: 'requires_database_extension',
        operatorClass: 'gin_trgm_ops',
        minimumProbeLength: 3,
      },
    },
    {
      name: 'missing extension is unavailable',
      input: {
        name: 'pg_bigm',
        available: false,
        installed: false,
        shared_preload_libraries: '',
        operator_class_schema: null,
      },
      expected: {
        provider: 'pg_bigm',
        state: 'unavailable',
        reason: 'pg_bigm_not_available',
      },
    },
    {
      name: 'installed extension without its GIN operator class is unavailable',
      input: {
        name: 'pg_trgm',
        available: true,
        installed: true,
        shared_preload_libraries: '',
        operator_class_schema: null,
      },
      expected: {
        provider: 'pg_trgm',
        state: 'unavailable',
        reason: 'pg_trgm_operator_class_missing',
        operatorClassInstalled: false,
      },
    },
  ])('$name', ({ input, expected }) => {
    expect(resolveSearchAccessPathCapability(input)).toMatchObject(expected);
  });
});

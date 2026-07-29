import { describe, expect, it } from 'vitest';
import type { TableQueryOpsSearchProviderCapabilitySummary } from '../services/TableQueryOps';
import {
  compareExactRecordIds,
  selectSearchProviderCapability,
  summarizeSearchTimings,
} from './searchAccessPath';

const capability = (
  provider: 'pg_bigm' | 'pg_trgm',
  state: TableQueryOpsSearchProviderCapabilitySummary['state']
): TableQueryOpsSearchProviderCapabilitySummary => ({
  provider,
  extensionName: provider,
  operatorClass: provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops',
  minimumProbeLength: provider === 'pg_bigm' ? 2 : 3,
  state,
  installed: state === 'ready',
  available: state !== 'unavailable',
  preloaded: state !== 'requires_cluster_restart',
});

describe('substring search access-path helpers', () => {
  it('prefers ready pg_bigm for auto and honors an explicit provider', () => {
    const capabilities = [capability('pg_bigm', 'ready'), capability('pg_trgm', 'ready')];

    expect(selectSearchProviderCapability('auto', capabilities)?.provider).toBe('pg_bigm');
    expect(selectSearchProviderCapability('pg_trgm', capabilities)?.provider).toBe('pg_trgm');
  });

  it('falls back to the reported pg_trgm capability without pretending it is ready', () => {
    const capabilities = [
      capability('pg_bigm', 'unavailable'),
      capability('pg_trgm', 'requires_database_extension'),
    ];

    expect(selectSearchProviderCapability('auto', capabilities)).toMatchObject({
      provider: 'pg_trgm',
      state: 'requires_database_extension',
    });
  });

  it('compares complete result ids independent of ordering', () => {
    expect(compareExactRecordIds(['recB', 'recA'], ['recA', 'recB'])).toEqual({
      exactResultMatch: true,
      missingFromOptimized: [],
      unexpectedFromOptimized: [],
    });
    expect(compareExactRecordIds(['recA', 'recB'], ['recB', 'recC'])).toEqual({
      exactResultMatch: false,
      missingFromOptimized: ['recA'],
      unexpectedFromOptimized: ['recC'],
    });
  });

  it('keeps every timing run and derives stable summary statistics', () => {
    expect(summarizeSearchTimings([9, 1, 5, 3, 7])).toEqual({
      runsMs: [9, 1, 5, 3, 7],
      minMs: 1,
      medianMs: 5,
      p95Ms: 9,
      maxMs: 9,
      averageMs: 5,
    });
  });
});

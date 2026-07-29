import type {
  TableQueryOpsSearchAccessPathProvider,
  TableQueryOpsSearchProviderCapabilitySummary,
  TableQueryOpsSearchTimingSummary,
} from '../services/TableQueryOps';

export const selectSearchProviderCapability = (
  requested: TableQueryOpsSearchAccessPathProvider,
  capabilities: readonly TableQueryOpsSearchProviderCapabilitySummary[]
): TableQueryOpsSearchProviderCapabilitySummary | undefined => {
  if (requested !== 'auto') {
    return capabilities.find((capability) => capability.provider === requested);
  }
  return (
    capabilities.find(
      (capability) => capability.provider === 'pg_bigm' && capability.state === 'ready'
    ) ?? capabilities.find((capability) => capability.provider === 'pg_trgm')
  );
};

const percentile = (sorted: readonly number[], quantile: number): number => {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)] ?? 0;
};

const roundTiming = (value: number): number => Number(value.toFixed(3));

export const summarizeSearchTimings = (
  runsMs: readonly number[]
): TableQueryOpsSearchTimingSummary => {
  const sorted = [...runsMs].sort((left, right) => left - right);
  const average = sorted.length
    ? sorted.reduce((total, value) => total + value, 0) / sorted.length
    : 0;
  return {
    runsMs: runsMs.map(roundTiming),
    minMs: roundTiming(sorted[0] ?? 0),
    medianMs: roundTiming(percentile(sorted, 0.5)),
    p95Ms: roundTiming(percentile(sorted, 0.95)),
    maxMs: roundTiming(sorted.at(-1) ?? 0),
    averageMs: roundTiming(average),
  };
};

export const compareExactRecordIds = (
  legacyIds: readonly string[],
  optimizedIds: readonly string[]
): {
  readonly exactResultMatch: boolean;
  readonly missingFromOptimized: readonly string[];
  readonly unexpectedFromOptimized: readonly string[];
} => {
  const legacy = new Set(legacyIds);
  const optimized = new Set(optimizedIds);
  const missingFromOptimized = [...legacy].filter((id) => !optimized.has(id)).sort();
  const unexpectedFromOptimized = [...optimized].filter((id) => !legacy.has(id)).sort();
  return {
    exactResultMatch: missingFromOptimized.length === 0 && unexpectedFromOptimized.length === 0,
    missingFromOptimized,
    unexpectedFromOptimized,
  };
};

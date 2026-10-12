import type { TableQueryObservationWindow } from './domain';

export const CLUSTER_OBSERVATION_WRITER_ID = 'cluster';
export const DEFAULT_OBSERVATION_MIN_REQUEST_COUNT = 10;

export type ObservationPersistDecision = 'keep' | 'persist' | 'drop';

export const decideObservationPersist = (
  observation: TableQueryObservationWindow,
  now: Date,
  minRequestCount: number = DEFAULT_OBSERVATION_MIN_REQUEST_COUNT
): ObservationPersistDecision => {
  const snapshot = observation.snapshot();
  const interesting =
    snapshot.slowCount > 0 ||
    snapshot.timeoutCount > 0 ||
    snapshot.dbErrorCount > 0 ||
    snapshot.requestCount >= minRequestCount;
  if (interesting) return 'persist';

  const windowEndMs = snapshot.windowStart.getTime() + snapshot.windowSizeSeconds * 1_000;
  return now.getTime() < windowEndMs ? 'keep' : 'drop';
};

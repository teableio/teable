/* eslint-disable @typescript-eslint/naming-convention */

export type ISpaceDataDbMigrationStageKey =
  | 'prepare'
  | 'copy'
  | 'shared'
  | 'delta'
  | 'validate'
  | 'switch';

export type ISpaceDataDbMigrationStage = {
  key: ISpaceDataDbMigrationStageKey;
  weight: number;
};

// Stage weights are the share of the overall progress bar; the copy stage
// dominates because it scales with data volume while the others are bounded.
export const spaceDataDbMigrationStages: readonly ISpaceDataDbMigrationStage[] = [
  { key: 'prepare', weight: 8 },
  { key: 'copy', weight: 56 },
  { key: 'shared', weight: 10 },
  { key: 'delta', weight: 6 },
  { key: 'validate', weight: 14 },
  { key: 'switch', weight: 6 },
];

type IStagePosition = {
  stage: ISpaceDataDbMigrationStageKey;
  fraction: number;
};

// Static in-stage fraction for each worker phase. Drain phases repeat at the
// final write gate after delta replay; the monotonic tracker keeps the
// reported percent from moving backwards when they do.
const spaceDataDbMigrationPhasePositions: Record<string, IStagePosition> = {
  postgres_tools_checking: { stage: 'prepare', fraction: 0 },
  postgres_tools_checked: { stage: 'prepare', fraction: 0.15 },
  postgres_tools_unavailable: { stage: 'prepare', fraction: 0.15 },
  computed_paused: { stage: 'prepare', fraction: 0.25 },
  computed_draining: { stage: 'prepare', fraction: 0.3 },
  computed_drained: { stage: 'prepare', fraction: 0.4 },
  computed_drain_timeout: { stage: 'prepare', fraction: 0.3 },
  computed_drain_failed: { stage: 'prepare', fraction: 0.3 },
  schema_operations_draining: { stage: 'prepare', fraction: 0.45 },
  schema_operations_drained: { stage: 'prepare', fraction: 0.55 },
  schema_operation_drain_timeout: { stage: 'prepare', fraction: 0.45 },
  schema_operation_drain_failed: { stage: 'prepare', fraction: 0.45 },
  background_writers_draining: { stage: 'prepare', fraction: 0.6 },
  background_writers_drained: { stage: 'prepare', fraction: 0.7 },
  background_writer_drain_timeout: { stage: 'prepare', fraction: 0.6 },
  background_writer_drain_failed: { stage: 'prepare', fraction: 0.6 },
  source_inventory_verified: { stage: 'prepare', fraction: 0.75 },
  source_inventory_changed: { stage: 'prepare', fraction: 0.75 },
  source_snapshot_exported: { stage: 'prepare', fraction: 0.85 },
  source_delta_capture_installed: { stage: 'prepare', fraction: 0.92 },
  temp_disk_checked: { stage: 'prepare', fraction: 1 },
  temp_disk_insufficient: { stage: 'prepare', fraction: 0.95 },
  canceled_before_copy: { stage: 'prepare', fraction: 0.5 },
  copying_base_schemas: { stage: 'copy', fraction: 0 },
  base_schemas_completed: { stage: 'copy', fraction: 1 },
  base_schemas_failed: { stage: 'copy', fraction: 0 },
  copying_shared_rows: { stage: 'shared', fraction: 0 },
  shared_rows_completed: { stage: 'shared', fraction: 1 },
  shared_rows_failed: { stage: 'shared', fraction: 0 },
  delta_replaying: { stage: 'delta', fraction: 0 },
  delta_cutover_replaying: { stage: 'delta', fraction: 0.6 },
  delta_replayed: { stage: 'delta', fraction: 0.9 },
  final_writes_frozen: { stage: 'delta', fraction: 1 },
  validating_copy: { stage: 'validate', fraction: 0 },
  validation_completed: { stage: 'validate', fraction: 1 },
  validation_failed: { stage: 'validate', fraction: 0 },
  switching: { stage: 'switch', fraction: 0.5 },
  succeeded: { stage: 'switch', fraction: 1 },
};

export type ISpaceDataDbMigrationProgressDetail = {
  // Fine-grained completion of the current stage (0..1) measured from live
  // signals (copied bytes, copied tables, replayed delta sequence).
  stageFraction?: number;
  // Cumulative bytes observed on the target for the base schema copy.
  copiedBytes?: number | null;
};

export type ISpaceDataDbWeightedMigrationProgress = {
  stage: ISpaceDataDbMigrationStageKey;
  stages: readonly ISpaceDataDbMigrationStage[];
  percent: number;
  copiedBytes: number | null;
  bytesPerSecond: number | null;
  etaMs: number | null;
};

const clampFraction = (value: number) => Math.min(Math.max(value, 0), 1);

const roundPercent = (value: number) => Math.round(value * 10) / 10;

export const buildSpaceDataDbMigrationPercent = (
  phase: string,
  detail?: ISpaceDataDbMigrationProgressDetail
): { stage: ISpaceDataDbMigrationStageKey; percent: number } => {
  const position = spaceDataDbMigrationPhasePositions[phase] ?? {
    stage: 'prepare' as const,
    fraction: 0,
  };
  const fraction = clampFraction(detail?.stageFraction ?? position.fraction);
  let offset = 0;
  let weight = 0;
  for (const stage of spaceDataDbMigrationStages) {
    if (stage.key === position.stage) {
      weight = stage.weight;
      break;
    }
    offset += stage.weight;
  }
  return {
    stage: position.stage,
    percent: phase === 'succeeded' ? 100 : roundPercent(offset + weight * fraction),
  };
};

type ITrackerEntry = {
  percent: number;
  percentSampledAtMs: number;
  percentPerMs: number | null;
  copiedBytes: number | null;
  bytesSampledAtMs: number | null;
  bytesPerSecond: number | null;
};

const minSampleIntervalMs = 250;
const maxEtaMs = 30 * 24 * 60 * 60 * 1000;
const speedEwmaAlpha = 0.3;

/**
 * Per-job smoothing of migration progress: keeps the reported percent
 * monotonic (drain phases repeat at the final write gate) and derives byte
 * throughput plus a dynamically adjusted ETA from EWMA velocities. State is
 * in-memory only; after a worker restart the ETA falls back to the linear
 * elapsed-time estimate until fresh samples arrive.
 */
export class SpaceDataDbMigrationProgressTracker {
  private readonly entries = new Map<string, ITrackerEntry>();

  track(
    jobId: string,
    input: { percent: number; copiedBytes: number | null; nowMs: number; elapsedMs: number | null }
  ): {
    percent: number;
    copiedBytes: number | null;
    bytesPerSecond: number | null;
    etaMs: number | null;
  } {
    const previous = this.entries.get(jobId);
    const percent = previous ? Math.max(previous.percent, input.percent) : input.percent;

    const entry: ITrackerEntry = previous ?? {
      percent,
      percentSampledAtMs: input.nowMs,
      percentPerMs: null,
      copiedBytes: null,
      bytesSampledAtMs: null,
      bytesPerSecond: null,
    };
    if (previous) {
      this.updatePercentVelocity(entry, previous, percent, input.nowMs);
    }
    entry.percent = percent;
    this.updateByteThroughput(entry, input.copiedBytes, input.nowMs);
    this.entries.set(jobId, entry);

    return {
      percent,
      copiedBytes: entry.copiedBytes,
      bytesPerSecond:
        entry.bytesPerSecond == null ? null : Math.round(entry.bytesPerSecond * 10) / 10,
      etaMs: this.computeEtaMs(entry, percent, input.elapsedMs),
    };
  }

  clear(jobId: string) {
    this.entries.delete(jobId);
  }

  private updatePercentVelocity(
    entry: ITrackerEntry,
    previous: ITrackerEntry,
    percent: number,
    nowMs: number
  ) {
    const deltaMs = nowMs - previous.percentSampledAtMs;
    if (deltaMs < minSampleIntervalMs || percent <= previous.percent) {
      return;
    }
    const velocity = (percent - previous.percent) / deltaMs;
    entry.percentPerMs =
      previous.percentPerMs == null
        ? velocity
        : speedEwmaAlpha * velocity + (1 - speedEwmaAlpha) * previous.percentPerMs;
    entry.percentSampledAtMs = nowMs;
  }

  private updateByteThroughput(entry: ITrackerEntry, copiedBytes: number | null, nowMs: number) {
    if (copiedBytes == null) {
      return;
    }
    const hasPreviousSample = entry.copiedBytes != null && entry.bytesSampledAtMs != null;
    if (hasPreviousSample && copiedBytes > (entry.copiedBytes as number)) {
      const deltaMs = nowMs - (entry.bytesSampledAtMs as number);
      if (deltaMs >= minSampleIntervalMs) {
        const speed = ((copiedBytes - (entry.copiedBytes as number)) / deltaMs) * 1000;
        entry.bytesPerSecond =
          entry.bytesPerSecond == null
            ? speed
            : speedEwmaAlpha * speed + (1 - speedEwmaAlpha) * entry.bytesPerSecond;
        entry.bytesSampledAtMs = nowMs;
      }
      entry.copiedBytes = copiedBytes;
      return;
    }
    if (entry.copiedBytes == null || copiedBytes >= entry.copiedBytes) {
      entry.copiedBytes = copiedBytes;
      entry.bytesSampledAtMs = entry.bytesSampledAtMs ?? nowMs;
    }
  }

  private computeEtaMs(entry: ITrackerEntry, percent: number, elapsedMs: number | null) {
    if (percent >= 100) {
      return 0;
    }
    if (entry.percentPerMs != null && entry.percentPerMs > 0) {
      return Math.min(Math.round((100 - percent) / entry.percentPerMs), maxEtaMs);
    }
    if (elapsedMs != null && percent > 0) {
      return Math.min(Math.round((elapsedMs * (100 - percent)) / percent), maxEtaMs);
    }
    return null;
  }
}

const terminalMigrationPhases = new Set([
  'succeeded',
  'postgres_tools_unavailable',
  'base_schemas_failed',
  'shared_rows_failed',
  'validation_failed',
  'canceled_before_copy',
]);

export const isTerminalSpaceDataDbMigrationPhase = (phase: string) =>
  terminalMigrationPhases.has(phase);

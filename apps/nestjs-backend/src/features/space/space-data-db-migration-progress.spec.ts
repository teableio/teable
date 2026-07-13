import { describe, expect, it } from 'vitest';
import {
  buildSpaceDataDbMigrationPercent,
  isTerminalSpaceDataDbMigrationPhase,
  SpaceDataDbMigrationProgressTracker,
  spaceDataDbMigrationStages,
} from './space-data-db-migration-progress';

describe('buildSpaceDataDbMigrationPercent', () => {
  it('sums stage weights to 100', () => {
    expect(spaceDataDbMigrationStages.reduce((sum, stage) => sum + stage.weight, 0)).toBe(100);
  });

  it('maps phases to monotonically increasing percents along the happy path', () => {
    const phases = [
      'postgres_tools_checking',
      'postgres_tools_checked',
      'schema_operations_draining',
      'schema_operations_drained',
      'source_inventory_verified',
      'source_snapshot_exported',
      'source_delta_capture_installed',
      'temp_disk_checked',
      'copying_base_schemas',
      'base_schemas_completed',
      'copying_shared_rows',
      'shared_rows_completed',
      'delta_replaying',
      'delta_cutover_replaying',
      'delta_replayed',
      'final_writes_frozen',
      'validating_copy',
      'validation_completed',
      'switching',
      'succeeded',
    ];
    const percents = phases.map((phase) => buildSpaceDataDbMigrationPercent(phase).percent);
    for (let index = 1; index < percents.length; index++) {
      expect(percents[index]).toBeGreaterThanOrEqual(percents[index - 1]);
    }
    expect(percents[percents.length - 1]).toBe(100);
  });

  it('keeps the prepare stage small compared to the copy stage', () => {
    expect(buildSpaceDataDbMigrationPercent('source_snapshot_exported').percent).toBeLessThan(10);
    expect(buildSpaceDataDbMigrationPercent('base_schemas_completed').percent).toBeGreaterThan(60);
  });

  it('interpolates the copy stage from the stage fraction', () => {
    const start = buildSpaceDataDbMigrationPercent('copying_base_schemas');
    const half = buildSpaceDataDbMigrationPercent('copying_base_schemas', { stageFraction: 0.5 });
    const done = buildSpaceDataDbMigrationPercent('base_schemas_completed');
    expect(start.stage).toBe('copy');
    expect(half.percent).toBeGreaterThan(start.percent);
    expect(half.percent).toBeLessThan(done.percent);
    expect(half.percent).toBeCloseTo(start.percent + (done.percent - start.percent) / 2, 1);
  });

  it('falls back to the prepare stage for unknown phases', () => {
    expect(buildSpaceDataDbMigrationPercent('unknown_phase')).toEqual({
      stage: 'prepare',
      percent: 0,
    });
  });
});

describe('SpaceDataDbMigrationProgressTracker', () => {
  it('keeps percent monotonic when drain phases repeat at the final write gate', () => {
    const tracker = new SpaceDataDbMigrationProgressTracker();
    const first = tracker.track('job1', {
      percent: buildSpaceDataDbMigrationPercent('delta_replaying').percent,
      copiedBytes: null,
      nowMs: 1_000,
      elapsedMs: 1_000,
    });
    const regressed = tracker.track('job1', {
      percent: buildSpaceDataDbMigrationPercent('computed_draining').percent,
      copiedBytes: null,
      nowMs: 2_000,
      elapsedMs: 2_000,
    });
    expect(regressed.percent).toBe(first.percent);
  });

  it('derives byte throughput and a velocity-based eta from samples', () => {
    const tracker = new SpaceDataDbMigrationProgressTracker();
    tracker.track('job1', { percent: 10, copiedBytes: 0, nowMs: 0, elapsedMs: 0 });
    // 10 MB and 10 percent per 10 seconds
    const result = tracker.track('job1', {
      percent: 20,
      copiedBytes: 10_000_000,
      nowMs: 10_000,
      elapsedMs: 10_000,
    });
    expect(result.bytesPerSecond).toBeCloseTo(1_000_000, 0);
    expect(result.etaMs).toBe(80_000);
  });

  it('smooths throughput with an ewma across samples', () => {
    const tracker = new SpaceDataDbMigrationProgressTracker();
    tracker.track('job1', { percent: 10, copiedBytes: 0, nowMs: 0, elapsedMs: 0 });
    tracker.track('job1', {
      percent: 20,
      copiedBytes: 10_000_000,
      nowMs: 10_000,
      elapsedMs: 10_000,
    });
    // burst: 30 MB in the next 10 seconds
    const result = tracker.track('job1', {
      percent: 30,
      copiedBytes: 40_000_000,
      nowMs: 20_000,
      elapsedMs: 20_000,
    });
    expect(result.bytesPerSecond).toBeGreaterThan(1_000_000);
    expect(result.bytesPerSecond).toBeLessThan(3_000_000);
  });

  it('falls back to the linear elapsed-time eta without velocity samples', () => {
    const tracker = new SpaceDataDbMigrationProgressTracker();
    const result = tracker.track('job1', {
      percent: 25,
      copiedBytes: null,
      nowMs: 100_000,
      elapsedMs: 60_000,
    });
    expect(result.etaMs).toBe(180_000);
  });

  it('reports zero eta at 100 percent and resets after clear', () => {
    const tracker = new SpaceDataDbMigrationProgressTracker();
    tracker.track('job1', { percent: 80, copiedBytes: null, nowMs: 0, elapsedMs: 0 });
    expect(
      tracker.track('job1', { percent: 100, copiedBytes: null, nowMs: 1_000, elapsedMs: 1_000 })
        .etaMs
    ).toBe(0);
    tracker.clear('job1');
    const fresh = tracker.track('job1', {
      percent: 5,
      copiedBytes: null,
      nowMs: 2_000,
      elapsedMs: null,
    });
    expect(fresh.percent).toBe(5);
    expect(fresh.etaMs).toBeNull();
  });
});

describe('isTerminalSpaceDataDbMigrationPhase', () => {
  it('flags terminal phases only', () => {
    expect(isTerminalSpaceDataDbMigrationPhase('succeeded')).toBe(true);
    expect(isTerminalSpaceDataDbMigrationPhase('validation_failed')).toBe(true);
    expect(isTerminalSpaceDataDbMigrationPhase('copying_base_schemas')).toBe(false);
  });
});

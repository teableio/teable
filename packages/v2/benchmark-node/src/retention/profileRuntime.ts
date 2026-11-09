import { ok as assert } from 'node:assert';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { PerformanceObserver, performance, type PerformanceEntry } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { writeHeapSnapshot } from 'node:v8';
import type { ISpan, ITracer, SpanAttributes } from '@teable/v2-core';

import { instrumentBulkUpdateSource } from './observeBulkUpdate';

export type ProfileMode = 'baseline' | 'retention' | 'boundary';
export type ProfileStackMode = 'normal' | 'undo' | 'redo';
export type ProfileOptions = {
  mode: ProfileMode;
  rows: number;
  fields: number;
  updatedFields: number;
  rounds: number;
  warmups: number;
  undoEnabled: boolean;
  stackMode: ProfileStackMode;
  snapshotStages: Set<string>;
};
export type Roots = Record<string, unknown>;
type Primitive = string | number | boolean | null;
export type CheckpointSample = {
  stage: string;
  atMs: number;
  memory: NodeJS.MemoryUsage;
  afterGc?: NodeJS.MemoryUsage;
  gcMs: number;
  snapshotMs: number;
  checkpointMs: number;
  snapshot?: string;
  snapshotId?: string;
  counters: Record<string, Primitive>;
  groups: Record<string, { kind: string; size?: number }>;
};
type ProbeGlobals = typeof globalThis & {
  __TEABLE_RECORD_UPDATE_RETENTION__?: (
    stage: string,
    roots: Roots,
    counters?: Record<string, unknown>
  ) => void;
  __TEABLE_RECORD_UPDATE_RETENTION_ROOTS__?: {
    stage: string;
    groups: Roots;
    isolateId: string;
    snapshotId: string;
  };
};
const globals = globalThis as ProbeGlobals;
const root = realpathSync(fileURLToPath(new URL('../../../../../../', import.meta.url)));
const servicePath =
  'community/packages/v2/core/src/application/services/RecordBulkUpdateService.ts';
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
// Keep marker nonces flat; analysis resolves bounded cons strings but rejects sliced metadata.
const flatUuid = () => Buffer.from(randomUUID(), 'utf8').toString('utf8');
export const cell = (row: number, column: number, version: number) =>
  `record-update:r${row}:f${column}:v${version}`;

function integer(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[`RECORD_UPDATE_PROFILE_${name}`] ?? fallback);
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `RECORD_UPDATE_PROFILE_${name} must be an integer in [${min}, ${max}]`
  );
  return value;
}

export function temporaryPath(input: string) {
  const path = resolve(input);
  const directory = realpathSync(dirname(path));
  const tmp = realpathSync('/tmp');
  const stat = statSync(directory);
  const uid = process.getuid?.();
  assert(uid !== undefined, 'Profile artifact protection requires POSIX file ownership');
  assert(
    directory === tmp || directory.startsWith(`${tmp}${sep}`),
    'Profile artifacts must be under /tmp'
  );
  const tmpStat = directory === tmp ? stat : statSync(tmp);
  assert(
    (tmpStat.uid === 0 || tmpStat.uid === uid) &&
      ((tmpStat.mode & 0o022) === 0 || (tmpStat.mode & 0o1000) !== 0),
    'Temporary artifact directory must be trusted and protect entries from replacement'
  );
  if (directory !== tmp) {
    assert(dirname(directory) === tmp, 'Artifact subdirectory must be directly under /tmp');
    assert(stat.uid === uid, 'Artifact directory must be owned by the current user');
    assert(
      (stat.mode & 0o077) === 0,
      'Artifact directory must be owner-only (mode 0700) to prevent pathname replacement'
    );
  }
  return join(directory, path.slice(path.lastIndexOf(sep) + 1));
}

function validateSnapshotStages(stages: Set<string>, mode: string, recordsUndo: boolean) {
  const available: Record<string, true> = {
    beforeCommand: true,
    loaded: true,
    batchPrepared: true,
    prepared: true,
    persisted: true,
    eventsBuilt: true,
    resultBuilt: true,
    undoReady: true,
    undoAppended: true,
    commandReturned: true,
    sinkCleared: true,
    outputReleased: true,
    outputReleasedUndoHeld: true,
    undoCleared: true,
  };
  assert(stages.size <= 6, 'At most six owned PostgreSQL snapshots are allowed per process');
  assert(!stages.size || mode === 'retention', 'Snapshots require retention mode');
  for (const stage of stages) {
    assert(Object.hasOwn(available, stage), `Unknown snapshot stage: ${stage}`);
    if (['outputReleasedUndoHeld', 'undoCleared'].includes(stage)) {
      assert(recordsUndo, `${stage} requires normal stack mode and UNDO=1`);
    }
    if (stage === 'outputReleased') assert(!recordsUndo, 'Use outputReleasedUndoHeld with UNDO=1');
  }
}

export function readOptions(): ProfileOptions {
  const mode = process.env.RECORD_UPDATE_PROFILE_MODE ?? 'baseline';
  assert(
    ['baseline', 'retention', 'boundary'].includes(mode),
    'RECORD_UPDATE_PROFILE_MODE must be baseline, retention, or boundary'
  );
  const rows = integer('ROWS', 500, 1, 10_000);
  const fields = integer('FIELDS', 8, 1, 500);
  const updatedFields = integer('UPDATED_FIELDS', 1, 1, 500);
  assert(
    updatedFields <= fields && rows * fields <= 1_000_000,
    'Require UPDATED_FIELDS <= FIELDS and at most 1,000,000 fixture cells'
  );
  const undo = process.env.RECORD_UPDATE_PROFILE_UNDO;
  assert(
    undo === undefined || undo === '0' || undo === '1',
    'RECORD_UPDATE_PROFILE_UNDO must be 0 or 1'
  );
  const stackMode = process.env.RECORD_UPDATE_PROFILE_STACK_MODE ?? 'normal';
  assert(
    ['normal', 'undo', 'redo'].includes(stackMode),
    'RECORD_UPDATE_PROFILE_STACK_MODE must be normal, undo, or redo'
  );
  const snapshotStages = new Set(
    (process.env.RECORD_UPDATE_PROFILE_SNAPSHOT_STAGES ?? '')
      .split(',')
      .map((stage) => stage.trim())
      .filter(Boolean)
  );
  validateSnapshotStages(snapshotStages, mode, undo === '1' && stackMode === 'normal');
  const inherited = [
    'DATABASE_URL',
    'PRISMA_DATABASE_URL',
    'PRISMA_META_DATABASE_URL',
    'TEABLE_V2_TEST_DATABASE_URL',
  ].filter((name) => process.env[name]);
  assert(!inherited.length, `Refusing inherited database configuration: ${inherited.join(', ')}`);
  assert(
    mode === 'baseline' || typeof global.gc === 'function',
    'Retention/boundary modes require Node --expose-gc'
  );
  return {
    mode: mode as ProfileMode,
    rows,
    fields,
    updatedFields,
    rounds: integer('ROUNDS', 3, 1, 20),
    warmups: integer('WARMUPS', 3, 0, 20),
    undoEnabled: undo === '1',
    stackMode: stackMode as ProfileStackMode,
    snapshotStages,
  };
}

// Claim once with O_EXCL; subsequent writes touch only our owned descriptor, never an existing report.
export function createReportWriter() {
  assert(
    process.env.RECORD_UPDATE_PROFILE_REPORT,
    'RECORD_UPDATE_PROFILE_REPORT=/tmp/...json is required'
  );
  const path = temporaryPath(process.env.RECORD_UPDATE_PROFILE_REPORT);
  const fd = openSync(path, 'wx', 0o600);
  return {
    path,
    write(report: Record<string, unknown>) {
      const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
      ftruncateSync(fd, 0);
      let position = 0;
      while (position < bytes.length)
        position += writeSync(fd, bytes, position, bytes.length - position, position);
    },
    close() {
      closeSync(fd);
    },
  };
}

function walk(directory: string, files: string[]) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
}

export function sourceProvenance(mode: ProfileMode) {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  assert(
    realpathSync(git(root, 'rev-parse', '--show-toplevel')) === root,
    'Unexpected checkout root'
  );
  const files: string[] = [];
  walk('community/packages/v2/core/src', files);
  walk('community/packages/v2/container-node-test/src', files);
  files.push(
    'pnpm-lock.yaml',
    'community/packages/v2/benchmark-node/package.json',
    'community/packages/v2/benchmark-node/vitest-record-update-profile.config.ts',
    'community/packages/v2/benchmark-node/src/record-update-retention.profile.ts',
    'community/packages/v2/benchmark-node/src/retention/profileRuntime.ts',
    'community/packages/v2/benchmark-node/src/retention/observeBulkUpdate.ts'
  );
  files.sort();
  const sourceSha256 = Object.fromEntries(
    files.map((file) => [file, sha256(readFileSync(join(root, file)))])
  );
  const original = readFileSync(join(root, servicePath), 'utf8');
  const instrumented = mode === 'retention' ? instrumentBulkUpdateSource(original) : undefined;
  return {
    checkout: root,
    rootHead: git(root, 'rev-parse', 'HEAD'),
    communityHead: git(join(root, 'community'), 'rev-parse', 'HEAD'),
    sourceSha256,
    sourceGraphSha256: sha256(JSON.stringify(sourceSha256)),
    observation: {
      enabled: mode === 'retention',
      inputServiceSha256: sha256(original),
      effectiveServiceSha256: sha256(instrumented?.code ?? original),
      checkpoints: instrumented?.checkpoints ?? [],
    },
    identity:
      'package command/Table/bulk-service/container-factory === direct checkout source; DI prototype asserted',
  };
}

export function fixtureSha256(options: ProfileOptions) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      rows: options.rows,
      fields: options.fields,
      updatedFields: options.updatedFields,
      type: 'singleLineText',
      key: 'id',
      order: null,
    })
  );
  for (let row = 0; row < options.rows; row += 1) {
    for (let column = 0; column < options.fields; column += 1)
      hash.update(`${cell(row, column, 0)}\n`);
  }
  return hash.digest('hex');
}

type Phase = {
  count: number;
  totalMs: number;
  maxMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  numeric: Record<string, { last: number; max: number; sum: number }>;
};
function addNumeric(target: Record<string, number>, attributes: SpanAttributes) {
  for (const [key, value] of Object.entries(attributes))
    if (typeof value === 'number') target[key] = value;
}
function aggregatePhase(
  phase: Phase,
  elapsed: number,
  cpu: NodeJS.CpuUsage,
  numeric: Record<string, number>
) {
  phase.count += 1;
  phase.totalMs += elapsed;
  phase.maxMs = Math.max(phase.maxMs, elapsed);
  phase.cpuUserMs += cpu.user / 1000;
  phase.cpuSystemMs += cpu.system / 1000;
  for (const [key, value] of Object.entries(numeric)) {
    const item = (phase.numeric[key] ??= { last: value, max: value, sum: 0 });
    item.last = value;
    item.max = Math.max(item.max, value);
    item.sum += value;
  }
}
export class PhaseTracer implements ITracer {
  private readonly active = new AsyncLocalStorage<ISpan>();
  phases: Record<string, Phase> = {};
  batches: Array<{ index: number; size: number }> = [];
  startSpan(name: string, attributes: SpanAttributes = {}): ISpan {
    const start = performance.now();
    const cpuStart = process.cpuUsage();
    const numeric: Record<string, number> = {};
    addNumeric(numeric, attributes);
    let ended = false;
    return {
      setAttribute: (key, value) => addNumeric(numeric, { [key]: value }),
      setAttributes: (attrs) => addNumeric(numeric, attrs),
      recordError: () => {
        numeric['observer.errorCount'] = (numeric['observer.errorCount'] ?? 0) + 1;
      },
      end: () => {
        if (ended) return;
        ended = true;
        const elapsed = performance.now() - start;
        const cpu = process.cpuUsage(cpuStart);
        const phase = (this.phases[name] ??= {
          count: 0,
          totalMs: 0,
          maxMs: 0,
          cpuUserMs: 0,
          cpuSystemMs: 0,
          numeric: {},
        });
        aggregatePhase(phase, elapsed, cpu, numeric);
        if (name === 'teable.RecordBulkUpdateService.resolveUpdateBatch') {
          this.batches.push({
            index: numeric['record.update.batchIndex'],
            size: numeric['record.update.batchInputSize'],
          });
        }
      },
    };
  }
  withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    return this.active.run(span, callback);
  }
  getActiveSpan() {
    return this.active.getStore();
  }
  reset() {
    this.phases = {};
    this.batches = [];
  }
  dispose() {
    this.active.disable();
    this.reset();
  }
}

function summarizeGroups(roots: Roots): CheckpointSample['groups'] {
  return Object.fromEntries(
    Object.entries(roots).map(([key, value]) => {
      if (Array.isArray(value)) return [key, { kind: 'Array', size: value.length }];
      if (value instanceof Map) return [key, { kind: 'Map', size: value.size }];
      if (value instanceof Set) return [key, { kind: 'Set', size: value.size }];
      return [key, { kind: value === null ? 'null' : typeof value }];
    })
  );
}
function primitiveCounters(counters: Record<string, unknown>): Record<string, Primitive> {
  return Object.fromEntries(
    Object.entries(counters).filter(
      ([, value]) => value === null || ['number', 'boolean', 'string'].includes(typeof value)
    )
  ) as Record<string, Primitive>;
}

type GcEntry = { startTime: number; duration: number; kind: number | null };
function summarizeGc(entry: PerformanceEntry): GcEntry {
  const detail = 'detail' in entry ? entry.detail : undefined;
  const kind =
    detail && typeof detail === 'object' && 'kind' in detail && typeof detail.kind === 'number'
      ? detail.kind
      : null;
  return { startTime: entry.startTime, duration: entry.duration, kind };
}

export class ProfileObserver {
  readonly isolateId = flatUuid();
  readonly snapshots: Array<{
    stage: string;
    isolateId: string;
    snapshotId: string;
    path: string;
  }> = [];
  samples: CheckpointSample[] = [];
  private readonly seen = new Set<string>();
  private gcEntries: GcEntry[] = [];
  private readonly observer = new PerformanceObserver((list) => this.recordGc(list.getEntries()));
  private active = false;
  private round = -1;
  private start = 0;
  constructor(
    private readonly options: ProfileOptions,
    private readonly output: string
  ) {
    assert(
      !globals.__TEABLE_RECORD_UPDATE_RETENTION__ &&
        !globals.__TEABLE_RECORD_UPDATE_RETENTION_ROOTS__,
      'Another record-update retention observer is installed'
    );
    this.observer.observe({ entryTypes: ['gc'] });
    if (options.mode === 'retention') globals.__TEABLE_RECORD_UPDATE_RETENTION__ = this.checkpoint;
  }
  begin(round: number) {
    this.active = true;
    this.round = round;
    this.samples = [];
    this.observer.takeRecords();
    this.gcEntries = [];
    this.start = performance.now();
  }
  end() {
    this.active = false;
  }
  private recordGc(entries: PerformanceEntry[]) {
    this.gcEntries.push(...entries.map(summarizeGc));
  }
  operationGc(start: number, end: number) {
    this.recordGc(this.observer.takeRecords());
    const entries = this.gcEntries.filter(
      (entry) => entry.startTime >= start && entry.startTime < end
    );
    return { entries, observedPauseMs: entries.reduce((sum, entry) => sum + entry.duration, 0) };
  }
  private snapshot(stage: string, roots: Roots, sample: CheckpointSample) {
    if (this.round !== 0 || !this.options.snapshotStages.has(stage) || this.seen.has(stage)) return;
    assert(this.snapshots.length < 6, 'Snapshot budget exceeded');
    const snapshotId = flatUuid();
    const path = temporaryPath(`${this.output}.${stage.replace(/[^\w-]/g, '_')}.heapsnapshot`);
    closeSync(openSync(path, 'wx', 0o600));
    globals.__TEABLE_RECORD_UPDATE_RETENTION_ROOTS__ = {
      stage,
      groups: roots,
      isolateId: this.isolateId,
      snapshotId,
    };
    const start = performance.now();
    try {
      sample.snapshot = writeHeapSnapshot(path);
      sample.snapshotId = snapshotId;
      this.snapshots.push({ stage, isolateId: this.isolateId, snapshotId, path: sample.snapshot });
      this.seen.add(stage);
    } finally {
      delete globals.__TEABLE_RECORD_UPDATE_RETENTION_ROOTS__;
      sample.snapshotMs = performance.now() - start;
    }
  }
  checkpoint = (stage: string, roots: Roots = {}, counters: Record<string, unknown> = {}) => {
    if (!this.active) return;
    const start = performance.now();
    const sample: CheckpointSample = {
      stage,
      atMs: start - this.start,
      memory: process.memoryUsage(),
      gcMs: 0,
      snapshotMs: 0,
      checkpointMs: 0,
      counters: primitiveCounters(counters),
      groups: summarizeGroups(roots),
    };
    if (this.options.mode === 'retention') {
      const gcStart = performance.now();
      global.gc!();
      sample.gcMs = performance.now() - gcStart;
      sample.afterGc = process.memoryUsage();
      this.snapshot(stage, roots, sample);
    }
    sample.checkpointMs = performance.now() - start;
    this.samples.push(sample);
  };
  boundaryGc() {
    if (this.options.mode !== 'boundary') return undefined;
    const before = process.memoryUsage();
    const start = performance.now();
    global.gc!();
    return { before, after: process.memoryUsage(), gcMs: performance.now() - start };
  }
  intrusive(start: number, end: number) {
    return this.samples
      .filter((sample) => sample.atMs >= start - this.start && sample.atMs < end - this.start)
      .reduce(
        (sum, sample) => ({
          gcMs: sum.gcMs + sample.gcMs,
          snapshotMs: sum.snapshotMs + sample.snapshotMs,
          checkpointMs: sum.checkpointMs + sample.checkpointMs,
        }),
        { gcMs: 0, snapshotMs: 0, checkpointMs: 0 }
      );
  }
  assertCommandObservation() {
    if (this.options.mode !== 'retention') return;
    const required = [
      'loaded',
      'batchPrepared',
      'prepared',
      'persisted',
      'eventsBuilt',
      'resultBuilt',
      'undoReady',
      'undoAppended',
    ];
    const observed = new Set(this.samples.map((sample) => sample.stage));
    const missing = required.filter((stage) => !observed.has(stage));
    assert(!missing.length, `Retention service callbacks were not observed: ${missing.join(', ')}`);
  }
  assertSnapshotsObserved() {
    const missing = [...this.options.snapshotStages].filter((stage) => !this.seen.has(stage));
    assert(
      !missing.length,
      `Snapshot stages not observed during measured round 0: ${missing.join(', ')}`
    );
  }
  dispose() {
    this.active = false;
    this.observer.disconnect();
    delete globals.__TEABLE_RECORD_UPDATE_RETENTION__;
    delete globals.__TEABLE_RECORD_UPDATE_RETENTION_ROOTS__;
  }
}

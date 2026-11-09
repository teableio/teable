import { strictEqual, ok as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordsCommand,
  CreateTableCommand,
  MemoryUndoRedoStore,
  RecordBulkUpdateService,
  RecordsBatchUpdated,
  RecordUpdated,
  Table,
  TableRecord,
  UpdateRecordsCommand,
  flattenUndoRedoCommands,
  recordToFieldValues,
  v2CoreTokens,
  type CreateRecordsResult,
  type CreateTableResult,
  type ICommandBus,
  type IDomainEvent,
  type IExecutionContext,
  type UpdateRecordsResult,
} from '@teable/v2-core';
import { it } from 'vitest';

import { createV2NodeTestContainer as sourceContainerFactory } from '../../container-node-test/src/index';
import { RecordBulkUpdateService as SourceBulkService } from '../../core/src/application/services/RecordBulkUpdateService';
import { UpdateRecordsCommand as SourceUpdateCommand } from '../../core/src/commands/UpdateRecordsCommand';
import { calculateBatchSize } from '../../core/src/domain/table/methods/records/calculateBatchSize';
import { TableRecord as SourceTableRecord } from '../../core/src/domain/table/records/TableRecord';
import { Table as SourceTable } from '../../core/src/domain/table/Table';
import { benchmarkTableDataSafetyLimits } from './benchmarkTableDataSafetyLimits';
import {
  PhaseTracer,
  ProfileObserver,
  cell,
  createReportWriter,
  fixtureSha256,
  readOptions,
  sha256,
  sourceProvenance,
  type ProfileOptions,
} from './retention/profileRuntime';

type StartedPg = { getConnectionUri(): string; stop(): Promise<unknown> };
type PgBuilder = {
  start(): Promise<StartedPg>;
  withDatabase(value: string): PgBuilder;
  withUsername(value: string): PgBuilder;
  withPassword(value: string): PgBuilder;
};
type Resources = {
  pg?: StartedPg;
  test?: IV2NodeTestContainer;
  restoreLogs?: () => void;
};
type Fixture = {
  test: IV2NodeTestContainer;
  bus: ICommandBus;
  actorId: ActorId;
  table: Table;
  fieldIds: string[];
  columns: string[];
  tableName: string;
  ids: string[];
  indices: Map<string, number>;
  eventSink: IDomainEvent[];
  undoStore: MemoryUndoRedoStore;
  logCount: { value: number };
};
const undoWindow = 'record-update-profile-window';

function assertSourceIdentity() {
  strictEqual(UpdateRecordsCommand, SourceUpdateCommand);
  strictEqual(Table, SourceTable);
  strictEqual(RecordBulkUpdateService, SourceBulkService);
  strictEqual(TableRecord, SourceTableRecord);
  strictEqual(createV2NodeTestContainer, sourceContainerFactory);
}

function countRecordFactoryCalls() {
  const original = SourceTableRecord.fromRawFieldValues;
  const target = SourceTableRecord as unknown as {
    fromRawFieldValues: typeof original;
  };
  let calls = 0;
  target.fromRawFieldValues = (...args) => {
    calls += 1;
    return original(...args);
  };
  return {
    get calls() {
      return calls;
    },
    restore() {
      target.fromRawFieldValues = original;
    },
  };
}

function countFixtureLogs(test: IV2NodeTestContainer, resources: Resources) {
  const logger = test.spyLogger;
  const originalCapture = logger.capture;
  const count = { value: 0 };
  logger.clear();
  logger.capture = () => {
    count.value += 1;
  };
  resources.restoreLogs = () => {
    logger.capture = originalCapture;
    logger.clear();
  };
  return count;
}

async function startDatabase(resources: Resources) {
  // Resolve the existing dependency from its owner; this harness never accepts a caller's DSN.
  const pgModule = createRequire(
    new URL('../../container-node-test/package.json', import.meta.url)
  )('@testcontainers/postgresql');
  assert(
    pgModule && typeof pgModule.PostgreSqlContainer === 'function',
    'Missing PostgreSQL testcontainer dependency'
  );
  const Pg: new (image: string) => PgBuilder = pgModule.PostgreSqlContainer;
  resources.pg = await new Pg(process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine')
    .withDatabase('record_update_profile')
    .withUsername('teable')
    .withPassword('teable')
    .start();
  resources.test = await createV2NodeTestContainer({
    connectionString: resources.pg.getConnectionUri(),
    tableDataSafetyLimits: benchmarkTableDataSafetyLimits,
    logLevel: 'silent',
  });
  assert(/^postgres(?:ql)?:/.test(resources.test.connectionString), 'Requires real PostgreSQL');
  return resources.test;
}

async function seedRecords(
  bus: ICommandBus,
  context: IExecutionContext,
  table: Table,
  fieldIds: string[],
  rows: number
) {
  const ids: string[] = [];
  for (let start = 0; start < rows; start += 250) {
    const count = Math.min(250, rows - start);
    const command = CreateRecordsCommand.create({
      tableId: table.id().toString(),
      fieldKeyType: 'id',
      records: Array.from({ length: count }, (_, index) => ({
        fields: Object.fromEntries(
          fieldIds.map((id, column) => [id, cell(start + index, column, 0)])
        ),
      })),
    })._unsafeUnwrap();
    const seeded = (
      await bus.execute<CreateRecordsCommand, CreateRecordsResult>(context, command)
    )._unsafeUnwrap();
    strictEqual(seeded.records.length, count);
    for (const record of seeded.records) ids.push(record.id().toString());
  }
  strictEqual(new Set(ids).size, rows);
  return ids;
}

async function createFixture(options: ProfileOptions, resources: Resources): Promise<Fixture> {
  const test = await startDatabase(resources);
  const logCount = countFixtureLogs(test, resources);
  const undoStore = new MemoryUndoRedoStore();
  test.container.registerInstance(v2CoreTokens.undoRedoStore, undoStore);
  strictEqual(
    Object.getPrototypeOf(test.container.resolve(v2CoreTokens.recordBulkUpdateService)),
    SourceBulkService.prototype
  );
  const bus = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const actorId = ActorId.create('system')._unsafeUnwrap();
  const setupContext: IExecutionContext = { actorId };
  const command = CreateTableCommand.create({
    baseId: test.baseId.toString(),
    name: 'Explicit record update profile',
    fields: Array.from({ length: options.fields }, (_, index) => ({
      name: `F${index}`,
      type: 'singleLineText',
      ...(index === 0 ? { isPrimary: true } : {}),
    })),
    views: [{ type: 'grid' }],
  })._unsafeUnwrap();
  const { table } = (
    await bus.execute<CreateTableCommand, CreateTableResult>(setupContext, command)
  )._unsafeUnwrap();
  strictEqual(Object.getPrototypeOf(table), SourceTable.prototype);
  const fieldIds = table.getFields().map((field) => field.id().toString());
  strictEqual(fieldIds.length, options.fields);
  const ids = await seedRecords(bus, setupContext, table, fieldIds, options.rows);
  const eventSink: IDomainEvent[] = Reflect.get(test.eventBus, 'publishedEvents');
  assert(Array.isArray(eventSink), 'Fixture MemoryEventBus storage changed');
  clearUndo(undoStore);
  return {
    test,
    bus,
    actorId,
    table,
    fieldIds,
    ids,
    eventSink,
    undoStore,
    logCount,
    indices: new Map(ids.map((id, index) => [id, index])),
    columns: table
      .getFields()
      .map((field) => field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap()),
    tableName: table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap(),
  };
}

// Helpers return primitives only. Their record/event/entry locals must leave the stack before late snapshots.
function verifyOutput(
  result: UpdateRecordsResult,
  fixture: Fixture,
  options: ProfileOptions,
  version: number
) {
  strictEqual(result.updatedCount, options.rows);
  strictEqual(result.records?.length, options.rows);
  const digest = createHash('sha256');
  const seen = new Set<string>();
  for (const record of result.records!) {
    const id = record.id().toString();
    const row = fixture.indices.get(id);
    assert(row !== undefined && !seen.has(id), 'Unexpected/duplicate response record');
    seen.add(id);
    const values = new Map(
      recordToFieldValues(record).map(({ fieldId, value }) => [fieldId, value])
    );
    strictEqual(values.size, options.fields, 'Full-width response contract changed');
    for (let column = 0; column < options.fields; column += 1) {
      const value = values.get(fixture.fieldIds[column]);
      strictEqual(value, cell(row, column, column < options.updatedFields ? version : 0));
      digest.update(`${row}:${column}:${String(value)}\n`);
    }
  }
  return {
    returnedRows: options.rows,
    returnedCells: options.rows * options.fields,
    returnedSha256: digest.digest('hex'),
  };
}

async function verifyDb(fixture: Fixture, options: ProfileOptions, version: number) {
  const db = fixture.test.dataDb as unknown as {
    selectFrom(name: string): {
      selectAll(): { execute(): Promise<Array<Record<string, unknown>>> };
    };
  };
  const after = await db.selectFrom(fixture.tableName).selectAll().execute();
  strictEqual(after.length, options.rows);
  after.sort((a, b) => fixture.indices.get(String(a.__id))! - fixture.indices.get(String(b.__id))!);
  const seen = new Set<string>();
  const digest = createHash('sha256');
  for (const row of after) {
    const id = String(row.__id);
    const index = fixture.indices.get(id);
    assert(index !== undefined && !seen.has(id), 'Unexpected/duplicate persisted record');
    seen.add(id);
    for (let column = 0; column < options.fields; column += 1) {
      const expected = cell(index, column, column < options.updatedFields ? version : 0);
      strictEqual(row[fixture.columns[column]], expected);
      digest.update(`${expected}\n`);
    }
  }
  return { rows: after.length, cells: after.length * options.fields, sha256: digest.digest('hex') };
}

function inspectEvents(events: IDomainEvent[], options: ProfileOptions) {
  const counts = {
    events: events.length,
    singleRows: 0,
    batchRows: 0,
    singleChanges: 0,
    batchChanges: 0,
  };
  for (const event of events) {
    if (event instanceof RecordUpdated) {
      counts.singleRows += 1;
      counts.singleChanges += event.changes.length;
    }
    if (event instanceof RecordsBatchUpdated) {
      counts.batchRows += event.updates.length;
      for (const update of event.updates) counts.batchChanges += update.changes.length;
    }
  }
  assert(counts.singleRows || counts.batchRows, 'No actual update events');
  for (const kind of ['single', 'batch'] as const) {
    if (!counts[`${kind}Rows`]) continue;
    strictEqual(counts[`${kind}Rows`], options.rows);
    strictEqual(counts[`${kind}Changes`], options.rows * options.updatedFields);
  }
  return counts;
}

async function inspectUndo(fixture: Fixture, options: ProfileOptions) {
  const summary = {
    states: Reflect.get(fixture.undoStore, 'states').size as number,
    entries: 0,
    undoRows: 0,
    redoRows: 0,
  };
  // list() creates state even on reads. Replay must remain empty even with a window.
  if (!options.undoEnabled || options.stackMode !== 'normal') {
    strictEqual(summary.states, 0);
    return summary;
  }
  strictEqual(summary.states, 1);
  const entries = (
    await fixture.undoStore.list({
      actorId: fixture.actorId,
      tableId: fixture.table.id(),
      windowId: undoWindow,
    })
  )._unsafeUnwrap();
  summary.entries = entries.length;
  for (const entry of entries) {
    for (const [side, value] of [
      ['undoRows', entry.undoCommand],
      ['redoRows', entry.redoCommand],
    ] as const) {
      for (const leaf of flattenUndoRedoCommands(value)) {
        if (leaf.type === 'UpdateRecords') summary[side] += leaf.payload.records.length;
        else if (leaf.type === 'UpdateRecord') summary[side] += 1;
      }
    }
  }
  strictEqual(summary.entries, 1);
  strictEqual(summary.undoRows, options.rows);
  strictEqual(summary.redoRows, options.rows);
  return summary;
}

function clearUndo(store: MemoryUndoRedoStore) {
  assert(
    Reflect.get(store, 'states') instanceof Map,
    'Fixture MemoryUndoRedoStore storage changed'
  );
  Reflect.get(store, 'states').clear();
}
function clearSinks(fixture: Fixture) {
  fixture.eventSink.length = 0;
  fixture.test.clearLogs();
}
function makeCommand(fixture: Fixture, options: ProfileOptions, version: number) {
  const updatedFieldIds = fixture.fieldIds.slice(0, options.updatedFields);
  const command = UpdateRecordsCommand.create({
    tableId: fixture.table.id().toString(),
    fieldKeyType: 'id',
    typecast: false,
    records: fixture.ids.map((id, index) => ({
      id,
      fields: Object.fromEntries(
        updatedFieldIds.map((fieldId, column) => [fieldId, cell(index, column, version)])
      ),
    })),
  })._unsafeUnwrap();
  strictEqual(Object.getPrototypeOf(command), SourceUpdateCommand.prototype);
  return command;
}
function batchSummary(tracer: PhaseTracer, options: ProfileOptions) {
  const batches = tracer.batches;
  assert(
    batches.length > 0 && batches.every((batch) => Number.isInteger(batch.size) && batch.size > 0),
    'Missing actual batch tracing'
  );
  strictEqual(
    batches.reduce((sum, batch) => sum + batch.size, 0),
    options.rows
  );
  return {
    batches,
    batchCapacity: calculateBatchSize(options.fields, { maxBatchSize: 1000 }),
    actualN: options.rows,
    actualB: Math.max(...batches.map((batch) => batch.size)),
    actualBatchCount: batches.length,
  };
}

async function runRound(
  fixture: Fixture,
  options: ProfileOptions,
  tracer: PhaseTracer,
  observer: ProfileObserver,
  countRecordFactories: boolean,
  iteration: number,
  profile: Record<string, unknown>
) {
  const version = iteration + 1;
  const round = iteration - options.warmups;
  const recordsUndo = options.undoEnabled && options.stackMode === 'normal';
  const context: IExecutionContext = {
    actorId: fixture.actorId,
    tracer,
    requestId: `record-update-profile-${version}`,
    ...(options.undoEnabled ? { windowId: undoWindow } : {}),
    ...(options.stackMode !== 'normal' ? { undoRedo: { mode: options.stackMode } } : {}),
  };
  let command: UpdateRecordsCommand | undefined = makeCommand(fixture, options, version);
  let result: UpdateRecordsResult | undefined;
  tracer.reset();
  clearSinks(fixture);
  fixture.logCount.value = 0;
  observer.begin(round);
  profile.round = round;
  profile.version = version;
  profile.status = 'running';
  profile.checkpoints = observer.samples;
  profile.boundaryBefore = observer.boundaryGc();
  observer.checkpoint('beforeCommand', { command });
  const rssSamples: Array<{ atMs: number; rss: number }> = [];
  const timerStart = performance.now();
  const timer = setInterval(
    () => rssSamples.push({ atMs: performance.now() - timerStart, rss: process.memoryUsage().rss }),
    5
  );
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const recordFactoryCounter = countRecordFactories ? countRecordFactoryCalls() : undefined;
  const start = performance.now();
  let wallMs: number;
  let cpu: NodeJS.CpuUsage;
  let memoryAfter: NodeJS.MemoryUsage;
  try {
    result = (
      await fixture.bus.execute<UpdateRecordsCommand, UpdateRecordsResult>(context, command)
    )._unsafeUnwrap();
  } finally {
    recordFactoryCounter?.restore();
    wallMs = performance.now() - start;
    cpu = process.cpuUsage(cpuBefore);
    memoryAfter = process.memoryUsage();
    clearInterval(timer);
    Object.assign(profile, {
      wallMs,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      memoryBefore,
      memoryAfter,
      rssSamples,
      phases: tracer.phases,
      fixtureLogCaptureCount: fixture.logCount.value,
      ...(recordFactoryCounter ? { recordFactoryCalls: recordFactoryCounter.calls } : {}),
      resourceUsageMaxRSSKiB: process.resourceUsage().maxRSS,
    });
  }
  const end = start + wallMs;
  profile.boundaryAfter = observer.boundaryGc();
  observer.checkpoint('commandReturned', {
    command,
    result,
    eventSink: fixture.eventSink,
    ...(recordsUndo ? { undoStore: fixture.undoStore } : {}),
  });
  await nextTurn();
  observer.assertCommandObservation();
  profile.gc = observer.operationGc(start, end);
  profile.intrusiveInsideCommand = observer.intrusive(start, end);
  profile.rssSampledMax = Math.max(
    memoryBefore.rss,
    memoryAfter.rss,
    ...rssSamples.map((sample) => sample.rss)
  );
  const output = verifyOutput(result, fixture, options, version);
  const db = await verifyDb(fixture, options, version);
  const events = inspectEvents(fixture.eventSink, options);
  const undo = await inspectUndo(fixture, options);
  Object.assign(profile, batchSummary(tracer, options), {
    verified: { ...output, db, events, undo },
  });
  clearSinks(fixture);
  observer.checkpoint('sinkCleared', {
    command,
    result,
    ...(recordsUndo ? { undoStore: fixture.undoStore } : {}),
  });
  result = undefined;
  command = undefined;
  await nextTurn();
  observer.checkpoint(
    recordsUndo ? 'outputReleasedUndoHeld' : 'outputReleased',
    recordsUndo ? { undoStore: fixture.undoStore } : {}
  );
  await nextTurn();
  if (options.mode === 'boundary') {
    profile.boundaryReleasedUndoHeld = observer.boundaryGc();
  }
  clearUndo(fixture.undoStore);
  await nextTurn();
  if (options.mode === 'boundary' && recordsUndo) {
    profile.boundaryUndoCleared = observer.boundaryGc();
  }
  if (recordsUndo) observer.checkpoint('undoCleared');
  observer.end();
  profile.status = 'complete';
}

const boundaries = {
  entry:
    'Real UpdateRecordsCommand and DI service with owned PostgreSQL. Explicit records[] only, no query-based update. Input construction, setup and all output/database/event/undo verification are outside execute wall/CPU.',
  plugins:
    'Testcontainer host plugin set only. No host Nest permissions, production actor, HTTP, serialization or permission-overhead extrapolation.',
  timing:
    'Command wall and Node process CPU cover execute only; CPU excludes PostgreSQL CPU. Phase wall and cpuUserMs/cpuSystemMs deltas are inclusive, nested and process-wide, not additive or exclusive; unrelated Node activity and diagnostic GC/snapshots are included and CPU can exceed wall. Never subtract CPU from wall to infer DB time. Retention checkpoint/GC/snapshot time is intrusive and not API latency. Baseline has no explicit GC. Boundary mode has no AST callback and forces GC outside execute wall; GC cost is reported separately.',
  memory:
    'Baseline checkpoint heap/RSS is raw occupancy, not retained size. Forced-GC boundaries distinguish collectible occupancy from remaining retention, not allocation totals or proof of leaks. The 5ms RSS sampler misses synchronous peaks and is a lower bound. resourceUsage.maxRSS is process-lifetime high water in KiB, including setup/warmups/verification, not an operation peak. No forced computed/outbox drain.',
  sinks:
    'Fixture SpyLogger.capture counts calls without retaining SQL/params/context before business seeding. Real fixture MemoryEventBus retains command events until sinkCleared; this is a test sink, not a production consumer. MemoryUndoRedoStore is a fixture, not production Keyv/network serialization. Summaries retain primitives only; fixture sinks are cleared only outside execute.',
  factoryCounting:
    'RECORD_UPDATE_PROFILE_COUNT_FACTORIES=1 opts into a diagnostic wrapper around TableRecord.fromRawFieldValues only during bus.execute; it is restored in finally before verification. recordFactoryCalls counts all raw-record factory calls in that command, including permission/plugin work, not response-only materializations. Default baseline and boundary runs leave the factory unwrapped; counted timing/allocation results are diagnostic, not natural baseline measurements.',
  responseRetention:
    'Intrusive roots follow the profiled source: responseFieldsByRecord holds owned raw response fields before final TableRecord materialization; the prior-source updatedRecordMap root holds TableRecord instances. resultBuilt observes final materialized records. Response roots are distinct from mutation, event and undo payloads. Checkpoint samples report whole-process occupancy, not the size of an individual root.',
};

function safeError(error: unknown) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted database URL]');
}
async function cleanup(resources: Resources, report: Record<string, unknown>) {
  const errors: string[] = [];
  try {
    resources.restoreLogs?.();
  } catch (error) {
    errors.push(safeError(error));
  }
  try {
    await resources.test?.dispose();
  } catch (error) {
    errors.push(safeError(error));
  }
  try {
    await resources.pg?.stop();
  } catch (error) {
    errors.push(safeError(error));
  }
  if (errors.length) {
    report.status = 'failed';
    report.cleanupErrors = errors;
    throw new Error('Profile resource cleanup failed; see report cleanupErrors');
  }
}

async function run() {
  const writer = createReportWriter();
  const report: Record<string, unknown> = {
    formatVersion: 1,
    status: 'running',
    profiles: [],
    boundaries,
    node: process.version,
    cpu: cpus()[0]?.model,
    pid: process.pid,
  };
  const resources: Resources = {};
  const tracer = new PhaseTracer();
  let observer: ProfileObserver | undefined;
  try {
    writer.write(report);
    const options = readOptions();
    assertSourceIdentity();
    const countRecordFactories = process.env.RECORD_UPDATE_PROFILE_COUNT_FACTORIES === '1';
    const provenance = sourceProvenance(options.mode);
    observer = new ProfileObserver(options, writer.path);
    Object.assign(report, {
      mode: options.mode,
      countRecordFactories,
      provenance,
      isolateId: observer.isolateId,
      snapshots: observer.snapshots,
      fixtureSha256: fixtureSha256(options),
      scenario: {
        ...options,
        snapshotStages: [...options.snapshotStages],
        fieldKeyType: 'id',
        typecast: false,
        order: null,
        batchCapacity: calculateBatchSize(options.fields, { maxBatchSize: 1000 }),
        observedBMeaning:
          'actualB is largest traced batch, not configured capacity or seed batch size',
      },
    });
    const fixture = await createFixture(options, resources);
    report.database = {
      kind: 'owned isolated PostgreSQL testcontainer',
      version: (
        await fixture.test.dataDb
          .selectNoFrom((eb) => eb.fn<string>('version', []).as('version'))
          .executeTakeFirstOrThrow()
      ).version,
    };
    report.fixtureMappingSha256 = sha256(
      JSON.stringify({
        table: fixture.table.id().toString(),
        fieldIds: fixture.fieldIds,
        ids: fixture.ids,
      })
    );
    report.seedVerified = await verifyDb(fixture, options, 0);
    clearSinks(fixture);
    const profiles = report.profiles as Array<Record<string, unknown>>;
    for (let iteration = 0; iteration < options.warmups + options.rounds; iteration += 1) {
      const profile: Record<string, unknown> = {};
      if (iteration >= options.warmups) profiles.push(profile);
      await runRound(fixture, options, tracer, observer, countRecordFactories, iteration, profile);
      writer.write(report);
      if (iteration >= options.warmups)
        console.log(
          `record-update ${options.mode} r${profile.round} N=${options.rows} F=${options.fields} U=${options.updatedFields} B=${profile.actualB} batches=${profile.actualBatchCount} wall=${Number(profile.wallMs).toFixed(1)}ms`
        );
    }
    observer.assertSnapshotsObserved();
    report.status = 'complete';
  } catch (error) {
    report.status = 'failed';
    report.error = safeError(error);
    throw error;
  } finally {
    observer?.dispose();
    tracer.dispose();
    try {
      await cleanup(resources, report);
    } finally {
      try {
        writer.write(report);
      } finally {
        writer.close();
      }
    }
  }
}

it('profiles actual explicit record updates against owned PostgreSQL', run, 300_000);

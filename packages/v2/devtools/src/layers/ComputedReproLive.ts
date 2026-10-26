import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  registerV2PostgresDb,
  v2DataDbTokens as pgDataDbTokens,
  v2MetaDbTokens as pgMetaDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pglite';
import {
  CreateBaseCommand,
  CreateRecordsCommand,
  ImportDotTeaStructureCommand,
  v2CoreTokens,
  type IComputedUpdateDrainService,
  type ImportDotTeaStructureResult,
} from '@teable/v2-core';
import { Lifecycle, container as diContainer } from '@teable/v2-di';
import type { DependencyContainer } from '@teable/v2-di';
import { DotTeaParser } from '@teable/v2-dottea';
import { createHeadlessRuntime } from '@teable/v2-headless-runtime';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import { CliError } from '../errors/CliError';
import {
  deriveTrigger,
  loadDeadLetterFromDb,
  parseDeadLetterPayload,
  type ReproDeadLetter,
  type ReproTrigger,
} from '../repro/deadLetter';
import { createReproContext, executeReproCommand } from '../repro/execution';
import { captureFailure } from '../repro/failure';
import { applyColumnTypeDrift } from '../repro/fault';
import { generateMockRows } from '../repro/mockRows';
import { renderPgliteSpec } from '../repro/spec';
import {
  extractBaseStructure,
  sanitizeStructure,
  type ExtractedStructure,
  type ReproIdMap,
  type ReproStructure,
} from '../repro/structure';
import { readDotTeaStructure, writeDotTeaZip } from '../repro/tea';
import { applyTrigger } from '../repro/trigger';
import {
  ComputedRepro,
  type ComputedReproInput,
  type ComputedReproOutput,
} from '../services/ComputedRepro';

type SourceConnection = {
  metaDb: Kysely<V1TeableDatabase>;
  dataDb: Kysely<V1TeableDatabase>;
  close: () => Promise<void>;
};

const openReadOnlySource = async (connectionString: string): Promise<SourceConnection> => {
  const child = diContainer.createChildContainer();
  await registerV2PostgresDb(child, { pg: { connectionString } });
  const metaDb = child.resolve<Kysely<V1TeableDatabase>>(pgMetaDbTokens.db);
  const dataDb = child.resolve<Kysely<V1TeableDatabase>>(pgDataDbTokens.db);
  return {
    metaDb,
    dataDb,
    close: async () => {
      await Promise.all([metaDb.destroy(), dataDb.destroy()]);
    },
  };
};

const parseStructure = async (path: string): Promise<ReproStructure> => {
  let raw: unknown;
  if (path.endsWith('.json')) {
    raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
  } else {
    raw = await readDotTeaStructure({ type: 'path', path });
  }
  const record = raw as { tables?: unknown } | null;
  if (!record || !Array.isArray(record.tables)) {
    throw new Error(`Structure has no tables array: ${path}`);
  }
  return raw as ReproStructure;
};

const parseRowSample = (raw: unknown): Record<string, Array<Record<string, unknown>>> => {
  const record = raw as { tables?: unknown } | null;
  const tables = record && typeof record === 'object' && record.tables ? record.tables : raw;
  if (!tables || typeof tables !== 'object') {
    throw new Error('Row sample must be an object keyed by table id');
  }
  const result: Record<string, Array<Record<string, unknown>>> = {};
  for (const [tableId, rows] of Object.entries(tables as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    result[tableId] = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return undefined;
        const rowRecord = row as Record<string, unknown>;
        const fields = rowRecord.fields ?? rowRecord;
        return typeof fields === 'object' && fields
          ? (fields as Record<string, unknown>)
          : undefined;
      })
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }
  return result;
};

const importStructure = async (
  container: DependencyContainer,
  baseId: string,
  bytes: Uint8Array
): Promise<ImportDotTeaStructureResult> => {
  if (!container.isRegistered(v2CoreTokens.dotTeaParser)) {
    container.register(v2CoreTokens.dotTeaParser, DotTeaParser, {
      lifecycle: Lifecycle.Singleton,
    });
  }
  const commandResult = ImportDotTeaStructureCommand.createFromBuffer({
    baseId,
    dotTeaData: bytes,
  });
  if (commandResult.isErr()) throw commandResult.error;
  return executeReproCommand<ImportDotTeaStructureCommand, ImportDotTeaStructureResult>(
    container,
    commandResult.value
  );
};

const createBase = async (container: DependencyContainer): Promise<string> => {
  const commandResult = CreateBaseCommand.create({ name: 'Repro Base' });
  if (commandResult.isErr()) throw commandResult.error;
  const result = await executeReproCommand<
    CreateBaseCommand,
    { base: { id: () => { toString: () => string } } }
  >(container, commandResult.value);
  return result.base.id().toString();
};

const insertRowSamples = async (
  container: DependencyContainer,
  rows: Record<string, Array<Record<string, unknown>>>,
  tableIdMap: Record<string, string>,
  fieldIdMap: Record<string, string>
): Promise<void> => {
  for (const [declaredTableId, declaredRows] of Object.entries(rows)) {
    if (declaredRows.length === 0) continue;
    const tableId = tableIdMap[declaredTableId] ?? declaredTableId;
    const records = declaredRows.map((row) => ({
      fields: Object.fromEntries(
        Object.entries(row).map(([fieldId, value]) => [fieldIdMap[fieldId] ?? fieldId, value])
      ),
    }));
    for (let offset = 0; offset < records.length; offset += 100) {
      const commandResult = CreateRecordsCommand.create({
        tableId,
        fieldKeyType: 'id',
        typecast: true,
        records: records.slice(offset, offset + 100),
      });
      if (commandResult.isErr()) throw commandResult.error;
      await executeReproCommand(container, commandResult.value);
    }
  }
};

const seedMockRows = async (
  container: DependencyContainer,
  tableIds: ReadonlyArray<string>,
  rowCount: number,
  seed: number
): Promise<void> => {
  for (const tableId of tableIds) {
    await generateMockRows({
      container,
      tableId,
      count: rowCount,
      seed,
      batchSize: 100,
      dryRun: false,
    });
  }
};

const drainComputed = async (
  container: DependencyContainer
): Promise<{ processed: number; iterations: number; errors: string[] }> => {
  const drain = container.resolve<IComputedUpdateDrainService>(
    v2CoreTokens.computedUpdateDrainService
  );
  const context = createReproContext();
  let processed = 0;
  let iterations = 0;
  const errors: string[] = [];
  for (; iterations < 100; iterations += 1) {
    const result = await drain.drainOnce(context, { workerId: 'repro-worker', limit: 100 });
    if (result.isErr()) {
      errors.push(result.error.message);
      break;
    }
    processed += result.value;
    if (result.value === 0) break;
  }
  return { processed, iterations, errors };
};

type TriggerJson = {
  kind: ReproTrigger['kind'];
  tableId?: string;
  fieldIds: string[];
  fieldUpdate?: { tableId: string; fieldId: string; field: Record<string, unknown> };
};

const readTriggerJson = async (path: string): Promise<TriggerJson> => {
  const raw = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  const kind = raw.kind;
  if (kind !== 'field-update' && kind !== 'record-update' && kind !== 'link-change') {
    throw new Error('--trigger-json must declare kind: field-update | record-update | link-change');
  }
  if (kind === 'field-update') {
    const field = raw.field;
    if (typeof raw.tableId !== 'string' || typeof raw.fieldId !== 'string' || !field) {
      throw new Error('--trigger-json field-update needs tableId, fieldId and field');
    }
    return {
      kind,
      tableId: raw.tableId,
      fieldIds: [raw.fieldId],
      fieldUpdate: {
        tableId: raw.tableId,
        fieldId: raw.fieldId,
        field: field as Record<string, unknown>,
      },
    };
  }
  const fieldIds = Array.isArray(raw.fieldIds)
    ? raw.fieldIds.filter((fieldId): fieldId is string => typeof fieldId === 'string')
    : [];
  return { kind, tableId: typeof raw.tableId === 'string' ? raw.tableId : undefined, fieldIds };
};

const summarizeStructure = (structure: ReproStructure) => ({
  tables: structure.tables.length,
  fields: structure.tables.reduce((total, table) => total + table.fields.length, 0),
});

const resolveIdMapPath = (input: ComputedReproInput, artifactDir: string): string => {
  if (input.idMapPath) return resolve(input.idMapPath);
  return `${artifactDir}.id-map.json`;
};

const writeIdMap = async (path: string, idMap: ReproIdMap): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(idMap, null, 2), 'utf-8');
};

const runRepro = async (input: ComputedReproInput): Promise<ComputedReproOutput> => {
  const notes: string[] = [];
  const anonymize = input.anonymize ?? true;
  const rowCount = input.rowCount ?? 5;
  const seed = input.seed ?? 1;

  let deadLetter: ReproDeadLetter | undefined;
  if (input.deadLetterPath) {
    deadLetter = parseDeadLetterPayload(
      JSON.parse(await readFile(resolve(input.deadLetterPath), 'utf-8')) as unknown
    );
  }

  const needsSource = Boolean(input.taskId) || !input.structurePath;
  if (needsSource && !input.connectionString) {
    throw new Error(
      'A live read-only source needs --connection (-c). Pass --structure to run without a database.'
    );
  }
  const source: SourceConnection | undefined =
    needsSource && input.connectionString
      ? await openReadOnlySource(input.connectionString)
      : undefined;

  try {
    if (!deadLetter && input.taskId) {
      if (!source) throw new Error('--task-id needs --connection to read the dead letter row');
      deadLetter = await loadDeadLetterFromDb(source.dataDb, input.taskId);
    }

    let extracted: ExtractedStructure;
    let sourceKind: 'live' | 'file';
    let baseId = input.baseId ?? deadLetter?.baseId;

    if (input.structurePath) {
      sourceKind = 'file';
      extracted = {
        structure: await parseStructure(resolve(input.structurePath)),
        idMap: { tables: {}, fields: {}, views: {}, scrubbedPaths: [] },
      };
    } else {
      if (!source) throw new Error('Provide --structure or --connection with --base-id');
      if (!baseId)
        throw new Error('Live structure export needs --base-id or a dead-letter payload');
      sourceKind = 'live';
      extracted = await extractBaseStructure(source.metaDb, baseId);
    }

    const sanitized = anonymize ? sanitizeStructure(extracted.structure) : extracted;
    if (!baseId && sanitized.structure.id) baseId = sanitized.structure.id;

    const label =
      input.taskId ?? (input.structurePath ? basename(input.structurePath) : (baseId ?? 'base'));
    // `.tmp/` is git-ignored: sanitized customer-derived schema must never look
    // like a normal repo path. `--out` is the explicit escape hatch.
    const artifactDir = resolve(
      input.outDir ?? join('.tmp', 'repro', `computed-${label.replace(/\W+/g, '-')}`)
    );
    await mkdir(artifactDir, { recursive: true });

    const structureJsonPath = join(artifactDir, 'structure.json');
    const structureTeaPath = join(artifactDir, 'structure.tea');
    await writeFile(structureJsonPath, JSON.stringify(sanitized.structure, null, 2), 'utf-8');
    await writeFile(structureTeaPath, writeDotTeaZip(sanitized.structure));

    const triggerJson = input.triggerJsonPath
      ? await readTriggerJson(resolve(input.triggerJsonPath))
      : undefined;
    const trigger = deriveTrigger({
      deadLetter,
      structure: sanitized.structure,
      kind: input.triggerKind ?? triggerJson?.kind,
      tableId: input.tableId ?? triggerJson?.tableId,
      fieldId: input.triggerFieldId,
      fieldIds: triggerJson?.fieldIds,
      fieldUpdate: triggerJson?.fieldUpdate,
    });

    // Headless runtime owns persistence, projection/journal dispatch and the
    // users/undo bootstrap; the repro only adds its mock-row actor.
    const runtime = await createHeadlessRuntime({
      backend: {
        kind: 'pglite',
        dataDir: 'memory://',
        actor: { id: 'cli-repro-computed', name: 'Local computed repro' },
        computedUpdate: {
          mode: 'async',
          outboxConfig: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0 },
        },
      },
    });
    const reproContainer = runtime.container;
    const reproMetaDb = reproContainer.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const reproDataDb = reproContainer.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
    try {
      await sql`
        insert into public.users (id, name)
        values ('cli-mock-records', 'Local mock rows')
        on conflict (id) do nothing
      `.execute(reproDataDb);

      const reproBaseId = await createBase(reproContainer);
      const imported = await importStructure(
        reproContainer,
        reproBaseId,
        writeDotTeaZip(sanitized.structure)
      );

      const rowSample = input.rowsPath
        ? parseRowSample(JSON.parse(await readFile(resolve(input.rowsPath), 'utf-8')) as unknown)
        : undefined;
      if (rowSample) {
        await insertRowSamples(reproContainer, rowSample, imported.tableIdMap, imported.fieldIdMap);
        notes.push(
          'rows: inserted from --rows; cell values are intentionally not copied into the artifact'
        );
      } else {
        await seedMockRows(
          reproContainer,
          imported.tables.map((table) => table.id),
          rowCount,
          seed
        );
        notes.push(
          `rows: ${rowCount} synthetic rows per table (seed ${seed}) via @teable/v2-mock-records`
        );
      }

      if (input.fault) {
        const note = await applyColumnTypeDrift({
          metaDb: reproMetaDb,
          fault: input.fault,
          fieldIdMap: imported.fieldIdMap,
        });
        notes.push(note);
      }

      const applied = await applyTrigger(
        {
          container: reproContainer,
          structure: sanitized.structure,
          tableIdMap: imported.tableIdMap,
          fieldIdMap: imported.fieldIdMap,
        },
        trigger
      );

      const drain = await drainComputed(reproContainer);
      if (drain.errors.length) notes.push(`drain: ${drain.errors.join('; ')}`);

      const failure = await captureFailure(reproDataDb, reproBaseId);

      if (input.emitSpecPath) {
        const specPath = resolve(input.emitSpecPath);
        await mkdir(dirname(specPath), { recursive: true });
        const expectedFailure = failure.kind === 'dead_letter';
        const spec = renderPgliteSpec({
          structure: sanitized.structure,
          trigger,
          expectation: expectedFailure ? 'failure' : 'success',
          sourceLabel: label,
          errorSignature: failure.lastError?.slice(0, 120),
          failureKind: failure.failureKind,
          fault: input.fault,
        });
        await writeFile(specPath, spec, 'utf-8');
        notes.push(`spec: ${specPath}`);
      }

      notes.push(
        'limits: PGlite is single-connection; advisory-lock contention, concurrent workers, and statement_timeout expiry cannot be reproduced.'
      );

      const idMapPath = anonymize ? resolveIdMapPath(input, artifactDir) : undefined;
      if (idMapPath) {
        await writeIdMap(idMapPath, sanitized.idMap);
        notes.push(
          `id map: ${idMapPath} (kept outside the artifact; never share it with the artifact)`
        );
      }

      const runReport = {
        source: sourceKind,
        baseId,
        anonymized: anonymize,
        trigger: { ...applied, reason: trigger.reason },
        drain: { processed: drain.processed, iterations: drain.iterations },
        failure,
        notes,
      };
      const runPath = join(artifactDir, 'run.json');
      await writeFile(runPath, JSON.stringify(runReport, null, 2), 'utf-8');

      const summary = summarizeStructure(sanitized.structure);
      return {
        artifactDir,
        structure: {
          source: sourceKind,
          sanitized: anonymize,
          tables: summary.tables,
          fields: summary.fields,
          baseId,
          tableIdMap: imported.tableIdMap,
          fieldIdMap: imported.fieldIdMap,
        },
        trigger: { ...applied, reason: trigger.reason },
        drain: { processed: drain.processed, iterations: drain.iterations },
        failure,
        files: {
          structureJson: structureJsonPath,
          structureTea: structureTeaPath,
          run: runPath,
          ...(input.emitSpecPath ? { spec: resolve(input.emitSpecPath) } : {}),
        },
        idMapPath,
        notes,
      };
    } finally {
      await runtime.close();
    }
  } finally {
    await source?.close();
  }
};

export const ComputedReproLive = Layer.succeed(ComputedRepro, {
  run: (input: ComputedReproInput) =>
    Effect.tryPromise({
      try: () => runRepro(input),
      catch: (error) => CliError.fromUnknown(error),
    }),
});

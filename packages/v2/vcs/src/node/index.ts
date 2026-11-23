import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { vcsDomainError } from '../domain/errors';
import {
  canonicalizeRecord,
  canonicalizeSnapshot,
  canonicalizeTable,
} from '../domain/fieldClassification';
import {
  baseVcsSnapshotSchema,
  type IBaseVcsPatch,
  type IBaseVcsSnapshot,
  type IRecordVcsSnapshot,
  type ITableVcsSnapshot,
  type IVcsCloneRecordsChunk,
  type IVcsConflict,
  type IVcsEngineApplyResult,
  type IVcsMergeState,
  type IVcsWorkingDelta,
  type IVcsWorkingTableDelta,
  type IVcsWorkspaceConfig,
} from '../domain/types';
import type {
  IVcsBaseSchemaSummary,
  IVcsBaseStateMutationBatch,
  IVcsHydrateRecordChunkResult,
  IVcsLocalEnginePort,
  IVcsStateRepository,
} from '../ports';

interface ILocalCaptureOptions {
  readonly baseName?: string;
  readonly revision?: number;
  readonly skipCaptureSnapshot?: boolean;
}

const vcsWorkspaceConfigSchema = z.object({
  formatVersion: z.literal(1),
  baseId: z.string(),
  baseName: z.string(),
  endpoint: z.string().optional(),
  remoteMode: z.enum(['v2-vcs', 'openapi-readonly']),
  pgliteDir: z.string().optional(),
  headlessUrl: z.string().optional(),
  selectedTables: z.array(z.string()).optional(),
  multiValueStrategy: z.enum(['strict', 'set']).optional(),
  pullCursor: z.string().optional(),
  lastOriginPushId: z.string().optional(),
  lastOriginPushIds: z.array(z.string()).optional(),
  schemaOnly: z.boolean().optional(),
  clonedAt: z.string().datetime().optional(),
  cloneRevision: z.number().int().nonnegative().optional(),
  lastPulledAt: z.string().optional(),
  lastPushedAt: z.string().optional(),
});

const vcsConflictSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'table_delete_modify',
    'field_delete_modify',
    'field_schema_conflict',
    'view_delete_modify',
    'view_schema_conflict',
    'record_delete_modify',
    'cell_edit_edit',
    'constraint_conflict',
  ]),
  tableId: z.string(),
  entityId: z.string(),
  fieldId: z.string().optional(),
  baseValue: z.unknown(),
  oursValue: z.unknown(),
  theirsValue: z.unknown(),
  message: z.string(),
});

const vcsMergeStateSchema = z.object({
  baseSnapshot: baseVcsSnapshotSchema,
  oursSnapshot: baseVcsSnapshotSchema,
  theirsSnapshot: baseVcsSnapshotSchema,
  workingSnapshot: baseVcsSnapshotSchema,
  conflicts: z.array(vcsConflictSchema),
});

const headlessErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
    tags: z.array(z.string()).optional(),
  }),
});

export type NodeVcsRootOption = string | { readonly rootDir: string };

export interface IHttpHeadlessLocalEngineAdapterOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
}

export type HttpHeadlessLocalEngineOption = string | IHttpHeadlessLocalEngineAdapterOptions;

function resolveRootDir(rootDirOrOptions: NodeVcsRootOption): string {
  return typeof rootDirOrOptions === 'string' ? rootDirOrOptions : rootDirOrOptions.rootDir;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildHttpDomainError(
  status: number,
  code: string,
  message: string,
  tags: readonly string[],
  path: string
): DomainError {
  const details = { status, path };
  if (tags.includes('not-found') || status === 404) {
    return vcsDomainError.notFound({ code, message, details });
  }
  if (tags.includes('conflict') || status === 409) {
    return vcsDomainError.conflict({ code, message, details });
  }
  if (tags.includes('validation') || tags.includes('invariant') || status === 400) {
    return vcsDomainError.validation({ code, message, details });
  }
  if (tags.includes('forbidden') || status === 403) {
    return vcsDomainError.forbidden({ code, message, details });
  }
  if (tags.includes('unauthorized') || status === 401) {
    return vcsDomainError.unauthorized({ code, message, details });
  }
  return vcsDomainError.infrastructure({ code, message, details });
}

function mapHttpErrorEnvelope(status: number, body: unknown, path: string): DomainError {
  const parsed = headlessErrorEnvelopeSchema.safeParse(body);
  if (parsed.success) {
    const { code = `vcs.headless_http_${status}`, message, tags = [] } = parsed.data.error;
    return buildHttpDomainError(status, code, message, tags, path);
  }
  return buildHttpDomainError(
    status,
    `vcs.headless_http_${status}`,
    `Headless HTTP ${path} failed with status ${status}`,
    [],
    path
  );
}

function buildSnapshotQueryPath(baseId: string, options?: ILocalCaptureOptions): string {
  const params = new URLSearchParams({ baseId });
  if (options?.baseName !== undefined) {
    params.set('baseName', options.baseName);
  }
  if (options?.revision !== undefined) {
    params.set('revision', String(options.revision));
  }
  return `/vcs/snapshot?${params.toString()}`;
}

export class HttpHeadlessLocalEngineAdapter implements IVcsLocalEnginePort {
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpHeadlessLocalEngineOption) {
    if (typeof options === 'string') {
      this.baseUrl = trimTrailingSlash(options);
      this.headers = {};
      this.fetchFn = fetch;
    } else {
      this.baseUrl = trimTrailingSlash(options.baseUrl);
      this.headers = options.headers ?? {};
      this.fetchFn = options.fetchImpl ?? fetch;
    }
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<Result<T, DomainError>> {
    const url = `${this.baseUrl}${path}`;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        ...this.headers,
      };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      const response = await this.fetchFn(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const rawText = await response.text();
      let parsedBody: unknown;
      try {
        parsedBody = rawText.length > 0 ? (JSON.parse(rawText) as unknown) : undefined;
      } catch {
        return err(
          vcsDomainError.infrastructure({
            code: 'vcs.headless_invalid_json',
            message: `Headless HTTP ${path} returned non-JSON response (${response.status})`,
            details: { status: response.status, path },
          })
        );
      }

      if (
        !response.ok ||
        typeof parsedBody !== 'object' ||
        parsedBody === null ||
        (parsedBody as { ok?: unknown }).ok !== true
      ) {
        return err(mapHttpErrorEnvelope(response.status, parsedBody, path));
      }

      return ok((parsedBody as { ok: true; data: T }).data);
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.headless_request_failed',
          message: `Headless HTTP request ${method} ${url} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          cause: error,
        })
      );
    }
  }

  async hasBase(baseId: string): Promise<Result<boolean, DomainError>> {
    const params = new URLSearchParams({ baseId });
    const res = await this.requestJson<{ readonly exists: boolean }>(
      'GET',
      `/vcs/exists?${params.toString()}`
    );
    if (res.isErr()) return err(res.error);
    return ok(Boolean(res.value.exists));
  }

  async captureSnapshot(
    baseId: string,
    options?: ILocalCaptureOptions
  ): Promise<Result<IBaseVcsSnapshot, DomainError>> {
    const res = await this.requestJson<IBaseVcsSnapshot>(
      'GET',
      buildSnapshotQueryPath(baseId, options)
    );
    if (res.isErr()) return err(res.error);
    return ok(canonicalizeSnapshot(res.value, { preserveComputed: true }));
  }

  async hydrateSnapshot(
    snapshot: IBaseVcsSnapshot,
    options?: ILocalCaptureOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const res = await this.requestJson<IVcsEngineApplyResult>('POST', '/vcs/hydrate', {
      snapshot,
      ...(options?.skipCaptureSnapshot ? { skipCaptureSnapshot: true } : {}),
    });
    if (res.isErr()) return err(res.error);
    return ok({
      ...res.value,
      ...(res.value.snapshot
        ? {
            snapshot: canonicalizeSnapshot(
              {
                ...res.value.snapshot,
                revision: snapshot.revision,
              },
              { preserveComputed: true }
            ),
          }
        : {}),
    });
  }

  async applyPatch(
    baseId: string,
    patch: IBaseVcsPatch,
    options?: ILocalCaptureOptions
  ): Promise<Result<IVcsEngineApplyResult, DomainError>> {
    const res = await this.requestJson<IVcsEngineApplyResult>('POST', '/vcs/apply', {
      baseId,
      patch,
      ...(options?.skipCaptureSnapshot ? { skipCaptureSnapshot: true } : {}),
    });
    if (res.isErr()) return err(res.error);
    return ok({
      ...res.value,
      ...(res.value.snapshot
        ? {
            snapshot: canonicalizeSnapshot(
              {
                ...res.value.snapshot,
                ...(options?.baseName ? { baseName: options.baseName } : {}),
                ...(options?.revision !== undefined ? { revision: options.revision } : {}),
              },
              { preserveComputed: true }
            ),
          }
        : {}),
    });
  }

  async hydrateRecordChunk(params: {
    readonly baseId: string;
    readonly tableId: string;
    readonly records: readonly IRecordVcsSnapshot[];
    readonly mode?: 'scalar-insert' | 'link-update';
  }): Promise<Result<IVcsHydrateRecordChunkResult, DomainError>> {
    return this.requestJson<IVcsHydrateRecordChunkResult>('POST', '/vcs/hydrate-records', params);
  }

  async flushComputed(baseId: string): Promise<Result<number, DomainError>> {
    const res = await this.requestJson<{ readonly recomputedCells: number }>(
      'POST',
      '/vcs/flush-computed',
      { baseId }
    );
    return res.map((value) => value.recomputedCells);
  }

  async captureTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    const params = new URLSearchParams({ baseId, tableId });
    if (options?.cursor !== undefined) {
      params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    return this.requestJson<IVcsCloneRecordsChunk>(
      'GET',
      `/vcs/records-chunk?${params.toString()}`
    );
  }

  async markWorkingClean(baseId: string): Promise<Result<void, DomainError>> {
    const res = await this.requestJson<unknown>('POST', '/vcs/mark-clean', { baseId });
    return res.map(() => undefined);
  }

  async ensureWorkingTrackingTriggers(baseId: string): Promise<Result<void, DomainError>> {
    const res = await this.requestJson<unknown>('POST', '/vcs/ensure-triggers', { baseId });
    return res.map(() => undefined);
  }

  async captureWorkingDelta(
    baseId: string,
    options?: ILocalCaptureOptions
  ): Promise<Result<IVcsWorkingDelta, DomainError>> {
    const params = new URLSearchParams({ baseId });
    if (options?.baseName !== undefined) {
      params.set('baseName', options.baseName);
    }
    if (options?.revision !== undefined) {
      params.set('revision', String(options.revision));
    }
    const res = await this.requestJson<{
      readonly isCompleteDelta: boolean;
      readonly schemaSnapshot: IBaseVcsSnapshot;
      readonly tableDeltas: Readonly<Record<string, IVcsWorkingTableDelta>>;
    }>('GET', `/vcs/delta?${params.toString()}`);
    if (res.isErr()) return err(res.error);

    return ok({
      isCompleteDelta: Boolean(res.value.isCompleteDelta),
      schemaSnapshot: canonicalizeSnapshot(res.value.schemaSnapshot, { preserveComputed: true }),
      tableDeltas: new Map<string, IVcsWorkingTableDelta>(
        Object.entries(res.value.tableDeltas ?? {})
      ),
    });
  }
}

const BASE_RECORDS_BUCKET_COUNT = 64;
const MONOLITHIC_SNAPSHOT_RECORD_LIMIT = 2_000;
const SAFE_PATH_SEGMENT_RE = /^[\w-]+$/;

interface IStoredBaseSchemaFile {
  readonly formatVersion: 1;
  readonly snapshot: IBaseVcsSnapshot;
  readonly tableRecordCounts: Record<string, number>;
  readonly totalRecords: number;
}

const storedBaseSchemaFileSchema = z.object({
  formatVersion: z.literal(1),
  snapshot: baseVcsSnapshotSchema,
  tableRecordCounts: z.record(z.string(), z.number().int().nonnegative()),
  totalRecords: z.number().int().nonnegative(),
});

function computeRecordBucket(recordId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < recordId.length; i += 1) {
    hash ^= recordId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % BASE_RECORDS_BUCKET_COUNT;
}

function formatBucketFileName(bucket: number): string {
  return `b${bucket.toString(16).padStart(2, '0')}.json`;
}

function toSchemaOnlySnapshot(snapshot: IBaseVcsSnapshot): IBaseVcsSnapshot {
  return canonicalizeSnapshot(
    {
      ...snapshot,
      tables: snapshot.tables.map((t) => ({ ...t, records: [] })),
    },
    { preserveComputed: true }
  );
}

export class FileVcsStateRepository implements IVcsStateRepository {
  private readonly rootDir: string;

  constructor(rootDirOrOptions: NodeVcsRootOption) {
    this.rootDir = resolveRootDir(rootDirOrOptions);
  }

  private get stateDir(): string {
    return join(this.rootDir, '.teable', 'vcs');
  }

  private get baseRecordsDir(): string {
    return join(this.stateDir, 'base-records');
  }

  private resolveTableRecordsDir(tableId: string): string {
    if (!SAFE_PATH_SEGMENT_RE.test(tableId)) {
      throw new Error(`Invalid tableId for VCS record store: ${tableId}`);
    }
    return join(this.baseRecordsDir, tableId);
  }

  private async readJsonPath<T>(
    absPath: string,
    label: string,
    parse: (raw: unknown) => T | null
  ): Promise<Result<T | null, DomainError>> {
    try {
      const content = await readFile(absPath, 'utf8');
      const parsedJson = JSON.parse(content) as unknown;
      return ok(parse(parsedJson));
    } catch (error) {
      if (isEnoent(error)) {
        return ok(null);
      }
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.state_read_failed',
          message: `Failed to read ${label}: ${String(error)}`,
          cause: error,
        })
      );
    }
  }

  private async writeJsonPath(
    absPath: string,
    dirPath: string,
    label: string,
    data: unknown
  ): Promise<Result<void, DomainError>> {
    const tmpPath = `${absPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await mkdir(dirPath, { recursive: true });
      await writeFile(tmpPath, formatJson(data), 'utf8');
      await rename(tmpPath, absPath);
      return ok(undefined);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.state_write_failed',
          message: `Failed to write ${label}: ${String(error)}`,
          cause: error,
        })
      );
    }
  }

  private async readJsonFile<T>(
    fileName: string,
    parse: (raw: unknown) => T | null
  ): Promise<Result<T | null, DomainError>> {
    return this.readJsonPath(join(this.stateDir, fileName), fileName, parse);
  }

  private async writeJsonFile(fileName: string, data: unknown): Promise<Result<void, DomainError>> {
    return this.writeJsonPath(join(this.stateDir, fileName), this.stateDir, fileName, data);
  }

  private async readStoredBaseSchemaFile(): Promise<
    Result<IStoredBaseSchemaFile | null, DomainError>
  > {
    return this.readJsonFile('base.schema.json', (raw) => {
      const parsed = storedBaseSchemaFileSchema.parse(raw);
      return {
        formatVersion: 1,
        snapshot: canonicalizeSnapshot(parsed.snapshot as IBaseVcsSnapshot, {
          preserveComputed: true,
        }),
        tableRecordCounts: { ...parsed.tableRecordCounts },
        totalRecords: parsed.totalRecords,
      };
    });
  }

  private async readLegacyBaseSnapshot(): Promise<Result<IBaseVcsSnapshot | null, DomainError>> {
    return this.readJsonFile('base.snapshot.json', (raw) =>
      canonicalizeSnapshot(baseVcsSnapshotSchema.parse(raw) as IBaseVcsSnapshot, {
        preserveComputed: true,
      })
    );
  }

  private async writeBucketedTableRecords(
    table: ITableVcsSnapshot,
    options?: { readonly clearExisting?: boolean }
  ): Promise<Result<void, DomainError>> {
    const tableDir = this.resolveTableRecordsDir(table.id);
    if (options?.clearExisting) {
      await rm(tableDir, { recursive: true, force: true });
    }
    if (table.records.length === 0) {
      return ok(undefined);
    }
    const byBucket = new Map<number, Record<string, IRecordVcsSnapshot>>();
    for (const rec of table.records) {
      const bucket = computeRecordBucket(rec.id);
      let map = byBucket.get(bucket);
      if (!map) {
        map = {};
        byBucket.set(bucket, map);
      }
      map[rec.id] = canonicalizeRecord(rec, table.fields, { preserveComputed: true });
    }
    for (const [bucket, recordsObj] of byBucket.entries()) {
      const fileName = formatBucketFileName(bucket);
      const writeRes = await this.writeJsonPath(
        join(tableDir, fileName),
        tableDir,
        `base-records/${table.id}/${fileName}`,
        recordsObj
      );
      if (writeRes.isErr()) return err(writeRes.error);
    }
    return ok(undefined);
  }

  private async readAllTableBucketRecords(
    tableId: string
  ): Promise<Result<IRecordVcsSnapshot[], DomainError>> {
    const tableDir = this.resolveTableRecordsDir(tableId);
    let entries: string[];
    try {
      entries = await readdir(tableDir);
    } catch (error) {
      if (isEnoent(error)) {
        return ok([]);
      }
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.state_read_failed',
          message: `Failed to list buckets for table ${tableId}: ${String(error)}`,
          cause: error,
        })
      );
    }

    const records: IRecordVcsSnapshot[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json')) continue;
      const bucketRes = await this.readJsonPath(
        join(tableDir, entry),
        `base-records/${tableId}/${entry}`,
        (raw) => raw as Record<string, IRecordVcsSnapshot>
      );
      if (bucketRes.isErr()) return err(bucketRes.error);
      if (bucketRes.value) {
        records.push(...Object.values(bucketRes.value));
      }
    }
    return ok(records);
  }

  async readConfig(): Promise<Result<IVcsWorkspaceConfig | null, DomainError>> {
    return this.readJsonFile('config.json', (raw) => vcsWorkspaceConfigSchema.parse(raw));
  }

  async writeConfig(config: IVcsWorkspaceConfig): Promise<Result<void, DomainError>> {
    return this.writeJsonFile('config.json', vcsWorkspaceConfigSchema.parse(config));
  }

  async readBaseSchemaSnapshot(): Promise<Result<IVcsBaseSchemaSummary | null, DomainError>> {
    const schemaFileRes = await this.readStoredBaseSchemaFile();
    if (schemaFileRes.isErr()) return err(schemaFileRes.error);
    if (schemaFileRes.value) {
      return ok({
        schemaSnapshot: schemaFileRes.value.snapshot,
        totalRecords: schemaFileRes.value.totalRecords,
        tableRecordCounts: schemaFileRes.value.tableRecordCounts,
      });
    }

    const legacyRes = await this.readLegacyBaseSnapshot();
    if (legacyRes.isErr()) return err(legacyRes.error);
    if (!legacyRes.value) return ok(null);

    const tableRecordCounts: Record<string, number> = {};
    let totalRecords = 0;
    for (const table of legacyRes.value.tables) {
      tableRecordCounts[table.id] = table.records.length;
      totalRecords += table.records.length;
    }
    return ok({
      schemaSnapshot: toSchemaOnlySnapshot(legacyRes.value),
      tableRecordCounts,
      totalRecords,
    });
  }

  async writeBaseSchemaSnapshot(
    schemaSnapshot: IBaseVcsSnapshot
  ): Promise<Result<void, DomainError>> {
    await rm(this.baseRecordsDir, { recursive: true, force: true });
    await rm(join(this.stateDir, 'base.snapshot.json'), { force: true });

    const cleanSchema = toSchemaOnlySnapshot(schemaSnapshot);
    const tableRecordCounts: Record<string, number> = {};
    for (const table of cleanSchema.tables) {
      tableRecordCounts[table.id] = 0;
    }
    const stored: IStoredBaseSchemaFile = {
      formatVersion: 1,
      snapshot: cleanSchema,
      tableRecordCounts,
      totalRecords: 0,
    };
    return this.writeJsonFile('base.schema.json', stored);
  }

  private async readLegacyRecordsByIds(
    tableId: string,
    recordIds: readonly string[]
  ): Promise<Result<ReadonlyMap<string, IRecordVcsSnapshot>, DomainError>> {
    const out = new Map<string, IRecordVcsSnapshot>();
    const legacyRes = await this.readLegacyBaseSnapshot();
    if (legacyRes.isErr()) return err(legacyRes.error);
    const table = legacyRes.value?.tables.find((t) => t.id === tableId);
    if (!table) return ok(out);
    const wanted = new Set(recordIds);
    for (const rec of table.records) {
      if (wanted.has(rec.id)) out.set(rec.id, rec);
    }
    return ok(out);
  }

  private groupRecordIdsByBucket(recordIds: readonly string[]): Map<number, Set<string>> {
    const byBucket = new Map<number, Set<string>>();
    for (const recordId of recordIds) {
      const bucket = computeRecordBucket(recordId);
      let set = byBucket.get(bucket);
      if (!set) {
        set = new Set();
        byBucket.set(bucket, set);
      }
      set.add(recordId);
    }
    return byBucket;
  }

  async readBaseRecordsByIds(
    tableId: string,
    recordIds: readonly string[]
  ): Promise<Result<ReadonlyMap<string, IRecordVcsSnapshot>, DomainError>> {
    const out = new Map<string, IRecordVcsSnapshot>();
    if (recordIds.length === 0) return ok(out);

    const schemaFileRes = await this.readStoredBaseSchemaFile();
    if (schemaFileRes.isErr()) return err(schemaFileRes.error);
    if (!schemaFileRes.value) {
      return this.readLegacyRecordsByIds(tableId, recordIds);
    }

    const tableDir = this.resolveTableRecordsDir(tableId);
    for (const [bucket, wantedIds] of this.groupRecordIdsByBucket(recordIds).entries()) {
      const fileName = formatBucketFileName(bucket);
      const bucketRes = await this.readJsonPath(
        join(tableDir, fileName),
        `base-records/${tableId}/${fileName}`,
        (raw) => raw as Record<string, IRecordVcsSnapshot>
      );
      if (bucketRes.isErr()) return err(bucketRes.error);
      if (!bucketRes.value) continue;
      for (const id of wantedIds) {
        const rec = bucketRes.value[id];
        if (rec) out.set(id, rec);
      }
    }

    return ok(out);
  }

  private async ensureInitializedSchemaFile(): Promise<Result<IStoredBaseSchemaFile, DomainError>> {
    const schemaFileRes = await this.readStoredBaseSchemaFile();
    if (schemaFileRes.isErr()) return err(schemaFileRes.error);
    if (schemaFileRes.value) return ok(schemaFileRes.value);

    const legacyRes = await this.readLegacyBaseSnapshot();
    if (legacyRes.isErr()) return err(legacyRes.error);
    if (!legacyRes.value) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.missing_base_snapshot',
          message: 'Cannot apply baseline mutations before base schema is initialized',
        })
      );
    }
    const writeLegacyRes = await this.writeBaseSnapshot(legacyRes.value);
    if (writeLegacyRes.isErr()) return err(writeLegacyRes.error);
    const reloadedRes = await this.readStoredBaseSchemaFile();
    if (reloadedRes.isErr()) return err(reloadedRes.error);
    return ok(reloadedRes.value!);
  }

  private async applyNodeTableSchemaMutations(
    batch: IVcsBaseStateMutationBatch,
    tableMap: Map<string, ITableVcsSnapshot>,
    tableRecordCounts: Record<string, number>
  ): Promise<Result<void, DomainError>> {
    for (const deletedTableId of batch.tablesDeleted ?? []) {
      tableMap.delete(deletedTableId);
      delete tableRecordCounts[deletedTableId];
      await rm(this.resolveTableRecordsDir(deletedTableId), { recursive: true, force: true });
    }
    for (const addedTable of batch.tablesAdded ?? []) {
      const canonical = canonicalizeTable(addedTable, { preserveComputed: true });
      const writeBucketsRes = await this.writeBucketedTableRecords(canonical, {
        clearExisting: true,
      });
      if (writeBucketsRes.isErr()) return err(writeBucketsRes.error);
      tableMap.set(canonical.id, { ...canonical, records: [] });
      tableRecordCounts[canonical.id] = canonical.records.length;
    }
    for (const updatedTable of batch.tablesSchemaUpdated ?? []) {
      const canonicalSchema = canonicalizeTable(
        { ...updatedTable, records: [] },
        { preserveComputed: true }
      );
      tableMap.set(canonicalSchema.id, canonicalSchema);
      tableRecordCounts[canonicalSchema.id] ??= 0;
    }
    return ok(undefined);
  }

  private groupBucketRecordMutations(
    upserts: readonly IRecordVcsSnapshot[],
    deleteIds: readonly string[]
  ): Map<number, { upserts: IRecordVcsSnapshot[]; deleteIds: string[] }> {
    const bucketMutations = new Map<
      number,
      { upserts: IRecordVcsSnapshot[]; deleteIds: string[] }
    >();
    const ensureEntry = (bucket: number) => {
      let entry = bucketMutations.get(bucket);
      if (!entry) {
        entry = { upserts: [], deleteIds: [] };
        bucketMutations.set(bucket, entry);
      }
      return entry;
    };
    for (const id of deleteIds) ensureEntry(computeRecordBucket(id)).deleteIds.push(id);
    for (const rec of upserts) ensureEntry(computeRecordBucket(rec.id)).upserts.push(rec);
    return bucketMutations;
  }

  private async applySingleBucketFileMutation(params: {
    readonly tableId: string;
    readonly tableDir: string;
    readonly tableFields: ITableVcsSnapshot['fields'] | undefined;
    readonly bucket: number;
    readonly upserts: readonly IRecordVcsSnapshot[];
    readonly deleteIds: readonly string[];
  }): Promise<Result<number, DomainError>> {
    const fileName = formatBucketFileName(params.bucket);
    const absPath = join(params.tableDir, fileName);
    const existingRes = await this.readJsonPath(
      absPath,
      `base-records/${params.tableId}/${fileName}`,
      (raw) => raw as Record<string, IRecordVcsSnapshot>
    );
    if (existingRes.isErr()) return err(existingRes.error);
    const bucketData: Record<string, IRecordVcsSnapshot> = existingRes.value
      ? { ...existingRes.value }
      : {};

    let countDelta = 0;
    for (const delId of params.deleteIds) {
      if (Object.prototype.hasOwnProperty.call(bucketData, delId)) {
        delete bucketData[delId];
        countDelta -= 1;
      }
    }
    for (const rec of params.upserts) {
      if (!Object.prototype.hasOwnProperty.call(bucketData, rec.id)) countDelta += 1;
      bucketData[rec.id] = canonicalizeRecord(rec, params.tableFields, { preserveComputed: true });
    }

    if (Object.keys(bucketData).length === 0) {
      await rm(absPath, { force: true });
      return ok(countDelta);
    }
    const writeRes = await this.writeJsonPath(
      absPath,
      params.tableDir,
      `base-records/${params.tableId}/${fileName}`,
      bucketData
    );
    if (writeRes.isErr()) return err(writeRes.error);
    return ok(countDelta);
  }

  private async applySingleTableBucketMutations(
    tableId: string,
    tableFields: ITableVcsSnapshot['fields'] | undefined,
    upserts: readonly IRecordVcsSnapshot[],
    deleteIds: readonly string[]
  ): Promise<Result<number, DomainError>> {
    const tableDir = this.resolveTableRecordsDir(tableId);
    const bucketMutations = this.groupBucketRecordMutations(upserts, deleteIds);
    let countDelta = 0;

    for (const [bucket, mut] of bucketMutations.entries()) {
      const res = await this.applySingleBucketFileMutation({
        tableId,
        tableDir,
        tableFields,
        bucket,
        upserts: mut.upserts,
        deleteIds: mut.deleteIds,
      });
      if (res.isErr()) return err(res.error);
      countDelta += res.value;
    }

    return ok(countDelta);
  }

  async applyBaseStateMutations(
    batch: IVcsBaseStateMutationBatch
  ): Promise<Result<void, DomainError>> {
    const initRes = await this.ensureInitializedSchemaFile();
    if (initRes.isErr()) return err(initRes.error);
    const current = initRes.value;

    const tableMap = new Map<string, ITableVcsSnapshot>(
      current.snapshot.tables.map((t) => [t.id, t])
    );
    const tableRecordCounts: Record<string, number> = { ...current.tableRecordCounts };

    const schemaMutRes = await this.applyNodeTableSchemaMutations(
      batch,
      tableMap,
      tableRecordCounts
    );
    if (schemaMutRes.isErr()) return err(schemaMutRes.error);

    for (const recChange of batch.recordChanges ?? []) {
      const upserts = recChange.upserts ?? [];
      const deleteIds = recChange.deleteIds ?? [];
      if (upserts.length === 0 && deleteIds.length === 0) continue;

      const deltaRes = await this.applySingleTableBucketMutations(
        recChange.tableId,
        tableMap.get(recChange.tableId)?.fields,
        upserts,
        deleteIds
      );
      if (deltaRes.isErr()) return err(deltaRes.error);
      tableRecordCounts[recChange.tableId] = Math.max(
        0,
        (tableRecordCounts[recChange.tableId] ?? 0) + deltaRes.value
      );
    }

    const totalRecords = Object.values(tableRecordCounts).reduce((sum, n) => sum + n, 0);
    const nextSchemaSnapshot = canonicalizeSnapshot(
      {
        ...current.snapshot,
        ...(batch.baseName !== undefined ? { baseName: batch.baseName } : {}),
        ...(batch.revision !== undefined ? { revision: batch.revision } : {}),
        ...(batch.cursor !== undefined ? { cursor: batch.cursor } : {}),
        ...(batch.accessScope !== undefined ? { accessScope: batch.accessScope } : {}),
        capturedAt: new Date().toISOString(),
        tables: Array.from(tableMap.values()),
      },
      { preserveComputed: true }
    );

    const writeSchemaRes = await this.writeJsonFile('base.schema.json', {
      formatVersion: 1,
      snapshot: nextSchemaSnapshot,
      tableRecordCounts,
      totalRecords,
    } satisfies IStoredBaseSchemaFile);
    if (writeSchemaRes.isErr()) return err(writeSchemaRes.error);

    await rm(join(this.stateDir, 'base.snapshot.json'), { force: true });
    return ok(undefined);
  }

  async readBaseSnapshot(): Promise<Result<IBaseVcsSnapshot | null, DomainError>> {
    const schemaFileRes = await this.readStoredBaseSchemaFile();
    if (schemaFileRes.isErr()) return err(schemaFileRes.error);
    if (!schemaFileRes.value) {
      return this.readLegacyBaseSnapshot();
    }

    const reconstructedTables: ITableVcsSnapshot[] = [];
    for (const schemaTable of schemaFileRes.value.snapshot.tables) {
      const recordsRes = await this.readAllTableBucketRecords(schemaTable.id);
      if (recordsRes.isErr()) return err(recordsRes.error);
      reconstructedTables.push({
        ...schemaTable,
        records: recordsRes.value,
      });
    }

    return ok(
      canonicalizeSnapshot(
        {
          ...schemaFileRes.value.snapshot,
          tables: reconstructedTables,
        },
        { preserveComputed: true }
      )
    );
  }

  async writeBaseSnapshot(snapshot: IBaseVcsSnapshot): Promise<Result<void, DomainError>> {
    const canonical = canonicalizeSnapshot(snapshot, { preserveComputed: true });
    await rm(this.baseRecordsDir, { recursive: true, force: true });

    const tableRecordCounts: Record<string, number> = {};
    let totalRecords = 0;

    for (const table of canonical.tables) {
      const writeRes = await this.writeBucketedTableRecords(table);
      if (writeRes.isErr()) return err(writeRes.error);
      tableRecordCounts[table.id] = table.records.length;
      totalRecords += table.records.length;
    }

    const writeSchemaRes = await this.writeJsonFile('base.schema.json', {
      formatVersion: 1,
      snapshot: toSchemaOnlySnapshot(canonical),
      tableRecordCounts,
      totalRecords,
    } satisfies IStoredBaseSchemaFile);
    if (writeSchemaRes.isErr()) return err(writeSchemaRes.error);

    if (totalRecords <= MONOLITHIC_SNAPSHOT_RECORD_LIMIT) {
      return this.writeJsonFile('base.snapshot.json', canonical);
    }
    await rm(join(this.stateDir, 'base.snapshot.json'), { force: true });
    return ok(undefined);
  }

  async readConflicts(): Promise<Result<readonly IVcsConflict[], DomainError>> {
    const res = await this.readJsonFile('conflicts.json', (raw) => {
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw.map((item) => vcsConflictSchema.parse(item));
    });
    if (res.isErr()) return err(res.error);
    return ok(res.value ?? []);
  }

  async writeConflicts(conflicts: readonly IVcsConflict[]): Promise<Result<void, DomainError>> {
    return this.writeJsonFile('conflicts.json', [...conflicts]);
  }

  async readMergeState(): Promise<Result<IVcsMergeState | null, DomainError>> {
    return this.readJsonFile(
      'merge-state.json',
      (raw) => vcsMergeStateSchema.parse(raw) as IVcsMergeState
    );
  }

  async writeMergeState(state: IVcsMergeState | null): Promise<Result<void, DomainError>> {
    if (state === null) {
      try {
        await rm(join(this.stateDir, 'merge-state.json'), { force: true });
        return ok(undefined);
      } catch (error) {
        return err(
          vcsDomainError.infrastructure({
            code: 'vcs.state_delete_failed',
            message: `Failed to remove merge-state.json: ${String(error)}`,
            cause: error,
          })
        );
      }
    }
    return this.writeJsonFile('merge-state.json', state);
  }
}

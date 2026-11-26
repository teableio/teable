import type { BaseId, DomainError, IExecutionContext } from '@teable/v2-core';
import {
  diffSnapshots,
  err,
  isStoredVcsField,
  ok,
  summarizePatch,
  vcsDomainError,
  type IBaseVcsPatch,
  type IBaseVcsSnapshot,
  type IRecordVcsSnapshot,
  type ITableVcsSnapshot,
  type Result,
} from '@teable/v2-vcs';
import {
  checkpointRecordKey,
  containsForeignReferences,
  type IVcsTableManifest,
  type IVcsRevisionComparison,
  type SelectHistoricalCheckpointRecords,
  type VcsCheckpointCapture,
} from '@teable/v2-vcs/server';
import { sql, type Kysely, type Transaction } from 'kysely';

import type { IBaseVcsDatabase } from './PostgresBaseVcsLogRepository';
import { CheckpointReuse, type TableRef } from './checkpointReuse';

type Database = Kysely<IBaseVcsDatabase>;
type Checkpoint = {
  base_name: string;
  captured_at: Date | string;
  tables: TableRef[];
  contains_foreign_references: boolean;
};

// BYODB transactions include public in search_path. A missing tenant migration must
// never resolve a checkpoint or object table from that fallback schema.
const checkpointTablesPresent = sql<boolean>`
  to_regclass(format('%I.base_vcs_checkpoint', current_schema())) IS NOT NULL AND
  to_regclass(format('%I.base_vcs_object', current_schema())) IS NOT NULL`;

/** Objects and the revision root become visible with the head advancement. */
export async function captureCheckpoint(
  trx: Transaction<IBaseVcsDatabase>,
  ctx: IExecutionContext,
  baseId: BaseId,
  revision: number,
  capture: VcsCheckpointCapture
): Promise<Result<void, DomainError>> {
  // A push can be called inside an existing batch. PostgreSQL cannot upgrade that
  // batch's isolation after its first query. Fail closed before reading any pages.
  const isolation = await sql<{ level: string; present: boolean; xmin: string; xid: string }>`
    SELECT current_setting('transaction_isolation') AS level, ${checkpointTablesPresent} AS present,
      least(pg_snapshot_xmin(pg_current_snapshot()), pg_current_xact_id())::text AS xmin,
      pg_current_xact_id()::text AS xid
  `.execute(trx);
  if (!isolation.rows[0].present) {
    return err(
      vcsDomainError.infrastructure({
        code: 'vcs.checkpoint_schema_missing',
        message: 'The data schema requires the VCS checkpoint migration.',
      })
    );
  }
  if (!['repeatable read', 'serializable'].includes(isolation.rows[0].level)) {
    return err(
      vcsDomainError.invariant({
        code: 'vcs.checkpoint_isolation_required',
        message: 'Capturing a VCS revision requires a repeatable-read transaction.',
      })
    );
  }
  const base = baseId.toString();
  const previous =
    capture.withRecordSelection && revision > 0
      ? await sql<Pick<Checkpoint, 'tables'>>`
        SELECT tables FROM base_vcs_checkpoint WHERE base_id = ${base} AND revision = ${revision - 1}
      `.execute(trx)
      : undefined;
  const { xmin, xid } = isolation.rows[0];
  const reuse = new CheckpointReuse(trx, base, previous?.rows[0]?.tables ?? [], xmin, xid);
  const result = capture.withRecordSelection
    ? await capture.withRecordSelection(ctx, baseId, revision, reuse.select)
    : await capture(ctx, baseId, revision);
  if (result.isErr()) return err(result.error);
  const snapshot = result.value;
  if (snapshot.accessScope || snapshot.baseId !== base || snapshot.revision !== revision) {
    return err(
      vcsDomainError.invariant({
        code: 'vcs.invalid_checkpoint',
        message: 'Expected a complete snapshot of the committing base and revision.',
      })
    );
  }
  const tables: TableRef[] = [];
  for (const table of snapshot.tables) {
    const { ref, objects } = reuse.encode(table);
    tables.push(ref);
    if (!objects.size) continue;
    const existing = await sql<{ hash: string }>`
      SELECT hash FROM base_vcs_object WHERE base_id = ${base} AND hash = ANY(${[...objects.keys()]}::text[])
    `.execute(trx);
    for (const row of existing.rows) objects.delete(row.hash);
    const entries = [...objects];
    for (let i = 0; i < entries.length; i += 64) {
      const values = entries
        .slice(i, i + 64)
        .map(([key, json]) => sql`(${base}, ${key}, ${json}::jsonb)`);
      await sql`
        INSERT INTO base_vcs_object (base_id, hash, payload) VALUES ${sql.join(values)}
        ON CONFLICT (base_id, hash) DO NOTHING
      `.execute(trx);
    }
  }
  tables.sort((a, b) => a.id.localeCompare(b.id));
  await sql`
    INSERT INTO base_vcs_checkpoint
      (base_id, revision, base_name, captured_at, tables, contains_foreign_references)
    VALUES (${base}, ${revision}, ${snapshot.baseName}, ${snapshot.capturedAt}::timestamptz,
      ${JSON.stringify(tables)}::jsonb, ${containsForeignReferences(snapshot)})
  `.execute(trx);
  return ok(undefined);
}

async function readCheckpoint(
  db: Database,
  base: string,
  revision: number
): Promise<Result<Checkpoint, DomainError>> {
  const exists = await sql<{ present: boolean }>`
    SELECT ${checkpointTablesPresent} AS present
  `.execute(db);
  const unavailable = () =>
    vcsDomainError.notFound({
      code: 'vcs.history_unavailable',
      message: `No checkpoint for revision ${revision}.`,
      details: { baseId: base, revision },
    });
  if (!exists.rows[0].present) return err(unavailable());
  const rows = await sql<Checkpoint>`
    SELECT base_name, captured_at, tables, contains_foreign_references FROM base_vcs_checkpoint
    WHERE base_id = ${base} AND revision = ${revision}
  `.execute(db);
  const root = rows.rows[0];
  if (!root) return err(unavailable());
  return ok(root);
}

export async function readCheckpointTableIds(
  db: Database,
  base: string,
  revision: number
): Promise<Result<readonly string[], DomainError>> {
  const root = await readCheckpoint(db, base, revision);
  return root.map((checkpoint) => checkpoint.tables.map((table) => table.id));
}

async function readObjects<T>(db: Database, base: string, hashes: Set<string>) {
  const objects = new Map<string, T>();
  if (hashes.size) {
    const result = await sql<{ hash: string; payload: T }>`
      SELECT hash, payload FROM base_vcs_object WHERE base_id = ${base} AND hash = ANY(${[...hashes]}::text[])
    `.execute(db);
    for (const row of result.rows) objects.set(row.hash, row.payload);
    if (objects.size !== hashes.size) throw new Error('VCS checkpoint references missing objects');
  }
  return objects;
}

function snapshotFromTables(
  baseId: string,
  revision: number,
  root: Checkpoint,
  tables: ITableVcsSnapshot[]
): IBaseVcsSnapshot {
  return {
    baseId,
    baseName: root.base_name,
    revision,
    formatVersion: 1,
    capturedAt: new Date(root.captured_at).toISOString(),
    tables,
  };
}

function recordChunkHashes(manifest: IVcsTableManifest, ids: ReadonlySet<string>) {
  if (!manifest.chunkPrefixes) return new Set(manifest.chunks);
  const byPrefix = new Map(manifest.chunkPrefixes.map((prefix, i) => [prefix, manifest.chunks[i]]));
  const hashes = new Set<string>();
  for (const id of ids) {
    const key = checkpointRecordKey(id);
    for (let length = 0; length <= key.length; length++) {
      const hash = byPrefix.get(key.slice(0, length));
      if (hash) {
        hashes.add(hash);
        break;
      }
    }
  }
  return hashes;
}

async function readSelectedRecordChunks(
  db: Database,
  base: string,
  hashes: ReadonlySet<string>,
  ids: ReadonlySet<string>
): Promise<ReadonlyMap<string, readonly IRecordVcsSnapshot[]>> {
  const records = new Map<string, IRecordVcsSnapshot[]>();
  if (!hashes.size) return records;
  // Keep unrelated rows in PostgreSQL, including when a legacy manifest needs a chunk scan.
  const { rows } = await sql<{ hash: string; records: IRecordVcsSnapshot[] }>`
    SELECT hash, COALESCE((
      SELECT jsonb_agg(item.value) FROM jsonb_array_elements(payload) AS item(value)
      WHERE item.value ->> 'id' = ANY(${[...ids]}::text[])
    ), '[]'::jsonb) AS records
    FROM base_vcs_object WHERE base_id = ${base} AND hash = ANY(${[...hashes]}::text[])
  `.execute(db);
  for (const row of rows) records.set(row.hash, row.records);
  // Every required chunk must exist to prove a requested record is absent.
  if (records.size !== hashes.size) throw new Error('VCS checkpoint references missing objects');
  return records;
}

export async function readHistoricalSelection(
  db: Database,
  base: string,
  revision: number,
  selectRecords?: SelectHistoricalCheckpointRecords
): Promise<Result<IBaseVcsSnapshot, DomainError>> {
  const root = await readCheckpoint(db, base, revision);
  if (root.isErr()) return err(root.error);
  const manifests = await readObjects<IVcsTableManifest>(
    db,
    base,
    new Set(root.value.tables.map(({ hash }) => hash))
  );
  const tables: ITableVcsSnapshot[] = root.value.tables.map(({ hash }) => ({
    ...manifests.get(hash)!.schema,
    records: [],
  }));
  const schema = snapshotFromTables(base, revision, root.value, tables);
  if (!selectRecords) return ok(schema);
  const selection = selectRecords(schema);
  if (selection.isErr()) return err(selection.error);

  const hashes = new Set<string>();
  const idsToRead = new Set<string>();
  const selected: Array<{
    index: number;
    ids: ReadonlySet<string>;
    needed: ReadonlySet<string>;
  }> = [];
  for (const [index, { id, hash }] of root.value.tables.entries()) {
    const ids = selection.value.get(id);
    if (!ids?.size) continue;
    const needed = recordChunkHashes(manifests.get(hash)!, ids);
    if (!needed.size) continue;
    for (const chunk of needed) hashes.add(chunk);
    for (const id of ids) idsToRead.add(id);
    selected.push({ index, ids, needed });
  }
  const chunks = await readSelectedRecordChunks(db, base, hashes, idsToRead);
  for (const { index, ids, needed } of selected) {
    const records: IRecordVcsSnapshot[] = [];
    for (const hash of needed) {
      for (const row of chunks.get(hash)!) if (ids.has(row.id)) records.push(row);
    }
    records.sort((a, b) => a.id.localeCompare(b.id));
    tables[index] = { ...tables[index], records };
  }
  return ok(schema);
}

function materializeTable(
  manifest: IVcsTableManifest,
  chunks: ReadonlyMap<string, readonly IRecordVcsSnapshot[]>
) {
  const records = manifest.chunks.flatMap((hash) => chunks.get(hash) ?? []);
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { ...manifest.schema, records };
}

export async function readSnapshot(
  db: Database,
  base: string,
  revision: number
): Promise<Result<IBaseVcsSnapshot, DomainError>> {
  const root = await readCheckpoint(db, base, revision);
  if (root.isErr()) return err(root.error);
  const manifests = await readObjects<IVcsTableManifest>(
    db,
    base,
    new Set(root.value.tables.map((table) => table.hash))
  );
  const chunkHashes = new Set<string>();
  for (const manifest of manifests.values()) {
    for (const hash of manifest.chunks) chunkHashes.add(hash);
  }
  const chunks = await readObjects<IRecordVcsSnapshot[]>(db, base, chunkHashes);
  const tables = root.value.tables.map((table) =>
    materializeTable(manifests.get(table.hash)!, chunks)
  );
  return ok(snapshotFromTables(base, revision, root.value, tables));
}

async function findMergeBase(db: Database, base: string, from: number, to: number) {
  const older = Math.min(from, to);
  const newer = Math.max(from, to);
  const edge = await sql<{ direct: boolean }>`
    SELECT ${older}::bigint = ANY(CASE WHEN cardinality(parents) > 0 THEN parents
      ELSE ARRAY[parent_revision] END) AS direct
    FROM base_vcs_commit WHERE base_id = ${base} AND revision = ${newer}
  `.execute(db);
  if (edge.rows[0]?.direct) return older;
  // Revisions increase along each parent edge. The greatest common ancestor by
  // revision is therefore a lowest common ancestor, including criss-cross ties.
  const result = await sql<{ revision: string | null }>`
    WITH RECURSIVE ancestors(side, revision) AS (
      VALUES (0, ${from}::bigint), (1, ${to}::bigint)
      UNION
      SELECT a.side, p.revision FROM ancestors a
      JOIN base_vcs_commit c ON c.base_id = ${base} AND c.revision = a.revision
      CROSS JOIN LATERAL unnest(CASE WHEN cardinality(c.parents) > 0 THEN c.parents
        ELSE ARRAY[c.parent_revision] END) p(revision)
      WHERE p.revision < a.revision
    )
    SELECT max(revision)::text AS revision FROM (
      SELECT revision FROM ancestors GROUP BY revision HAVING count(*) = 2
    ) common
  `.execute(db);
  const revision = result.rows[0].revision;
  return revision === null ? null : Number(revision);
}

/** Build the inputs for a scoped diff from the already compared cells. A link to a
 * row outside those cells also needs proof of historical membership in its table. */
async function projectionCandidates(
  db: Database,
  patch: IBaseVcsPatch,
  before: IBaseVcsSnapshot,
  after: IBaseVcsSnapshot,
  refs: ReadonlyMap<string, string>,
  manifests: Map<string, IVcsTableManifest>,
  chunks: Map<string, IRecordVcsSnapshot[]>
): Promise<IVcsRevisionComparison['projectionCandidates']> {
  // Membership or link-schema changes can affect the projection of otherwise equal
  // rows (including inbound links in an unchanged table). Use complete endpoints then.
  if (patch.tablesAdded.length || patch.tablesDeleted.length) return undefined;
  const oldTables = new Map(before.tables.map((t) => [t.id, t]));
  const newTables = new Map(after.tables.map((t) => [t.id, t]));
  const left = new Map<string, ITableVcsSnapshot>();
  const right = new Map<string, ITableVcsSnapshot>();
  const targets = new Map<string, Set<string>>();
  for (const change of patch.tablesUpdated) {
    const a = oldTables.get(change.tableId)!;
    const b = newTables.get(change.tableId)!;
    if (
      change.recordsAdded.length ||
      change.recordsDeleted.length ||
      a.primaryFieldId !== b.primaryFieldId ||
      change.fieldsUpdated.some(
        ({ before: f, after: g }) =>
          f.type === 'link' || g.type === 'link' || isStoredVcsField(f) !== isStoredVcsField(g)
      )
    ) {
      return undefined;
    }
    const linkTargets = new Map(
      b.fields.filter((f) => f.type === 'link').map((f) => [f.id, f.options])
    );
    const rowsBefore: IRecordVcsSnapshot[] = [];
    const rowsAfter: IRecordVcsSnapshot[] = [];
    for (const row of change.recordsUpdated) {
      const oldCells: Record<string, unknown> = {};
      const newCells: Record<string, unknown> = {};
      for (const cell of row.cellChanges) {
        oldCells[cell.fieldId] = cell.before;
        newCells[cell.fieldId] = cell.after;
        const options = linkTargets.get(cell.fieldId);
        const target = options?.foreignTableId;
        if (
          typeof target !== 'string' ||
          !refs.has(target) ||
          (options?.baseId != null && options.baseId !== before.baseId)
        )
          continue;
        const ids = targets.get(target) ?? new Set<string>();
        for (const value of [cell.before, cell.after]) {
          for (const item of Array.isArray(value) ? value : [value]) {
            const id = typeof item === 'string' ? item : item?.id;
            if (typeof id === 'string') ids.add(id);
          }
        }
        targets.set(target, ids);
      }
      rowsBefore.push({ id: row.recordId, fields: oldCells });
      rowsAfter.push({ id: row.recordId, fields: newCells });
    }
    left.set(a.id, { ...a, records: rowsBefore });
    right.set(b.id, { ...b, records: rowsAfter });
  }
  const missingManifests = new Set(
    [...targets.keys()].map((id) => refs.get(id)!).filter((hash) => !manifests.has(hash))
  );
  const found = await readObjects<IVcsTableManifest>(db, before.baseId, missingManifests);
  for (const [hash, manifest] of found) {
    manifests.set(hash, manifest);
  }
  for (const [id, ids] of targets) {
    const manifest = manifests.get(refs.get(id)!)!;
    const needed = recordChunkHashes(manifest, ids);
    const missing = new Set([...needed].filter((hash) => !chunks.has(hash)));
    for (const [hash, rows] of await readObjects<IRecordVcsSnapshot[]>(
      db,
      before.baseId,
      missing
    )) {
      chunks.set(hash, rows);
    }
    const present = new Set<string>();
    for (const hash of needed) {
      for (const row of chunks.get(hash)!) if (ids.has(row.id)) present.add(row.id);
    }
    for (const endpoint of [left, right]) {
      const table = endpoint.get(id) ?? { ...manifest.schema, records: [] };
      const records = [...table.records];
      const included = new Set(records.map((r) => r.id));
      for (const row of present) if (!included.has(row)) records.push({ id: row, fields: {} });
      endpoint.set(id, { ...table, records });
    }
  }
  return {
    before: { ...before, tables: [...left.values()] },
    after: { ...after, tables: [...right.values()] },
  };
}

export async function compareRevisions(
  db: Database,
  base: string,
  from: number,
  to: number
): Promise<Result<IVcsRevisionComparison, DomainError>> {
  const before = await readCheckpoint(db, base, from);
  if (before.isErr()) return err(before.error);
  const after = from === to ? before : await readCheckpoint(db, base, to);
  if (after.isErr()) return err(after.error);
  const left = new Map(before.value.tables.map((ref) => [ref.id, ref.hash]));
  const right = new Map(after.value.tables.map((ref) => [ref.id, ref.hash]));
  const changed = [...new Set([...left.keys(), ...right.keys()])].filter(
    (id) => left.get(id) !== right.get(id)
  );
  const tableHashes = new Set<string>();
  for (const id of changed) {
    if (left.has(id)) tableHashes.add(left.get(id)!);
    if (right.has(id)) tableHashes.add(right.get(id)!);
  }
  const manifests = await readObjects<IVcsTableManifest>(db, base, tableHashes);
  const beforeTables: ITableVcsSnapshot[] = [];
  const afterTables: ITableVcsSnapshot[] = [];
  const loadedChunks = new Map<string, IRecordVcsSnapshot[]>();
  for (const id of changed) {
    const a = manifests.get(left.get(id)!);
    const b = manifests.get(right.get(id)!);
    const aHashes = new Set(a?.chunks);
    const bHashes = new Set(b?.chunks);
    const needed = new Set([...aHashes, ...bHashes]);
    if (a && b) {
      // Equal raw chunks can differ in the patch only if a formerly computed
      // value is now included by diffSnapshots. Ordinary schema edits skip them.
      const afterComputed = new Set(
        b.schema.fields.filter((f) => !isStoredVcsField(f)).map((f) => f.id)
      );
      const beforeComputed = a.schema.fields.filter((f) => !isStoredVcsField(f)).map((f) => f.id);
      for (const hash of aHashes) {
        if (!bHashes.has(hash)) continue;
        const populated = a.computedFieldsByChunk
          ? (a.computedFieldsByChunk[hash] ?? [])
          : beforeComputed;
        if (populated.every((id) => afterComputed.has(id))) needed.delete(hash);
      }
    }
    const chunks = await readObjects<IRecordVcsSnapshot[]>(db, base, needed);
    for (const [hash, rows] of chunks) loadedChunks.set(hash, rows);
    if (a) beforeTables.push(materializeTable(a, chunks));
    if (b) afterTables.push(materializeTable(b, chunks));
  }
  const beforeSnapshot = snapshotFromTables(base, from, before.value, beforeTables);
  const afterSnapshot = snapshotFromTables(base, to, after.value, afterTables);
  const patch = diffSnapshots(beforeSnapshot, afterSnapshot);
  const candidates = await projectionCandidates(
    db,
    patch,
    beforeSnapshot,
    afterSnapshot,
    left,
    manifests,
    loadedChunks
  );
  const mergeBase = from === to ? from : await findMergeBase(db, base, from, to);
  return ok({
    patch,
    summary: summarizePatch(patch),
    mergeBase,
    ...(candidates ? { projectionCandidates: candidates } : {}),
    containsForeignReferences:
      before.value.contains_foreign_references !== false ||
      after.value.contains_foreign_references !== false,
  });
}

import {
  canonicalizeRecord,
  isStoredVcsField,
  type IRecordVcsSnapshot,
  type ITableVcsSnapshot,
} from '@teable/v2-vcs';
import {
  checkpointRecordKey,
  encodeCheckpointObject,
  encodeCheckpointTable,
  type IVcsTableManifest,
  type SelectCheckpointRecords,
} from '@teable/v2-vcs/server';
import { sql, type Kysely } from 'kysely';

import type { IBaseVcsDatabase } from './PostgresBaseVcsLogRepository';

// Hints live in the revision root, outside the content-addressed table hash. Older
// roots have no hints and can always be materialized or used for a full capture.
export type TableRef = {
  id: string;
  hash: string;
  reuse?: { layout: string; xmin: string; count: number };
};

type PartialTable = {
  parent: TableRef;
  manifest: IVcsTableManifest;
  chunks: Map<string, readonly IRecordVcsSnapshot[]>;
  selected: Set<string>;
};

const MAX_CHANGED_ROWS = 512;
const localStoredTypes: Readonly<Record<string, true>> = {
  singleLineText: true,
  longText: true,
  number: true,
  rating: true,
  checkbox: true,
  date: true,
  singleSelect: true,
  multipleSelect: true,
};

export class CheckpointReuse {
  private readonly parents: Map<string, TableRef>;
  private readonly layouts = new Map<string, string>();
  private readonly unchanged = new Map<string, TableRef>();
  private readonly partial = new Map<string, PartialTable>();

  constructor(
    private readonly db: Kysely<IBaseVcsDatabase>,
    private readonly base: string,
    parents: readonly TableRef[],
    private readonly xmin: string,
    private readonly xid: string
  ) {
    this.parents = new Map(parents.map((ref) => [ref.id, ref]));
  }

  readonly select: SelectCheckpointRecords = async (table, fieldColumns) => {
    // Stored formula reads use a physical column. The reader excludes errored
    // fields whose output can change without a new tuple. Links may depend on other tables.
    if (
      !table.dbTableName ||
      !table.fields.every(
        (field) =>
          field.type === 'formula' ||
          (isStoredVcsField(field) && localStoredTypes[field.type] === true)
      )
    ) {
      return undefined;
    }
    const parts = table.dbTableName.split('.');
    if (parts.length !== 2) return undefined;
    const [schema, name] = parts;
    const catalog = await sql<{
      instance: string;
      database: string;
      oid: string;
      file: string;
      columns: unknown;
    }>`
      SELECT pg_postmaster_start_time()::text AS instance,
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database,
        c.oid::text, c.relfilenode::text AS file,
        jsonb_agg(ARRAY[a.attnum::text, a.attname::text, a.atttypid::text, a.atttypmod::text]
          ORDER BY a.attnum) AS columns
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_am am ON am.oid = c.relam AND am.amname = 'heap'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = ${schema} AND c.relname = ${name} AND c.relkind = 'r'
        AND NOT c.relhassubclass AND NOT c.relrowsecurity
      GROUP BY c.oid, c.relfilenode
      HAVING bool_and(a.attgenerated IN ('', 's'))
    `.execute(this.db);
    if (!catalog.rows[0]) return undefined;
    const layout = encodeCheckpointObject([table, fieldColumns, catalog.rows[0]]).hash;
    this.layouts.set(table.id, layout);
    const parent = this.parents.get(table.id);
    if (!parent?.reuse || layout !== parent.reuse.layout) return undefined;

    // age(xmin) uses the current top-level XID. A tuple created after the
    // parent's snapshot (including an already-running writer or a savepoint)
    // cannot be older than its xmin. Stay inside PostgreSQL's signed XID window.
    const distance = BigInt(this.xid) - BigInt(parent.reuse.xmin);
    if (distance < 0n || distance >= 2147483647n) return undefined;
    const relation = sql.id(schema, name);
    const checked = await sql<{ count: string; changed: string[] }>`
      SELECT (SELECT count(*)::text FROM ${relation}) AS count,
        ARRAY(SELECT __id FROM ${relation} WHERE xmin = '2'::xid OR age(xmin) <= ${Number(distance)}
          LIMIT ${MAX_CHANGED_ROWS + 1}) AS changed
    `.execute(this.db);
    const { count, changed } = checked.rows[0];
    if (Number(count) !== parent.reuse.count || changed.length > MAX_CHANGED_ROWS) return undefined;
    if (!changed.length) {
      this.unchanged.set(table.id, parent);
      return [];
    }
    // Full encoding rebuilds the per-chunk index of populated computed fields.
    if (table.fields.some((field) => !isStoredVcsField(field))) return undefined;

    const result = await sql<{ payload: IVcsTableManifest }>`
      SELECT payload FROM base_vcs_object WHERE base_id = ${this.base} AND hash = ${parent.hash}
    `.execute(this.db);
    const manifest = result.rows[0]?.payload;
    if (!manifest?.chunkPrefixes || manifest.chunkPrefixes.length !== manifest.chunks.length) {
      return undefined;
    }
    const byPrefix = new Map(
      manifest.chunkPrefixes.map((prefix, i) => [prefix, manifest.chunks[i]] as const)
    );
    const hashes = new Set<string>();
    for (const id of changed) {
      const key = checkpointRecordKey(id);
      let hash: string | undefined;
      for (let depth = 0; depth <= key.length && !hash; depth++) {
        hash = byPrefix.get(key.slice(0, depth));
      }
      if (!hash) return undefined;
      hashes.add(hash);
    }
    const chunks = await sql<{ hash: string; payload: IRecordVcsSnapshot[] }>`
      SELECT hash, payload FROM base_vcs_object WHERE base_id = ${this.base}
        AND hash = ANY(${[...hashes]}::text[])
    `.execute(this.db);
    const members = new Set(chunks.rows.flatMap((chunk) => chunk.payload.map((r) => r.id)));
    // Every possible insert is among changed. Equal counts plus proof that each
    // candidate already existed rules out deletes, including delete+insert pairs.
    if (chunks.rows.length !== hashes.size || !changed.every((id) => members.has(id))) {
      return undefined;
    }
    this.partial.set(table.id, {
      parent,
      manifest,
      chunks: new Map(chunks.rows.map((chunk) => [chunk.hash, chunk.payload])),
      selected: new Set(changed),
    });
    return changed;
  };

  encode(table: ITableVcsSnapshot): { ref: TableRef; objects: Map<string, string> } {
    const layout = this.layouts.get(table.id);
    const unchanged = this.unchanged.get(table.id);
    if (unchanged?.reuse) {
      return {
        ref: { ...unchanged, reuse: { ...unchanged.reuse, xmin: this.xmin } },
        objects: new Map(),
      };
    }
    const delta = this.partial.get(table.id);
    if (!delta) {
      const { hash, objects } = encodeCheckpointTable(table);
      const reuse = layout ? { layout, xmin: this.xmin, count: table.records.length } : undefined;
      return { ref: { id: table.id, hash, reuse }, objects };
    }
    const updates = new Map(
      table.records.map(
        (row) => [row.id, canonicalizeRecord(row, undefined, { preserveComputed: true })] as const
      )
    );
    if (
      updates.size !== delta.selected.size ||
      !table.records.every((row) => delta.selected.has(row.id))
    ) {
      throw new Error('VCS checkpoint reader returned an incomplete selection');
    }
    const objects = new Map<string, string>();
    const chunks = delta.manifest.chunks.map((hash) => {
      const rows = delta.chunks.get(hash);
      if (!rows) return hash;
      const encoded = encodeCheckpointObject(rows.map((row) => updates.get(row.id) ?? row));
      if (encoded.hash !== hash) objects.set(encoded.hash, encoded.payload);
      return encoded.hash;
    });
    const manifest = encodeCheckpointObject({ ...delta.manifest, chunks });
    objects.set(manifest.hash, manifest.payload);
    const reuse = { ...delta.parent.reuse!, xmin: this.xmin };
    return { ref: { id: table.id, hash: manifest.hash, reuse }, objects };
  }
}

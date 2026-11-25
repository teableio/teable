import { createHash } from 'node:crypto';

import { canonicalizeTable, canonicalizeValue, isStoredVcsField } from './fieldClassification';
import type { IRecordVcsSnapshot, ITableVcsSnapshot } from './types';

export interface IVcsTableManifest {
  readonly schema: Omit<ITableVcsSnapshot, 'records'>;
  readonly chunks: readonly string[];
  /** Parallel to chunks. The empty prefix covers an unsplit table. */
  readonly chunkPrefixes?: readonly string[];
  /** Populated computed fields per chunk. Older manifests omit this index. */
  readonly computedFieldsByChunk?: Readonly<Record<string, readonly string[]>>;
}

const MAX_CHUNK_RECORDS = 256;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

// Split oversized chunks by successive nibbles of the record ID digest. Inserts only
// repartition their own bucket. Records within each bucket are in canonical ID order.
function* recordChunks(
  entries: readonly { key: string; record: IRecordVcsSnapshot }[],
  prefix: string
): Generator<{ prefix: string; rows: readonly IRecordVcsSnapshot[] }> {
  if (entries.length <= MAX_CHUNK_RECORDS || prefix.length === 64) {
    if (entries.length) yield { prefix, rows: entries.map((entry) => entry.record) };
    return;
  }
  const buckets = new Map<string, (typeof entries)[number][]>();
  for (const entry of entries) {
    const key = entry.key.charAt(prefix.length);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  for (const key of [...buckets.keys()].sort()) {
    yield* recordChunks(buckets.get(key)!, prefix + key);
  }
}

export function encodeCheckpointObject(value: unknown) {
  const payload = JSON.stringify(canonicalizeValue(value));
  return { hash: digest(payload), payload };
}

export function checkpointRecordKey(id: string) {
  return digest(id);
}

export function encodeCheckpointTable(table: ITableVcsSnapshot) {
  const { records, ...schema } = canonicalizeTable(table, { preserveComputed: true });
  const objects = new Map<string, string>();
  const chunks: string[] = [];
  const chunkPrefixes: string[] = [];
  const computedIds = new Set(
    schema.fields.filter((field) => !isStoredVcsField(field)).map((field) => field.id)
  );
  const computedFieldsByChunk: Record<string, string[]> = {};
  for (const { prefix, rows: chunk } of recordChunks(
    records.map((record) => ({ key: digest(record.id), record })),
    ''
  )) {
    const { payload, hash } = encodeCheckpointObject(chunk);
    chunkPrefixes.push(prefix);
    objects.set(hash, payload);
    chunks.push(hash);
    if (computedIds.size) {
      const populated = new Set<string>();
      for (const record of chunk) {
        for (const id of Object.keys(record.fields)) if (computedIds.has(id)) populated.add(id);
        if (populated.size === computedIds.size) break;
      }
      if (populated.size) computedFieldsByChunk[hash] = [...populated].sort();
    }
  }
  const manifest: IVcsTableManifest = { schema, chunks, chunkPrefixes, computedFieldsByChunk };
  const { payload, hash } = encodeCheckpointObject(manifest);
  objects.set(hash, payload);
  return { hash, objects };
}

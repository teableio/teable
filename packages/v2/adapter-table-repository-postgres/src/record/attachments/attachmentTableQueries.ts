import type { Kysely } from 'kysely';

import type { DynamicDB } from '../query-builder';

export type AttachmentTableRefRow = {
  id: string;
  attachmentId: string;
  token: string;
  name: string;
  tableId: string;
  recordId: string;
  fieldId: string;
};

type AttachmentTableQueryFilter = {
  tableIds?: ReadonlyArray<string>;
  attachmentIds?: ReadonlyArray<string>;
};

type AttachmentTableQueryRow = {
  id: unknown;
  attachment_id: unknown;
  token: unknown;
  name: unknown;
  table_id: unknown;
  record_id: unknown;
  field_id: unknown;
};

const toRefRow = (row: AttachmentTableQueryRow): AttachmentTableRefRow => ({
  id: String(row.id),
  attachmentId: String(row.attachment_id),
  token: String(row.token),
  name: String(row.name ?? ''),
  tableId: String(row.table_id),
  recordId: String(row.record_id),
  fieldId: String(row.field_id),
});

const cellKey = (row: Pick<AttachmentTableRefRow, 'tableId' | 'recordId' | 'fieldId'>) =>
  `${row.tableId}:${row.recordId}:${row.fieldId}`;

const queryAttachmentTableRefs = async (
  db: Kysely<DynamicDB>,
  filter: AttachmentTableQueryFilter
): Promise<AttachmentTableRefRow[]> => {
  let query = db
    .selectFrom('attachments_table')
    .select(['id', 'attachment_id', 'token', 'name', 'table_id', 'record_id', 'field_id']);

  if (filter.tableIds?.length) {
    query = query.where('table_id', 'in', [...filter.tableIds]);
  }
  if (filter.attachmentIds?.length) {
    query = query.where('attachment_id', 'in', [...filter.attachmentIds]);
  }

  const rows = (await query.execute()) as AttachmentTableQueryRow[];
  return rows
    .filter(
      (row) =>
        row.id != null &&
        row.attachment_id != null &&
        row.token != null &&
        row.table_id != null &&
        row.record_id != null &&
        row.field_id != null
    )
    .map(toRefRow);
};
export type AttachmentTableQueryOptions = {
  pageSize?: number;
  signal?: AbortSignal;
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
  }
};

const queryAttachmentTableRefsPage = async (
  db: Kysely<DynamicDB>,
  filter: AttachmentTableQueryFilter,
  pageSize: number,
  cursor: string | undefined,
  signal?: AbortSignal
): Promise<AttachmentTableQueryRow[]> => {
  throwIfAborted(signal);
  let query = db
    .selectFrom('attachments_table')
    .select(['id', 'attachment_id', 'token', 'name', 'table_id', 'record_id', 'field_id']);

  if (filter.tableIds?.length) {
    query = query.where('table_id', 'in', [...filter.tableIds]);
  }
  if (filter.attachmentIds?.length) {
    query = query.where('attachment_id', 'in', [...filter.attachmentIds]);
  }
  if (cursor !== undefined) {
    query = query.where('id', '>', cursor);
  }

  const rows = await query.orderBy('id', 'asc').limit(pageSize).execute();
  throwIfAborted(signal);
  return rows as AttachmentTableQueryRow[];
};

const queryAttachmentTableCellKeys = async (
  db: Kysely<DynamicDB>,
  cells: ReadonlyArray<Pick<AttachmentTableRefRow, 'tableId' | 'recordId' | 'fieldId'>>,
  signal?: AbortSignal
): Promise<Set<string>> => {
  throwIfAborted(signal);
  if (cells.length === 0) {
    return new Set();
  }

  const query = db
    .selectFrom('attachments_table')
    .select(['table_id', 'record_id', 'field_id'])
    .distinct()
    .where((eb) =>
      eb.or(
        cells.map((cell) =>
          eb.and([
            eb('table_id', '=', cell.tableId),
            eb('record_id', '=', cell.recordId),
            eb('field_id', '=', cell.fieldId),
          ])
        )
      )
    );
  const rows = await query.execute();
  throwIfAborted(signal);
  return new Set(
    (rows as Array<{ table_id: unknown; record_id: unknown; field_id: unknown }>).map((row) =>
      cellKey({
        tableId: String(row.table_id),
        recordId: String(row.record_id),
        fieldId: String(row.field_id),
      })
    )
  );
};

const validRefRows = (rows: AttachmentTableQueryRow[]): AttachmentTableRefRow[] =>
  rows
    .filter(
      (row) =>
        row.id != null &&
        row.attachment_id != null &&
        row.token != null &&
        row.table_id != null &&
        row.record_id != null &&
        row.field_id != null
    )
    .map(toRefRow);

/**
 * Iterate attachment refs in bounded, stable-id pages. Data refs are yielded
 * before migrated meta-db fallback refs, with rewritten cells suppressing all
 * stale meta rows for that cell.
 */
export const iterateAttachmentTableRefs = async function* (
  dataDb: Kysely<DynamicDB>,
  metaDb: Kysely<DynamicDB>,
  filter: AttachmentTableQueryFilter,
  options: AttachmentTableQueryOptions = {}
): AsyncGenerator<readonly AttachmentTableRefRow[]> {
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError('Attachment table query pageSize must be a positive integer');
  }
  if (!filter.tableIds?.length && !filter.attachmentIds?.length) {
    return;
  }

  const { signal } = options;
  let cursor: string | undefined;
  while (true) {
    throwIfAborted(signal);
    const rawRows = await queryAttachmentTableRefsPage(dataDb, filter, pageSize, cursor, signal);
    throwIfAborted(signal);
    if (rawRows.length === 0) {
      break;
    }
    const lastRawId = rawRows[rawRows.length - 1]?.id;
    cursor = lastRawId == null ? undefined : String(lastRawId);
    const rows = validRefRows(rawRows);
    if (rows.length > 0) {
      yield rows;
    }
    if (lastRawId == null) {
      break;
    }
  }

  if (dataDb === metaDb) {
    return;
  }

  cursor = undefined;
  while (true) {
    throwIfAborted(signal);
    const rawRows = await queryAttachmentTableRefsPage(metaDb, filter, pageSize, cursor, signal);
    throwIfAborted(signal);
    if (rawRows.length === 0) {
      break;
    }
    const lastRawId = rawRows[rawRows.length - 1]?.id;
    cursor = lastRawId == null ? undefined : String(lastRawId);
    const metaRows = validRefRows(rawRows);
    if (metaRows.length > 0) {
      const dataCells = await queryAttachmentTableCellKeys(dataDb, metaRows, signal);
      throwIfAborted(signal);
      const rows = metaRows.filter((row) => !dataCells.has(cellKey(row)));
      if (rows.length > 0) {
        yield rows;
      }
    }
    if (lastRawId == null) {
      break;
    }
  }
};

export const mergeAttachmentTableRefs = (
  dataRows: AttachmentTableRefRow[],
  metaRows: AttachmentTableRefRow[]
): AttachmentTableRefRow[] => {
  // A rewritten cell always lives on dataDb with new row ids. Ignore leftover
  // meta rows for that cell so export/usage do not double-count the same files.
  const dataCells = new Set(dataRows.map(cellKey));
  return [...dataRows, ...metaRows.filter((row) => !dataCells.has(cellKey(row)))];
};

/**
 * `attachments_table` is a data-plane index of cell references. Writes run in the
 * record transaction on dataDb. `attachments` file metadata stays on metaDb.
 * BYODB spaces therefore have to read refs from dataDb (and leftover pre-bind
 * rows from metaDb until those are copied).
 */
export const listAttachmentTableRefs = async (
  dataDb: Kysely<DynamicDB>,
  metaDb: Kysely<DynamicDB>,
  filter: AttachmentTableQueryFilter
): Promise<AttachmentTableRefRow[]> => {
  if (!filter.tableIds?.length && !filter.attachmentIds?.length) {
    return [];
  }

  const dataRows = await queryAttachmentTableRefs(dataDb, filter);
  if (dataDb === metaDb) {
    return dataRows;
  }

  return mergeAttachmentTableRefs(dataRows, await queryAttachmentTableRefs(metaDb, filter));
};

export const listAttachmentTokensByTableIds = async (
  dataDb: Kysely<DynamicDB>,
  metaDb: Kysely<DynamicDB>,
  tableIds: ReadonlyArray<string>
): Promise<string[]> => {
  const refs = await listAttachmentTableRefs(dataDb, metaDb, { tableIds });
  return [...new Set(refs.map((ref) => ref.token).filter(Boolean))];
};

const deleteAttachmentTableRefs = async (
  db: Kysely<DynamicDB>,
  tableId: string,
  recordIds: ReadonlyArray<string>
): Promise<void> => {
  await db
    .deleteFrom('attachments_table')
    .where('table_id', '=', tableId)
    .where('record_id', 'in', [...recordIds])
    .execute();
};

const deleteAttachmentTableRefsByFieldIdsInDb = async (
  db: Kysely<DynamicDB>,
  tableId: string,
  fieldIds: ReadonlyArray<string>
): Promise<void> => {
  await db
    .deleteFrom('attachments_table')
    .where('table_id', '=', tableId)
    .where('field_id', 'in', [...fieldIds])
    .execute();
};

export const deleteAttachmentTableRefsByFieldIds = async (
  dataDb: Kysely<DynamicDB>,
  metaDb: Kysely<DynamicDB>,
  tableId: string,
  fieldIds: ReadonlyArray<string>
): Promise<void> => {
  if (fieldIds.length === 0) {
    return;
  }

  await deleteAttachmentTableRefsByFieldIdsInDb(dataDb, tableId, fieldIds);
  if (dataDb !== metaDb) {
    await deleteAttachmentTableRefsByFieldIdsInDb(metaDb, tableId, fieldIds);
  }
};

export const deleteAttachmentTableRefsByRecordIds = async (
  dataDb: Kysely<DynamicDB>,
  metaDb: Kysely<DynamicDB>,
  tableId: string,
  recordIds: ReadonlyArray<string>
): Promise<void> => {
  if (recordIds.length === 0) {
    return;
  }

  await deleteAttachmentTableRefs(dataDb, tableId, recordIds);
  if (dataDb !== metaDb) {
    await deleteAttachmentTableRefs(metaDb, tableId, recordIds);
  }
};

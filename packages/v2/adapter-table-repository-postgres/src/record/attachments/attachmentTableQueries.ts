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

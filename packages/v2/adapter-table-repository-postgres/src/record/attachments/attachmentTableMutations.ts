import { generatePrefixedId } from '@teable/v2-core';
import type { CompiledQuery, Kysely } from 'kysely';

import type { DynamicDB } from '../query-builder';

const ATTACHMENT_TABLE_ROW_ID_PREFIX = 'attt';
const ATTACHMENT_TABLE_ROW_ID_LENGTH = 16;

type AttachmentItemLike = {
  id?: string;
  token?: string;
  name?: string;
};

const normalizeAttachmentItems = (value: unknown): AttachmentItemLike[] => {
  if (Array.isArray(value)) {
    return value as AttachmentItemLike[];
  }
  if (value && typeof value === 'object') {
    return [value as AttachmentItemLike];
  }
  return [];
};

const toAttachmentTableRows = (params: {
  actorId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
  value: unknown;
}) => {
  const { actorId, tableId, recordId, fieldId, value } = params;

  return normalizeAttachmentItems(value)
    .map((item) => {
      const attachmentId = item.id ? String(item.id) : '';
      const token = item.token ? String(item.token) : '';
      if (!attachmentId || !token) {
        return null;
      }

      return {
        id: generatePrefixedId(ATTACHMENT_TABLE_ROW_ID_PREFIX, ATTACHMENT_TABLE_ROW_ID_LENGTH),
        attachment_id: attachmentId,
        token,
        name: item.name ? String(item.name) : '',
        table_id: tableId,
        record_id: recordId,
        field_id: fieldId,
        created_by: actorId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
};

export const buildAttachmentTableInsertQuery = (
  db: Kysely<DynamicDB>,
  params: {
    actorId: string;
    tableId: string;
    recordId: string;
    fieldId: string;
    value: unknown;
  }
): CompiledQuery | undefined => {
  const rows = toAttachmentTableRows(params);
  if (rows.length === 0) {
    return undefined;
  }

  return db.insertInto('attachments_table').values(rows).compile();
};

export const buildAttachmentTableReplaceQueries = (
  db: Kysely<DynamicDB>,
  params: {
    actorId: string;
    tableId: string;
    recordId: string;
    fieldId: string;
    value: unknown;
  }
): CompiledQuery[] => {
  const deleteQuery = db
    .deleteFrom('attachments_table')
    .where('table_id', '=', params.tableId)
    .where('record_id', '=', params.recordId)
    .where('field_id', '=', params.fieldId)
    .compile();

  const insertQuery = buildAttachmentTableInsertQuery(db, params);

  return insertQuery ? [deleteQuery, insertQuery] : [deleteQuery];
};

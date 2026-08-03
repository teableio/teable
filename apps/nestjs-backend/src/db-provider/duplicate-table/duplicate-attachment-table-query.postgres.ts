import type { Knex } from 'knex';
import { DuplicateAttachmentTableQueryAbstract } from './duplicate-attachment-table-query.abstract';

export class DuplicateAttachmentTableQueryPostgres extends DuplicateAttachmentTableQueryAbstract {
  protected knex: Knex.Client;
  constructor(queryBuilder: Knex.QueryBuilder) {
    super(queryBuilder);
    this.knex = queryBuilder.client;
  }

  duplicateAttachmentTable(
    sourceTableId: string,
    targetTableId: string,
    sourceFieldId: string,
    targetFieldId: string,
    userId: string
  ) {
    const attachmentTableDbName = 'attachments_table';
    const targetColumns = [
      'id',
      'attachment_id',
      'name',
      'token',
      'record_id',
      'table_id',
      'field_id',
      'created_by',
    ];

    const sourceColumns = [
      this.knex.raw(
        `(
        'cm' || 
        substr(md5(random()::text || clock_timestamp()::text), 1, 8) || 
        substr(md5(random()::text), 1, 15)
      )`
      ),
      'attachment_id',
      'name',
      'token',
      'record_id',
      this.knex.raw(`'${targetTableId}' AS table_id`),
      this.knex.raw(`'${targetFieldId}' AS field_id`),
      this.knex.raw(`'${userId}' AS created_by`),
    ];

    const newColumnList = targetColumns.map((col) => `"${col}"`).join(', ');
    const oldColumnList = sourceColumns
      .map((col) => {
        return typeof col === 'string' ? `"${col}"` : col;
      })
      .join(', ');
    return this.knex.raw(
      `INSERT INTO ?? (${newColumnList}) SELECT ${oldColumnList} FROM ?? WHERE field_id = ? and table_id = ?`,
      [attachmentTableDbName, attachmentTableDbName, sourceFieldId, sourceTableId]
    );
  }
}

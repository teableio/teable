import type { Knex } from 'knex';

export abstract class DuplicateAttachmentTableQueryAbstract {
  constructor(protected readonly queryBuilder: Knex.QueryBuilder) {}

  abstract duplicateAttachmentTable(
    sourceTableId: string,
    targetTableId: string,
    sourceFieldId: string,
    targetFieldId: string,
    userId: string
  ): Knex.QueryBuilder;
}

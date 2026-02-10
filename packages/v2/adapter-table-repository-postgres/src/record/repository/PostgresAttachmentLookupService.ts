import {
  domainError,
  type AttachmentLookupRecord,
  type DomainError,
  type IAttachmentLookupService,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';

@injectable()
export class PostgresAttachmentLookupService implements IAttachmentLookupService {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async listAttachmentsByTokens(
    tokens: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<AttachmentLookupRecord>, DomainError>> {
    const unique = [...new Set(tokens.filter(Boolean))];
    if (unique.length === 0) {
      return ok([]);
    }

    const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
    try {
      const rows = await dynamicDb
        .selectFrom('attachments')
        .select(['id', 'token', 'path', 'size', 'mimetype'])
        .where('token', 'in', unique)
        .execute();

      return ok(
        rows.map((row) => ({
          id: String(row.id),
          token: String(row.token),
          path: String(row.path),
          size: Number(row.size),
          mimetype: String(row.mimetype),
        }))
      );
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup attachments',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }

  async listAttachmentsByAttachmentIds(
    attachmentIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<AttachmentLookupRecord>, DomainError>> {
    const unique = [...new Set(attachmentIds.filter(Boolean))];
    if (unique.length === 0) {
      return ok([]);
    }

    const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
    try {
      const rows = await dynamicDb
        .selectFrom('attachments_table as attachmentsTable')
        .innerJoin('attachments as attachments', 'attachments.token', 'attachmentsTable.token')
        .select([
          'attachmentsTable.attachment_id as attachmentId',
          'attachmentsTable.name as name',
          'attachmentsTable.token as token',
          'attachments.path as path',
          'attachments.size as size',
          'attachments.mimetype as mimetype',
        ])
        .where('attachmentsTable.attachment_id', 'in', unique)
        .execute();

      return ok(
        rows.map((row) => ({
          id: String(row.attachmentId),
          attachmentId: String(row.attachmentId),
          name: String(row.name),
          token: String(row.token),
          path: String(row.path),
          size: Number(row.size),
          mimetype: String(row.mimetype),
        }))
      );
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to lookup attachments by attachmentId',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    }
  }
}

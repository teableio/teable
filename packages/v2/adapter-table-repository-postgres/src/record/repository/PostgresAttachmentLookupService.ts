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

const OPTIONAL_ATTACHMENT_COLUMNS = [
  { dbColumn: 'width', select: 'width' },
  { dbColumn: 'height', select: 'height' },
  { dbColumn: 'thumbnail_path', select: 'thumbnail_path as thumbnailPath' },
] as const;

const extractMissingColumn = (error: unknown): string | undefined => {
  const message = (error as Error)?.message ?? String(error);
  const match = message.match(/column "([^"]+)" does not exist/i);
  return match?.[1];
};

type AttachmentLookupByTokenRow = {
  id: string | number;
  token: string;
  path: string;
  size: string | number;
  mimetype: string;
  width?: string | number | null;
  height?: string | number | null;
  thumbnailPath?: string | null;
};

type AttachmentLookupByAttachmentIdRow = {
  attachmentId: string;
  name: string;
  token: string;
  path: string;
  size: string | number;
  mimetype: string;
  width?: string | number | null;
  height?: string | number | null;
  thumbnailPath?: string | null;
};

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
      const rows = await this.queryAttachmentsByTokens(dynamicDb, unique);

      return ok(
        rows.map((row: AttachmentLookupByTokenRow) => ({
          id: String(row.id),
          token: String(row.token),
          path: String(row.path),
          size: Number(row.size),
          mimetype: String(row.mimetype),
          width: row.width == null ? undefined : Number(row.width),
          height: row.height == null ? undefined : Number(row.height),
          thumbnailPath: parseThumbnailPath(row.thumbnailPath),
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
      const rows = await this.queryAttachmentsByAttachmentIds(dynamicDb, unique);

      return ok(
        rows.map((row: AttachmentLookupByAttachmentIdRow) => ({
          id: String(row.attachmentId),
          attachmentId: String(row.attachmentId),
          name: String(row.name),
          token: String(row.token),
          path: String(row.path),
          size: Number(row.size),
          mimetype: String(row.mimetype),
          width: row.width == null ? undefined : Number(row.width),
          height: row.height == null ? undefined : Number(row.height),
          thumbnailPath: parseThumbnailPath(row.thumbnailPath),
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

  private async queryAttachmentsByTokens(
    db: Kysely<DynamicDB>,
    tokens: ReadonlyArray<string>,
    excludedColumns: ReadonlySet<string> = new Set()
  ): Promise<AttachmentLookupByTokenRow[]> {
    try {
      return (await db
        .selectFrom('attachments')
        .select([
          'id',
          'token',
          'path',
          'size',
          'mimetype',
          ...OPTIONAL_ATTACHMENT_COLUMNS.filter(
            ({ dbColumn }) => !excludedColumns.has(dbColumn)
          ).map(({ select }) => select),
        ])
        .where('token', 'in', tokens)
        .execute()) as AttachmentLookupByTokenRow[];
    } catch (error) {
      const missingColumn = extractMissingColumn(error);
      if (
        missingColumn &&
        OPTIONAL_ATTACHMENT_COLUMNS.some(({ dbColumn }) => dbColumn === missingColumn) &&
        !excludedColumns.has(missingColumn)
      ) {
        return this.queryAttachmentsByTokens(
          db,
          tokens,
          new Set([...excludedColumns, missingColumn])
        );
      }
      throw error;
    }
  }

  private async queryAttachmentsByAttachmentIds(
    db: Kysely<DynamicDB>,
    attachmentIds: ReadonlyArray<string>,
    excludedColumns: ReadonlySet<string> = new Set()
  ): Promise<AttachmentLookupByAttachmentIdRow[]> {
    try {
      return (await db
        .selectFrom('attachments_table as attachmentsTable')
        .innerJoin('attachments as attachments', 'attachments.token', 'attachmentsTable.token')
        .select([
          'attachmentsTable.attachment_id as attachmentId',
          'attachmentsTable.name as name',
          'attachmentsTable.token as token',
          'attachments.path as path',
          'attachments.size as size',
          'attachments.mimetype as mimetype',
          ...OPTIONAL_ATTACHMENT_COLUMNS.filter(
            ({ dbColumn }) => !excludedColumns.has(dbColumn)
          ).map(({ dbColumn, select }) =>
            dbColumn === 'thumbnail_path'
              ? `attachments.${select}`
              : `attachments.${dbColumn} as ${dbColumn}`
          ),
        ])
        .where('attachmentsTable.attachment_id', 'in', attachmentIds)
        .execute()) as AttachmentLookupByAttachmentIdRow[];
    } catch (error) {
      const missingColumn = extractMissingColumn(error);
      if (
        missingColumn &&
        OPTIONAL_ATTACHMENT_COLUMNS.some(({ dbColumn }) => dbColumn === missingColumn) &&
        !excludedColumns.has(missingColumn)
      ) {
        return this.queryAttachmentsByAttachmentIds(
          db,
          attachmentIds,
          new Set([...excludedColumns, missingColumn])
        );
      }
      throw error;
    }
  }
}

export const parseThumbnailPath = (
  value: unknown
):
  | {
      sm?: string;
      lg?: string;
    }
  | undefined => {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value) as { sm?: string; lg?: string };
  } catch {
    return undefined;
  }
};

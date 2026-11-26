import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

export interface AttachmentLookupRecord {
  id: string;
  attachmentId?: string;
  token: string;
  name?: string;
  path: string;
  size: number;
  mimetype: string;
  width?: number;
  height?: number;
  thumbnailPath?: {
    sm?: string;
    lg?: string;
  };
  /** Set when the file row is soft-deleted; read by the token lookup. */
  deleted?: boolean;
}

export interface IAttachmentLookupService {
  listAttachmentsByTokens(
    tokens: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<AttachmentLookupRecord>, DomainError>>;
  listAttachmentsByAttachmentIds(
    attachmentIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<AttachmentLookupRecord>, DomainError>>;
}

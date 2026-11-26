import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

/**
 * Signed URLs for a single attachment item.
 *
 * - `presignedUrl`: primary preview/download URL.
 * - `smThumbnailUrl` / `lgThumbnailUrl`: optional sized thumbnails. When the
 *   attachment is an image and the thumbnail has not been generated yet, the
 *   adapter MAY fall back to `presignedUrl` so callers always receive a
 *   renderable URL.
 */
export interface AttachmentSignedUrls {
  presignedUrl?: string;
  smThumbnailUrl?: string;
  lgThumbnailUrl?: string;
  /**
   * The file's stored row as the signer read it, null when the file has no live row; absent when
   * the signer could not read it. Public links of the same items reuse it instead of reading again.
   */
  file?: AttachmentStoredFile | null;
}

/** What the attachments table holds for a file. */
export interface AttachmentStoredFile {
  size: number;
  mimetype: string;
  thumbnailPath?: { sm?: string; lg?: string };
}

/**
 * Input for signing a single attachment item. Only the shape the adapter needs
 * is exposed here; the concrete `AttachmentItem` domain type is a superset.
 */
export interface AttachmentSignRequest {
  token: string;
  path: string;
  name?: string;
  mimetype: string;
}

/** An attachment item where it sits: links that belong to the cell, not to the file. */
export interface AttachmentPublicLinkRequest {
  tableId: string;
  recordId: string;
  fieldId: string;
  /** The item id in its cell. */
  attachmentId: string;
  token: string;
  mimetype?: string;
  size?: number;
  /** As `AttachmentSignedUrls.file`: when given, the host does not read the file again. */
  file?: AttachmentStoredFile | null;
}

/** Permanent public links of an attachment in a field with public links on. */
export interface AttachmentPublicLinks {
  publicUrl: string;
  publicThumbnailUrl?: string;
}

/**
 * Infrastructure port that produces signed URLs for attachment cells and
 * invalidates any cached preview URLs when attachment metadata changes.
 *
 * This keeps the URL-signing and caching concerns out of the v2 core while
 * letting application services orchestrate attachment decoration.
 */
export interface IAttachmentUrlSignerService {
  /**
   * Produce signed URLs for the given attachment items. Implementations are
   * expected to handle concurrency limits internally.
   */
  signItems(
    items: ReadonlyArray<AttachmentSignRequest>
  ): Promise<Result<ReadonlyMap<string, AttachmentSignedUrls>, DomainError>>;

  /**
   * Invalidate any cached preview URLs for the given tokens. Called when a
   * rename changes the desired Content-Disposition filename.
   */
  invalidatePreview(tokens: ReadonlyArray<string>): Promise<Result<void, DomainError>>;

  /**
   * Public links of attachments by cell, in order; undefined for an item without one, as in a
   * field without public links or on a host that does not publish files.
   */
  publicLinks(
    cells: ReadonlyArray<AttachmentPublicLinkRequest>
  ): Promise<Result<ReadonlyArray<AttachmentPublicLinks | undefined>, DomainError>>;
}

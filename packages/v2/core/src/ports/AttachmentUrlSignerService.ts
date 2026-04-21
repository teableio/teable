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
}

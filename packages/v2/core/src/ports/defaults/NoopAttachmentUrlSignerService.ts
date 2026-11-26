import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type {
  AttachmentPublicLinkRequest,
  AttachmentPublicLinks,
  AttachmentSignRequest,
  AttachmentSignedUrls,
  IAttachmentUrlSignerService,
} from '../AttachmentUrlSignerService';

/**
 * Default no-op URL signer. Returns empty signed URLs and no public links, and never invalidates
 * caches — used in contexts (tests, browser containers) where no real
 * storage/cache backend is configured.
 */
export class NoopAttachmentUrlSignerService implements IAttachmentUrlSignerService {
  async signItems(
    _items: ReadonlyArray<AttachmentSignRequest>
  ): Promise<Result<ReadonlyMap<string, AttachmentSignedUrls>, DomainError>> {
    return ok(new Map());
  }

  async invalidatePreview(_tokens: ReadonlyArray<string>): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publicLinks(
    cells: ReadonlyArray<AttachmentPublicLinkRequest>
  ): Promise<Result<ReadonlyArray<AttachmentPublicLinks | undefined>, DomainError>> {
    return ok(cells.map(() => undefined));
  }
}

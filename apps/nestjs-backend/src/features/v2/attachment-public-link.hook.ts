import type { AttachmentPublicLinkRequest, AttachmentPublicLinks } from '@teable/v2-core';

/**
 * Public links of attachments, by the cell they sit in. The community edition has none; the
 * enterprise backend registers one in each v2 container under this token, from its v2 registrar.
 */
export interface IAttachmentPublicLinkHook {
  /** In order; undefined for an attachment without one, as in a field without public links. */
  publicLinks(
    cells: ReadonlyArray<AttachmentPublicLinkRequest>
  ): Promise<ReadonlyArray<AttachmentPublicLinks | undefined>>;
}

export const ATTACHMENT_PUBLIC_LINK_HOOK = Symbol('v2.host.attachmentPublicLinkHook');

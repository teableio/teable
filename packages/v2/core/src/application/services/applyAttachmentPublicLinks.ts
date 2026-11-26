import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Field } from '../../domain/table/fields/Field';
import { AttachmentField } from '../../domain/table/fields/types/AttachmentField';
import type { Table } from '../../domain/table/Table';
import type {
  AttachmentPublicLinkRequest,
  AttachmentPublicLinks,
  AttachmentSignedUrls,
  IAttachmentUrlSignerService,
} from '../../ports/AttachmentUrlSignerService';

/** The cell an attachment value sits in. */
export interface AttachmentCellLocation {
  tableId: string;
  recordId: string;
  fieldId: string;
}

type AttachmentItemLike = {
  readonly id?: string;
  readonly token?: string;
  readonly mimetype?: string;
  readonly size?: number;
  readonly publicUrl?: string;
  readonly publicThumbnailUrl?: string;
  readonly [key: string]: unknown;
};

/** Whether the field has public links on; a lookup of one has none of its own. */
export const isPublicAttachment = (field: Field): field is AttachmentField =>
  field instanceof AttachmentField && field.publicAccess().toBoolean();

/** Whether a field of the table has public links on. */
export const isPublicAttachmentField = (table: Table, fieldId: string): boolean => {
  const field = table.getField((candidate) => candidate.id().toString() === fieldId);
  return field.isOk() && isPublicAttachment(field.value);
};

const withPublicLinks = <T extends AttachmentItemLike>(
  item: T,
  links: AttachmentPublicLinks | undefined
): T => {
  const { publicUrl: _url, publicThumbnailUrl: _thumbnail, ...rest } = item;
  if (!links) return rest as T;
  return {
    ...rest,
    publicUrl: links.publicUrl,
    ...(links.publicThumbnailUrl ? { publicThumbnailUrl: links.publicThumbnailUrl } : {}),
  } as T;
};

/**
 * Sets the public links of every item in the cells, replacing what the items carried: a value
 * read back or echoed by a client must not keep a link the field no longer gives. `signed`, the
 * signer's result for the same items, hands the host the files it already read.
 */
export const applyAttachmentPublicLinks = async <T extends AttachmentItemLike>(
  cells: ReadonlyArray<{ location: AttachmentCellLocation; items: ReadonlyArray<T> }>,
  signer: IAttachmentUrlSignerService,
  signed?: ReadonlyMap<string, AttachmentSignedUrls>
): Promise<Result<ReadonlyArray<ReadonlyArray<T>>, DomainError>> =>
  safeTry(async function* () {
    const requests: AttachmentPublicLinkRequest[] = [];
    const requestIndex = cells.map(({ location, items }) =>
      items.map((item) => {
        if (!item.id || !item.token) return -1;
        const file = signed?.get(item.token)?.file;
        requests.push({
          ...location,
          attachmentId: item.id,
          token: item.token,
          mimetype: item.mimetype,
          size: item.size,
          ...(file !== undefined && { file }),
        });
        return requests.length - 1;
      })
    );
    const links = requests.length > 0 ? yield* await signer.publicLinks(requests) : [];
    return ok(
      cells.map(({ items }, cellIndex) =>
        items.map((item, itemIndex) => {
          const index = requestIndex[cellIndex]![itemIndex]!;
          return withPublicLinks(item, index >= 0 ? links[index] : undefined);
        })
      )
    );
  });

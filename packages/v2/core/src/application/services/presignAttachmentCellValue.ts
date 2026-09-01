import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type {
  AttachmentSignedUrls,
  AttachmentSignRequest,
  IAttachmentUrlSignerService,
} from '../../ports/AttachmentUrlSignerService';

/**
 * Minimal attachment item shape used for read-path presentation signing.
 * Matches stored / OpenAPI attachment cell objects without depending on V1 types.
 */
export type AttachmentCellItem = {
  readonly token?: string;
  readonly path?: string;
  readonly name?: string;
  readonly mimetype?: string;
  readonly presignedUrl?: string;
  readonly smThumbnailUrl?: string;
  readonly lgThumbnailUrl?: string;
  readonly [key: string]: unknown;
};

export type AttachmentCellValue = ReadonlyArray<AttachmentCellItem>;

/**
 * Normalize a stored attachment cell (array or single object) to an array, or null.
 * Pure: no I/O, no Nest / RecordService coupling.
 */
export const normalizeAttachmentCellValue = (cellValue: unknown): AttachmentCellValue | null => {
  if (cellValue == null) {
    return null;
  }
  if (Array.isArray(cellValue)) {
    return cellValue as AttachmentCellValue;
  }
  if (typeof cellValue === 'object') {
    return [cellValue as AttachmentCellItem];
  }
  return null;
};

const extractSignRequests = (items: AttachmentCellValue): AttachmentSignRequest[] => {
  const requests: AttachmentSignRequest[] = [];
  for (const item of items) {
    if (!item.token || !item.path || !item.mimetype) {
      continue;
    }
    requests.push({
      token: item.token,
      path: item.path,
      mimetype: item.mimetype,
      name: item.name,
    });
  }
  return requests;
};

const applySignedUrls = (
  items: AttachmentCellValue,
  signed: ReadonlyMap<string, AttachmentSignedUrls>
): AttachmentCellValue =>
  items.map((item) => {
    if (!item.token) {
      return item;
    }
    const urls = signed.get(item.token);
    if (!urls) {
      return item;
    }
    return {
      ...item,
      ...(urls.presignedUrl !== undefined ? { presignedUrl: urls.presignedUrl } : {}),
      ...(urls.smThumbnailUrl !== undefined ? { smThumbnailUrl: urls.smThumbnailUrl } : {}),
      ...(urls.lgThumbnailUrl !== undefined ? { lgThumbnailUrl: urls.lgThumbnailUrl } : {}),
    };
  });

/**
 * Sign one attachment cell via the pure-V2 {@link IAttachmentUrlSignerService} port.
 *
 * Free function (no class instance / Nest DI / RecordService). The only I/O is
 * through the injected signer port (storage + optional thumbnail lookup).
 */
export const presignAttachmentCellValue = async (
  cellValue: unknown,
  signer: IAttachmentUrlSignerService
): Promise<Result<unknown, DomainError>> =>
  safeTry(async function* () {
    const items = normalizeAttachmentCellValue(cellValue);
    if (!items) {
      return ok(cellValue);
    }
    const requests = extractSignRequests(items);
    if (!requests.length) {
      return ok(items);
    }
    const signed = yield* await signer.signItems(requests);
    return ok(applySignedUrls(items, signed));
  });

/**
 * Batch-sign attachment field values across many record field maps.
 *
 * Collects all sign requests first, calls {@link IAttachmentUrlSignerService.signItems}
 * once, then rewrites attachment cells in place on shallow-cloned field maps.
 */
export const presignAttachmentFieldMaps = async (
  fieldMaps: ReadonlyArray<Record<string, unknown>>,
  attachmentFieldKeys: ReadonlySet<string>,
  signer: IAttachmentUrlSignerService
): Promise<Result<ReadonlyArray<Record<string, unknown>>, DomainError>> =>
  safeTry(async function* () {
    if (!fieldMaps.length || !attachmentFieldKeys.size) {
      return ok(fieldMaps);
    }

    type CellRef = { mapIndex: number; fieldKey: string; items: AttachmentCellValue };
    const refs: CellRef[] = [];
    const requests: AttachmentSignRequest[] = [];
    const seenTokens = new Set<string>();

    for (let mapIndex = 0; mapIndex < fieldMaps.length; mapIndex++) {
      const fields = fieldMaps[mapIndex]!;
      for (const fieldKey of attachmentFieldKeys) {
        const items = normalizeAttachmentCellValue(fields[fieldKey]);
        if (!items?.length) {
          continue;
        }
        refs.push({ mapIndex, fieldKey, items });
        for (const request of extractSignRequests(items)) {
          if (seenTokens.has(request.token)) {
            continue;
          }
          seenTokens.add(request.token);
          requests.push(request);
        }
      }
    }

    if (!refs.length) {
      return ok(fieldMaps);
    }

    const signed =
      requests.length > 0
        ? yield* await signer.signItems(requests)
        : new Map<string, AttachmentSignedUrls>();

    const nextMaps = fieldMaps.map((fields) => ({ ...fields }));
    for (const { mapIndex, fieldKey, items } of refs) {
      nextMaps[mapIndex]![fieldKey] = applySignedUrls(items, signed);
    }
    return ok(nextMaps);
  });

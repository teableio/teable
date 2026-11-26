import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { AttachmentItem } from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import type { Table } from '../../domain/table/Table';
import type {
  IAttachmentUrlSignerService,
  AttachmentSignedUrls,
  AttachmentSignRequest,
} from '../../ports/AttachmentUrlSignerService';
import { v2CoreTokens } from '../../ports/tokens';
import type { AttachmentCellLocation } from './applyAttachmentPublicLinks';
import { isPublicAttachmentField, applyAttachmentPublicLinks } from './applyAttachmentPublicLinks';
import type { IRecordChangedValueDecoratorService } from './RecordChangedValueDecoratorService';

/**
 * Attachment item as it arrives on the write path / realtime stream. Not every
 * field is guaranteed to be present — callers may pass minimal placeholders
 * (e.g. `{ name: 'x' }`) for newly uploaded items that have not yet gained a
 * token.
 */
type PartialAttachmentItem = Partial<AttachmentItem>;

const asPartialItems = (value: unknown): ReadonlyArray<PartialAttachmentItem> | null => {
  if (!Array.isArray(value)) return null;
  return value as ReadonlyArray<PartialAttachmentItem>;
};

const collectRenamedTokens = (
  newItems: ReadonlyArray<PartialAttachmentItem>,
  oldValue: unknown
): string[] => {
  const oldItems = asPartialItems(oldValue);
  if (!oldItems) return [];
  const oldNameByToken = new Map<string, string | undefined>();
  for (const item of oldItems) {
    if (item.token) oldNameByToken.set(item.token, item.name);
  }
  const renamed: string[] = [];
  for (const item of newItems) {
    if (!item.token) continue;
    if (!oldNameByToken.has(item.token)) continue;
    const oldName = oldNameByToken.get(item.token);
    if (oldName != null && oldName !== item.name) {
      renamed.push(item.token);
    }
  }
  return renamed;
};

const extractSignRequests = (
  items: ReadonlyArray<PartialAttachmentItem>
): AttachmentSignRequest[] => {
  const requests: AttachmentSignRequest[] = [];
  for (const item of items) {
    if (!item.token || !item.path || !item.mimetype) continue;
    requests.push({
      token: item.token,
      path: item.path,
      mimetype: item.mimetype,
      name: item.name,
    });
  }
  return requests;
};

const isAttachmentField = (table: Table, fieldId: string): boolean => {
  const fieldResult = table.getField((candidate) => candidate.id().toString() === fieldId);
  return fieldResult.isOk() && fieldResult.value.type().equals(FieldType.attachment());
};

const decorateItemsWithSignedUrls = (
  items: ReadonlyArray<PartialAttachmentItem>,
  signed: ReadonlyMap<string, AttachmentSignedUrls>
): ReadonlyArray<PartialAttachmentItem> =>
  items.map((item) => {
    if (!item.token) return item;
    const urls = signed.get(item.token);
    if (!urls) return item;
    return {
      ...item,
      ...(urls.presignedUrl !== undefined && { presignedUrl: urls.presignedUrl }),
      ...(urls.smThumbnailUrl !== undefined && { smThumbnailUrl: urls.smThumbnailUrl }),
      ...(urls.lgThumbnailUrl !== undefined && { lgThumbnailUrl: urls.lgThumbnailUrl }),
    };
  });

/**
 * Decorate attachment field values with signed URLs and invalidate preview
 * caches when attachment names change.
 *
 * This is the v2-core orchestration; the actual URL signing and cache writes
 * live behind `IAttachmentUrlSignerService`, so this service has no knowledge
 * of storage buckets, CDN providers, or cache backends.
 */
@injectable()
export class AttachmentValueDecoratorService implements IRecordChangedValueDecoratorService {
  constructor(
    @inject(v2CoreTokens.attachmentUrlSignerService)
    private readonly signer: IAttachmentUrlSignerService
  ) {}

  async decorateChangedFields(
    table: Table,
    recordId: string,
    changedFields?: ReadonlyMap<string, unknown>,
    previousFields?: Record<string, unknown>
  ): Promise<Result<ReadonlyMap<string, unknown> | undefined, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ReadonlyMap<string, unknown> | undefined, DomainError>(async function* () {
      if (!changedFields || changedFields.size === 0) {
        return ok(changedFields);
      }

      const decorated = new Map<string, unknown>();
      const publicFieldIds: string[] = [];
      const signedForLinks = new Map<string, AttachmentSignedUrls>();
      for (const [fieldId, value] of changedFields) {
        const fieldResult = table.getField((candidate) => candidate.id().toString() === fieldId);
        if (fieldResult.isErr() || !fieldResult.value.type().equals(FieldType.attachment())) {
          decorated.set(fieldId, value);
          continue;
        }
        const oldValue = previousFields?.[fieldId];
        const { value: signedValue, signed } = yield* await service.signValue(value, oldValue);
        decorated.set(fieldId, signedValue);
        if (!isPublicAttachmentField(table, fieldId)) continue;
        publicFieldIds.push(fieldId);
        for (const [token, urls] of signed) signedForLinks.set(token, urls);
      }

      const linked = yield* await service.linkCells(
        publicFieldIds.map((fieldId) => ({
          location: { tableId: table.id().toString(), recordId, fieldId },
          value: decorated.get(fieldId),
        })),
        signedForLinks
      );
      publicFieldIds.forEach((fieldId, index) => decorated.set(fieldId, linked[index]));
      return ok(decorated);
    });
  }

  async decorateChangedFieldsByRecord(
    table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
    previousFieldsByRecord?: ReadonlyMap<string, Record<string, unknown>>
  ): Promise<Result<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>(
      async function* () {
        if (!changedFieldsByRecord || changedFieldsByRecord.size === 0) {
          return ok(changedFieldsByRecord);
        }

        const attachmentValues: Array<{
          recordId: string;
          fieldId: string;
          items: ReadonlyArray<PartialAttachmentItem>;
        }> = [];
        const signRequests: AttachmentSignRequest[] = [];
        const renamedTokens = new Set<string>();
        const decorated = new Map<string, ReadonlyMap<string, unknown>>();
        for (const [recordId, changedFields] of changedFieldsByRecord) {
          const decoratedFields = new Map<string, unknown>();
          const previousFields = previousFieldsByRecord?.get(recordId);
          for (const [fieldId, value] of changedFields) {
            if (!isAttachmentField(table, fieldId)) {
              decoratedFields.set(fieldId, value);
              continue;
            }

            const items = asPartialItems(value);
            if (!items) {
              decoratedFields.set(fieldId, value);
              continue;
            }

            const oldValue = previousFields?.[fieldId];
            for (const token of collectRenamedTokens(items, oldValue)) {
              renamedTokens.add(token);
            }
            signRequests.push(...extractSignRequests(items));
            attachmentValues.push({ recordId, fieldId, items });
            decoratedFields.set(fieldId, items);
          }
          decorated.set(recordId, decoratedFields);
        }

        if (renamedTokens.size > 0) {
          yield* await service.signer.invalidatePreview([...renamedTokens]);
        }

        const signed =
          signRequests.length > 0
            ? yield* await service.signer.signItems(signRequests)
            : new Map<string, AttachmentSignedUrls>();

        const signedValues = attachmentValues.map(({ recordId, fieldId, items }) => ({
          location: { tableId: table.id().toString(), recordId, fieldId },
          items: decorateItemsWithSignedUrls(items, signed),
        }));
        const publicIndexes = signedValues.flatMap(({ location }, index) =>
          isPublicAttachmentField(table, location.fieldId) ? [index] : []
        );
        const linked = yield* await applyAttachmentPublicLinks(
          publicIndexes.map((index) => signedValues[index]!),
          service.signer,
          signed
        );
        publicIndexes.forEach((index, i) => {
          signedValues[index] = { ...signedValues[index]!, items: linked[i]! };
        });

        for (const { location, items } of signedValues) {
          const fields = decorated.get(location.recordId);
          if (!fields) continue;
          const nextFields = new Map(fields);
          nextFields.set(location.fieldId, items);
          decorated.set(location.recordId, nextFields);
        }

        return ok(decorated);
      }
    );
  }

  async decorateAttachmentValue(
    value: unknown,
    oldValue?: unknown
  ): Promise<Result<unknown, DomainError>> {
    return (await this.signValue(value, oldValue)).map(({ value: signed }) => signed);
  }

  /** The value with signed URLs, and the signer's result for its items. */
  private async signValue(
    value: unknown,
    oldValue?: unknown
  ): Promise<
    Result<{ value: unknown; signed: ReadonlyMap<string, AttachmentSignedUrls> }, DomainError>
  > {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry(async function* () {
      const none = new Map<string, AttachmentSignedUrls>();
      const items = asPartialItems(value);
      if (!items) return ok({ value, signed: none });

      const renamedTokens = collectRenamedTokens(items, oldValue);
      if (renamedTokens.length > 0) {
        yield* await service.signer.invalidatePreview(renamedTokens);
      }

      const requests = extractSignRequests(items);
      if (requests.length === 0) return ok({ value: items, signed: none });

      const signed = yield* await service.signer.signItems(requests);
      return ok({ value: decorateItemsWithSignedUrls(items, signed), signed });
    });
  }

  /**
   * Sets the public links of the cells' attachments in one call to the signer; a value that holds
   * no attachments comes back as it is. `signed`, when the items were just signed, saves the host
   * reading their files again.
   */
  async linkCells(
    cells: ReadonlyArray<{ location: AttachmentCellLocation; value: unknown }>,
    signed?: ReadonlyMap<string, AttachmentSignedUrls>
  ): Promise<Result<unknown[], DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<unknown[], DomainError>(async function* () {
      const values = cells.map(({ value }) => value);
      const attachmentCells = cells.flatMap(({ location, value }, index) => {
        const items = asPartialItems(value);
        return items ? [{ index, location, items }] : [];
      });
      const linked = yield* await applyAttachmentPublicLinks(
        attachmentCells,
        service.signer,
        signed
      );
      attachmentCells.forEach(({ index }, i) => {
        values[index] = linked[i];
      });
      return ok(values);
    });
  }
}

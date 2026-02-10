import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { generatePrefixedId } from '../../domain/shared/IdGenerator';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import {
  SetAttachmentValueSpec,
  type AttachmentItem,
} from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import { IAttachmentLookupService } from '../../ports/AttachmentLookupService';
import type { AttachmentLookupRecord } from '../../ports/AttachmentLookupService';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import type { ICellValueSpecResolver } from './SpecResolver';

const attachmentIdPrefix = 'act';
const attachmentIdLength = 16;

const normalizeAttachmentValue = (
  value: unknown
): { items: AttachmentItem[]; isArray: boolean } => {
  if (Array.isArray(value)) {
    return { items: value as AttachmentItem[], isArray: true };
  }
  if (value && typeof value === 'object') {
    return { items: [value as AttachmentItem], isArray: false };
  }
  return { items: [], isArray: true };
};

const ensureAttachmentId = (candidate: string | undefined, usedIds: Set<string>): string => {
  let id = candidate || generatePrefixedId(attachmentIdPrefix, attachmentIdLength);
  while (usedIds.has(id)) {
    id = generatePrefixedId(attachmentIdPrefix, attachmentIdLength);
  }
  usedIds.add(id);
  return id;
};

const resolveItem = (
  item: AttachmentItem,
  stored: AttachmentLookupRecord,
  usedIds: Set<string>,
  preserveProvidedId: boolean
): AttachmentItem => {
  const resolvedId = ensureAttachmentId(preserveProvidedId ? item.id : undefined, usedIds);
  return {
    ...item,
    id: resolvedId,
    name: item.name ?? stored.name ?? '',
    token: stored.token,
    path: stored.path,
    size: stored.size,
    mimetype: stored.mimetype,
  };
};

@injectable()
export class AttachmentValueResolverService
  implements ICellValueSpecResolver<SetAttachmentValueSpec>
{
  constructor(
    @inject(v2CoreTokens.attachmentLookupService)
    private readonly attachmentLookupService: IAttachmentLookupService
  ) {}

  supports(spec: ICellValueSpec): spec is SetAttachmentValueSpec {
    return spec instanceof SetAttachmentValueSpec;
  }

  async resolveSpecs(
    _context: IExecutionContext,
    specs: ReadonlyArray<SetAttachmentValueSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<ICellValueSpec>, DomainError>(async function* () {
      if (specs.length === 0) {
        return ok([]);
      }

      const tokens = new Set<string>();
      const attachmentIds = new Set<string>();
      for (const spec of specs) {
        const rawValue = spec.value.toValue();
        if (rawValue == null) continue;
        const normalized = normalizeAttachmentValue(rawValue);
        for (const item of normalized.items) {
          if (!item || typeof item !== 'object') {
            return err(
              domainError.validation({
                code: 'validation.field.invalid_attachment_format',
                message: 'Invalid attachment format',
              })
            );
          }
          const token = 'token' in item ? String(item.token) : '';
          const attachmentId = 'id' in item ? String(item.id) : '';
          if (token) {
            tokens.add(token);
          } else if (attachmentId) {
            attachmentIds.add(attachmentId);
          } else {
            return err(
              domainError.validation({
                code: 'validation.field.invalid_attachment_format',
                message: 'Invalid attachment format',
              })
            );
          }
        }
      }

      const attachmentResult = yield* await service.attachmentLookupService.listAttachmentsByTokens(
        [...tokens]
      );
      const attachmentIdResult =
        yield* await service.attachmentLookupService.listAttachmentsByAttachmentIds([
          ...attachmentIds,
        ]);
      const attachmentsByToken = new Map<string, AttachmentLookupRecord>();
      for (const attachment of attachmentResult) {
        attachmentsByToken.set(attachment.token, attachment);
      }
      const attachmentsByAttachmentId = new Map<string, AttachmentLookupRecord>();
      for (const attachment of attachmentIdResult) {
        const attachmentKey = attachment.attachmentId ?? attachment.id;
        if (attachmentKey) {
          attachmentsByAttachmentId.set(attachmentKey, attachment);
        }
      }

      const resolvedSpecs: ICellValueSpec[] = [];
      for (const spec of specs) {
        const rawValue = spec.value.toValue();
        if (rawValue == null) {
          resolvedSpecs.push(
            new SetAttachmentValueSpec(spec.fieldId, CellValue.null<AttachmentItem[]>())
          );
          continue;
        }

        const normalized = normalizeAttachmentValue(rawValue);
        const resolvedItems: AttachmentItem[] = [];
        const usedIds = new Set<string>();
        for (const item of normalized.items) {
          const token = 'token' in item ? String(item.token) : '';
          if (token) {
            const stored = attachmentsByToken.get(token);
            if (!stored) {
              return err(
                domainError.validation({
                  code: 'validation.field.attachment_not_found',
                  message: `Attachment(${token}) not found`,
                })
              );
            }
            resolvedItems.push(resolveItem(item, stored, usedIds, true));
            continue;
          }

          const attachmentId = 'id' in item ? String(item.id) : '';
          if (!attachmentId) {
            return err(
              domainError.validation({
                code: 'validation.field.invalid_attachment_format',
                message: 'Invalid attachment format',
              })
            );
          }
          const stored = attachmentsByAttachmentId.get(attachmentId);
          if (!stored) {
            return err(
              domainError.validation({
                code: 'validation.field.attachment_not_found',
                message: `Attachment(${attachmentId}) not found`,
              })
            );
          }
          resolvedItems.push(resolveItem(item, stored, usedIds, false));
        }

        const resolvedValue = normalized.isArray ? resolvedItems : resolvedItems[0] ?? null;
        resolvedSpecs.push(
          new SetAttachmentValueSpec(
            spec.fieldId,
            CellValue.fromValidated<AttachmentItem[]>(resolvedValue as AttachmentItem[] | null)
          )
        );
      }

      return ok(resolvedSpecs);
    });
  }
}

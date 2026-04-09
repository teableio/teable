import { Injectable } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import {
  FieldType,
  type DomainError,
  type IRecordChangedValueDecoratorService,
  type Table,
} from '@teable/v2-core';
import { ok, safeTry } from '@teable/v2-core';
import type { Result } from '@teable/v2-core';
import pLimit from 'p-limit';

import { generateTableThumbnailPath } from '../../utils/generate-thumbnail-path';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';

type AttachmentItemLike = {
  name?: string;
  path?: string;
  token?: string;
  mimetype?: string;
};

const ATTACHMENT_DECORATION_CONCURRENCY = 4;

@Injectable()
export class V2RecordChangedValueDecoratorService implements IRecordChangedValueDecoratorService {
  constructor(private readonly attachmentsStorageService: AttachmentsStorageService) {}

  async decorateChangedFields(
    table: Table,
    changedFields?: ReadonlyMap<string, unknown>
  ): Promise<Result<ReadonlyMap<string, unknown> | undefined, DomainError>> {
    const service = this;
    return safeTry<ReadonlyMap<string, unknown> | undefined, DomainError>(async function* () {
      if (!changedFields || changedFields.size === 0) {
        return ok(changedFields);
      }

      const decorated = new Map<string, unknown>();
      for (const [fieldId, value] of changedFields) {
        const fieldResult = table.getField((candidate) => candidate.id().toString() === fieldId);
        if (fieldResult.isErr() || !fieldResult.value.type().equals(FieldType.attachment())) {
          decorated.set(fieldId, value);
          continue;
        }
        decorated.set(fieldId, yield* await service.decorateAttachmentValue(value));
      }

      return ok(decorated);
    });
  }

  async decorateChangedFieldsByRecord(
    table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): Promise<Result<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>> {
    const service = this;
    return safeTry<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>(
      async function* () {
        if (!changedFieldsByRecord || changedFieldsByRecord.size === 0) {
          return ok(changedFieldsByRecord);
        }

        const decorated = new Map<string, ReadonlyMap<string, unknown>>();
        for (const [recordId, changedFields] of changedFieldsByRecord) {
          const decoratedFields = yield* await service.decorateChangedFields(table, changedFields);
          if (decoratedFields) {
            decorated.set(recordId, decoratedFields);
          }
        }

        return ok(decorated);
      }
    );
  }

  private async decorateAttachmentValue(value: unknown): Promise<Result<unknown, DomainError>> {
    const service = this;
    return safeTry<unknown, DomainError>(async function* () {
      if (!Array.isArray(value)) {
        return ok(value);
      }

      const limit = pLimit(ATTACHMENT_DECORATION_CONCURRENCY);
      const decoratedItems = await Promise.all(
        value.map((item) => limit(() => service.decorateAttachmentItem(item as AttachmentItemLike)))
      );
      return ok(decoratedItems);
    });
  }

  private async decorateAttachmentItem(item: AttachmentItemLike) {
    if (!item?.path || !item?.token || !item?.mimetype) {
      return item;
    }

    const presignedUrl = await this.attachmentsStorageService.getPreviewUrlByPath(
      StorageAdapter.getBucket(UploadType.Table),
      item.path,
      item.token,
      undefined,
      {
        'Content-Type': item.mimetype,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          item.name ?? item.token
        )}`,
      }
    );

    if (!item.mimetype.startsWith('image/')) {
      return {
        ...item,
        presignedUrl,
      };
    }

    const { smThumbnailPath, lgThumbnailPath } = generateTableThumbnailPath(item.path);
    const smThumbnailUrl = await this.attachmentsStorageService.getTableThumbnailUrl(
      smThumbnailPath,
      item.mimetype
    );
    const lgThumbnailUrl = await this.attachmentsStorageService.getTableThumbnailUrl(
      lgThumbnailPath,
      item.mimetype
    );

    return {
      ...item,
      presignedUrl,
      smThumbnailUrl: smThumbnailUrl || presignedUrl,
      lgThumbnailUrl: lgThumbnailUrl || presignedUrl,
    };
  }
}

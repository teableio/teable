import { Injectable } from '@nestjs/common';
import { AttachmentValueDecoratorService } from '@teable/v2-core';
import type {
  DomainError,
  IRecordChangedValueDecoratorService,
  Result,
  Table,
} from '@teable/v2-core';

/**
 * NestJS-side bridge to the v2-core `AttachmentValueDecoratorService`.
 *
 * The concrete decoration / URL-signing / cache-invalidation logic lives in
 * v2-core behind the `IAttachmentUrlSignerService` port; this class only
 * exists so the nest DI container has a `@Injectable()` to hand back when
 * registering the v2-core `recordChangedValueDecoratorService` token.
 */
@Injectable()
export class V2RecordChangedValueDecoratorService implements IRecordChangedValueDecoratorService {
  constructor(private readonly attachmentValueDecorator: AttachmentValueDecoratorService) {}

  decorateChangedFields(
    table: Table,
    changedFields?: ReadonlyMap<string, unknown>,
    previousFields?: Record<string, unknown>
  ): Promise<Result<ReadonlyMap<string, unknown> | undefined, DomainError>> {
    return this.attachmentValueDecorator.decorateChangedFields(
      table,
      changedFields,
      previousFields
    );
  }

  decorateChangedFieldsByRecord(
    table: Table,
    changedFieldsByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): Promise<Result<ReadonlyMap<string, ReadonlyMap<string, unknown>> | undefined, DomainError>> {
    return this.attachmentValueDecorator.decorateChangedFieldsByRecord(
      table,
      changedFieldsByRecord
    );
  }
}

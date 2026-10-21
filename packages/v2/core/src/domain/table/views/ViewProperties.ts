import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewShareMetaSchema = z
  .object({
    allowCopy: z.boolean().optional(),
    includeHiddenField: z.boolean().optional(),
    password: z.string().min(3).optional(),
    includeRecords: z.boolean().optional(),
    submit: z.object({ requireLogin: z.boolean().optional() }).optional(),
    allowEdit: z.boolean().optional(),
  })
  .strict();

const viewPropertiesSchema = z
  .object({
    description: z.string().optional(),
    isLocked: z.boolean().optional(),
    enableShare: z.boolean().optional(),
    shareId: z.string().optional(),
    shareMeta: viewShareMetaSchema.optional(),
  })
  .strict();

export type ViewShareMetaValue = z.infer<typeof viewShareMetaSchema>;
export type ViewPropertiesValue = z.infer<typeof viewPropertiesSchema>;

export class ViewProperties extends ValueObject {
  private constructor(private readonly value: ViewPropertiesValue) {
    super();
  }

  static create(raw: ViewPropertiesValue): Result<ViewProperties, DomainError> {
    return ViewProperties.fromRaw(raw);
  }

  static rehydrate(raw: unknown): Result<ViewProperties, DomainError> {
    return ViewProperties.fromRaw(raw);
  }

  static empty(): ViewProperties {
    return new ViewProperties({});
  }

  description(): string | undefined {
    return this.value.description;
  }

  isLocked(): boolean | undefined {
    return this.value.isLocked;
  }

  enableShare(): boolean | undefined {
    return this.value.enableShare;
  }

  shareId(): string | undefined {
    return this.value.shareId;
  }

  shareMeta(): ViewShareMetaValue | undefined {
    return this.value.shareMeta ? ViewProperties.cloneShareMeta(this.value.shareMeta) : undefined;
  }

  withDescription(description: string | undefined): Result<ViewProperties, DomainError> {
    return ViewProperties.create({
      ...this.toDto(),
      description,
    });
  }

  withLocked(isLocked: boolean | undefined): Result<ViewProperties, DomainError> {
    return ViewProperties.create({
      ...this.toDto(),
      isLocked,
    });
  }

  withShareMeta(shareMeta: ViewShareMetaValue | undefined): Result<ViewProperties, DomainError> {
    return ViewProperties.create({
      ...this.toDto(),
      shareMeta,
    });
  }

  withShareId(shareId: string | undefined): Result<ViewProperties, DomainError> {
    return ViewProperties.create({
      ...this.toDto(),
      shareId,
    });
  }

  withShareState(params: {
    enableShare: boolean;
    shareId: string | undefined;
    shareMeta: ViewShareMetaValue | undefined;
  }): Result<ViewProperties, DomainError> {
    return ViewProperties.create({
      ...this.toDto(),
      enableShare: params.enableShare,
      shareId: params.shareId,
      shareMeta: params.shareMeta,
    });
  }

  toDto(): ViewPropertiesValue {
    return {
      ...(this.value.description !== undefined ? { description: this.value.description } : {}),
      ...(this.value.isLocked !== undefined ? { isLocked: this.value.isLocked } : {}),
      ...(this.value.enableShare !== undefined ? { enableShare: this.value.enableShare } : {}),
      ...(this.value.shareId !== undefined ? { shareId: this.value.shareId } : {}),
      ...(this.value.shareMeta
        ? { shareMeta: ViewProperties.cloneShareMeta(this.value.shareMeta) }
        : {}),
    };
  }

  equals(other: ViewProperties): boolean {
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }

  private static fromRaw(raw: unknown): Result<ViewProperties, DomainError> {
    const parsed = viewPropertiesSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ViewProperties',
          details: z.formatError(parsed.error),
        })
      );
    }
    return ok(new ViewProperties(parsed.data));
  }

  private static cloneShareMeta(value: ViewShareMetaValue): ViewShareMetaValue {
    return {
      ...value,
      ...(value.submit ? { submit: { ...value.submit } } : {}),
    };
  }
}

import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewAuditMetadataSchema = z
  .object({
    createdBy: z.string().min(1),
    createdTime: z.string().min(1),
    lastModifiedBy: z.string().min(1).optional(),
    lastModifiedTime: z.string().min(1).optional(),
  })
  .strict();

export type ViewAuditMetadataValue = z.infer<typeof viewAuditMetadataSchema>;

/**
 * Audit metadata rehydrated with a View child entity.
 *
 * It is intentionally absent on newly constructed Views and does not participate
 * in Table invariants or View mutation behavior.
 */
export class ViewAuditMetadata extends ValueObject {
  private constructor(private readonly value: ViewAuditMetadataValue) {
    super();
  }

  static rehydrate(raw: unknown): Result<ViewAuditMetadata, DomainError> {
    const parsed = viewAuditMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ViewAuditMetadata',
          details: z.formatError(parsed.error),
        })
      );
    }
    return ok(new ViewAuditMetadata(parsed.data));
  }

  toDto(): ViewAuditMetadataValue {
    return { ...this.value };
  }

  equals(other: ViewAuditMetadata): boolean {
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }
}

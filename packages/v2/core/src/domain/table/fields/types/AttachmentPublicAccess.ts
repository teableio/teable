import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const attachmentPublicAccessSchema = z.boolean();

/** Whether the files of an attachment field get public links. */
export class AttachmentPublicAccess extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<AttachmentPublicAccess, DomainError> {
    const parsed = attachmentPublicAccessSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid AttachmentPublicAccess' }));
    return ok(new AttachmentPublicAccess(parsed.data));
  }

  static enabled(): AttachmentPublicAccess {
    return new AttachmentPublicAccess(true);
  }

  static disabled(): AttachmentPublicAccess {
    return new AttachmentPublicAccess(false);
  }

  equals(other: AttachmentPublicAccess): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}

/**
 * An attachment field without its public switch. A copy, a restore from the trash or an undo
 * brings the field back private: publishing its files again is for the user to confirm.
 */
export const withoutAttachmentPublicAccess = <T extends { type?: unknown; options?: unknown }>(
  field: T
): T => {
  const options = field.options;
  if (
    field.type !== 'attachment' ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !('isPublic' in options)
  ) {
    return field;
  }
  const { isPublic: _isPublic, ...rest } = options as Record<string, unknown>;
  return { ...field, options: rest };
};

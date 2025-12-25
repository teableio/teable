import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const linkFieldMetaSchema = z.object({
  hasOrderColumn: z.boolean().optional().default(false),
});

export type LinkFieldMetaValue = z.infer<typeof linkFieldMetaSchema>;

export class LinkFieldMeta extends ValueObject {
  private constructor(private readonly value: LinkFieldMetaValue) {
    super();
  }

  static create(raw: unknown): Result<LinkFieldMeta | undefined, string> {
    if (raw == null) return ok(undefined);
    const parsed = linkFieldMetaSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid LinkFieldMeta');
    return ok(new LinkFieldMeta(parsed.data));
  }

  equals(other: LinkFieldMeta): boolean {
    return (this.value.hasOrderColumn ?? false) === (other.value.hasOrderColumn ?? false);
  }

  hasOrderColumn(): boolean {
    return this.value.hasOrderColumn ?? false;
  }

  toDto(): LinkFieldMetaValue {
    return { hasOrderColumn: this.value.hasOrderColumn ?? false };
  }
}

import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const linkRelationshipSchema = z.enum(['oneOne', 'manyMany', 'oneMany', 'manyOne']);
export type LinkRelationshipValue = z.infer<typeof linkRelationshipSchema>;

export class LinkRelationship extends ValueObject {
  private constructor(private readonly value: LinkRelationshipValue) {
    super();
  }

  static create(raw: unknown): Result<LinkRelationship, DomainError> {
    const parsed = linkRelationshipSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid LinkRelationship' }));
    return ok(new LinkRelationship(parsed.data));
  }

  static oneOne(): LinkRelationship {
    return new LinkRelationship('oneOne');
  }

  static manyMany(): LinkRelationship {
    return new LinkRelationship('manyMany');
  }

  static oneMany(): LinkRelationship {
    return new LinkRelationship('oneMany');
  }

  static manyOne(): LinkRelationship {
    return new LinkRelationship('manyOne');
  }

  equals(other: LinkRelationship): boolean {
    return this.value === other.value;
  }

  isMultipleValue(): boolean {
    return this.value === 'manyMany' || this.value === 'oneMany';
  }

  /**
   * Returns true if this relationship requires that each foreign record
   * can only be linked to ONE source record (exclusivity constraint).
   *
   * - oneOne: Each foreign record can only be linked to one source record
   * - oneMany: Each foreign record can only belong to one "parent" (the source side)
   * - manyOne: No exclusivity - multiple sources can link to the same foreign record
   * - manyMany: No exclusivity - multiple sources can link to the same foreign record
   */
  requiresExclusiveForeignRecord(): boolean {
    return this.value === 'oneOne' || this.value === 'oneMany';
  }

  reverse(): LinkRelationship {
    switch (this.value) {
      case 'oneMany':
        return LinkRelationship.manyOne();
      case 'manyOne':
        return LinkRelationship.oneMany();
      case 'manyMany':
        return LinkRelationship.manyMany();
      case 'oneOne':
      default:
        return LinkRelationship.oneOne();
    }
  }

  toString(): LinkRelationshipValue {
    return this.value;
  }
}

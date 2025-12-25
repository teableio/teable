import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const linkRelationshipSchema = z.enum(['oneOne', 'manyMany', 'oneMany', 'manyOne']);
export type LinkRelationshipValue = z.infer<typeof linkRelationshipSchema>;

export class LinkRelationship extends ValueObject {
  private constructor(private readonly value: LinkRelationshipValue) {
    super();
  }

  static create(raw: unknown): Result<LinkRelationship, string> {
    const parsed = linkRelationshipSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid LinkRelationship');
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

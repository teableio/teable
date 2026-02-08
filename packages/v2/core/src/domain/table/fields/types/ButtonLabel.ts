import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const buttonLabelSchema = z.string();

export class ButtonLabel extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ButtonLabel, DomainError> {
    const parsed = buttonLabelSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ButtonLabel' }));
    return ok(new ButtonLabel(parsed.data));
  }

  static default(): ButtonLabel {
    return new ButtonLabel('Button');
  }

  equals(other: ButtonLabel): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

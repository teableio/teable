import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const buttonConfirmSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  confirmText: z.string().optional(),
});

export type ButtonConfirmValue = z.infer<typeof buttonConfirmSchema>;

export class ButtonConfirm extends ValueObject {
  private constructor(private readonly value: ButtonConfirmValue) {
    super();
  }

  static create(raw: unknown): Result<ButtonConfirm, DomainError> {
    const parsed = buttonConfirmSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ButtonConfirm' }));
    return ok(new ButtonConfirm(parsed.data));
  }

  equals(other: ButtonConfirm): boolean {
    return (
      this.value.title === other.value.title &&
      this.value.description === other.value.description &&
      this.value.confirmText === other.value.confirmText
    );
  }

  toDto(): ButtonConfirmValue {
    return { ...this.value };
  }
}

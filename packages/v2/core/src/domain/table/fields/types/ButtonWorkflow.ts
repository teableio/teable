import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const buttonWorkflowSchema = z.object({
  id: z.string().startsWith('wfl').optional(),
  name: z.string().optional(),
  isActive: z.boolean().optional(),
});

export type ButtonWorkflowValue = z.infer<typeof buttonWorkflowSchema>;

export class ButtonWorkflow extends ValueObject {
  private constructor(private readonly value: ButtonWorkflowValue) {
    super();
  }

  static create(raw: unknown): Result<ButtonWorkflow | undefined, DomainError> {
    if (raw == null) return ok(undefined);
    const parsed = buttonWorkflowSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ButtonWorkflow' }));
    return ok(new ButtonWorkflow(parsed.data));
  }

  equals(other: ButtonWorkflow): boolean {
    return (
      this.value.id === other.value.id &&
      this.value.name === other.value.name &&
      this.value.isActive === other.value.isActive
    );
  }

  toDto(): ButtonWorkflowValue {
    return { ...this.value };
  }
}

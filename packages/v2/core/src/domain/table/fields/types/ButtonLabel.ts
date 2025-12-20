import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const buttonLabelSchema = z.string();

export class ButtonLabel extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ButtonLabel, string> {
    const parsed = buttonLabelSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid ButtonLabel');
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

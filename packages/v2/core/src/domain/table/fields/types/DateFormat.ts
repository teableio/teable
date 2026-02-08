import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const dateFormatSchema = z.enum(['date', 'dateTime']);
type IDateFormatLiteral = z.infer<typeof dateFormatSchema>;

export class DateFormat extends ValueObject {
  private constructor(private readonly value: IDateFormatLiteral) {
    super();
  }

  static create(raw: unknown): Result<DateFormat, DomainError> {
    const parsed = dateFormatSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid DateFormat' }));
    return ok(new DateFormat(parsed.data));
  }

  static date(): DateFormat {
    return new DateFormat('date');
  }

  static dateTime(): DateFormat {
    return new DateFormat('dateTime');
  }

  equals(other: DateFormat): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

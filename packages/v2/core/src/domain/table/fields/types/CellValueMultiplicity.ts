import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const multiplicitySchema = z.boolean();

export class CellValueMultiplicity extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<CellValueMultiplicity, DomainError> {
    const parsed = multiplicitySchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid CellValueMultiplicity' }));
    return ok(new CellValueMultiplicity(parsed.data));
  }

  static single(): CellValueMultiplicity {
    return new CellValueMultiplicity(false);
  }

  static multiple(): CellValueMultiplicity {
    return new CellValueMultiplicity(true);
  }

  equals(other: CellValueMultiplicity): boolean {
    return this.value === other.value;
  }

  isMultiple(): boolean {
    return this.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}

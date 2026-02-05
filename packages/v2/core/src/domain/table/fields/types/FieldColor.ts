import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

export const fieldColorValues = [
  'blueLight2',
  'blueLight1',
  'blueBright',
  'blue',
  'blueDark1',
  'cyanLight2',
  'cyanLight1',
  'cyanBright',
  'cyan',
  'cyanDark1',
  'grayLight2',
  'grayLight1',
  'grayBright',
  'gray',
  'grayDark1',
  'greenLight2',
  'greenLight1',
  'greenBright',
  'green',
  'greenDark1',
  'orangeLight2',
  'orangeLight1',
  'orangeBright',
  'orange',
  'orangeDark1',
  'pinkLight2',
  'pinkLight1',
  'pinkBright',
  'pink',
  'pinkDark1',
  'purpleLight2',
  'purpleLight1',
  'purpleBright',
  'purple',
  'purpleDark1',
  'redLight2',
  'redLight1',
  'redBright',
  'red',
  'redDark1',
  'tealLight2',
  'tealLight1',
  'tealBright',
  'teal',
  'tealDark1',
  'yellowLight2',
  'yellowLight1',
  'yellowBright',
  'yellow',
  'yellowDark1',
] as const;

export const fieldColorSchema = z.enum(fieldColorValues);
export type FieldColorValue = z.infer<typeof fieldColorSchema>;

export class FieldColor extends ValueObject {
  private constructor(private readonly value: FieldColorValue) {
    super();
  }

  static create(raw: unknown): Result<FieldColor, DomainError> {
    const parsed = fieldColorSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldColor' }));
    return ok(new FieldColor(parsed.data));
  }

  static from(value: FieldColorValue): FieldColor {
    return new FieldColor(value);
  }

  equals(other: FieldColor): boolean {
    return this.value === other.value;
  }

  toString(): FieldColorValue {
    return this.value;
  }
}

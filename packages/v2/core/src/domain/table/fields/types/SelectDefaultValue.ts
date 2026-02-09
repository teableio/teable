import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { SelectOptionName } from './SelectOptionName';

const selectDefaultValueSchema = z.union([z.string(), z.array(z.string())]);

const isReadonlyArray = <T>(value: T | ReadonlyArray<T>): value is ReadonlyArray<T> =>
  Array.isArray(value);

export class SelectDefaultValue extends ValueObject {
  private constructor(private readonly value: SelectOptionName | ReadonlyArray<SelectOptionName>) {
    super();
  }

  static create(raw: unknown): Result<SelectDefaultValue, DomainError> {
    const parsed = selectDefaultValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid SelectDefaultValue' }));

    if (typeof parsed.data === 'string') {
      return SelectOptionName.create(parsed.data).map((name) => new SelectDefaultValue(name));
    }

    const names = parsed.data.map((v) => SelectOptionName.create(v));
    return names
      .reduce<
        Result<ReadonlyArray<SelectOptionName>, DomainError>
      >((acc, next) => acc.andThen((arr) => next.map((name) => [...arr, name])), ok([]))
      .map((values) => new SelectDefaultValue(values));
  }

  equals(other: SelectDefaultValue): boolean {
    const left = this.value;
    const right = other.value;
    if (isReadonlyArray(left) && isReadonlyArray(right)) {
      if (left.length !== right.length) return false;
      return left.every((value, index) => value.equals(right[index]));
    }
    if (!isReadonlyArray(left) && !isReadonlyArray(right)) {
      return left.equals(right);
    }
    return false;
  }

  isMultiple(): boolean {
    return Array.isArray(this.value);
  }

  toDto(): string | string[] {
    if (Array.isArray(this.value)) {
      return this.value.map((v) => v.toString());
    }
    return this.value.toString();
  }
}

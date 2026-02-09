import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { UserId } from './UserId';

const userDefaultValueSchema = z.union([z.string(), z.array(z.string())]);

const isReadonlyArray = <T>(value: T | ReadonlyArray<T>): value is ReadonlyArray<T> =>
  Array.isArray(value);

export class UserDefaultValue extends ValueObject {
  private constructor(private readonly value: UserId | ReadonlyArray<UserId>) {
    super();
  }

  static create(raw: unknown): Result<UserDefaultValue, DomainError> {
    const parsed = userDefaultValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid UserDefaultValue' }));

    if (typeof parsed.data === 'string') {
      return UserId.create(parsed.data).map((id) => new UserDefaultValue(id));
    }

    const ids = parsed.data.map((v) => UserId.create(v));
    return ids
      .reduce<
        Result<ReadonlyArray<UserId>, DomainError>
      >((acc, next) => acc.andThen((arr) => next.map((id) => [...arr, id])), ok([]))
      .map((values) => new UserDefaultValue(values));
  }

  equals(other: UserDefaultValue): boolean {
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
      return this.value.map((id) => id.toString());
    }
    return this.value.toString();
  }
}

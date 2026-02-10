import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const userNotificationSchema = z.boolean();

export class UserNotification extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<UserNotification, DomainError> {
    const parsed = userNotificationSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid UserNotification' }));
    return ok(new UserNotification(parsed.data));
  }

  static enabled(): UserNotification {
    return new UserNotification(true);
  }

  static disabled(): UserNotification {
    return new UserNotification(false);
  }

  equals(other: UserNotification): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}

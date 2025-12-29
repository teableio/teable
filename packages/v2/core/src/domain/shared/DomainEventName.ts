import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from './ValueObject';

const domainEventNameSchema = z.string().min(1);

export class DomainEventName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<DomainEventName, string> {
    const parsed = domainEventNameSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid DomainEventName');
    return ok(new DomainEventName(parsed.data));
  }

  static tableCreated(): DomainEventName {
    return new DomainEventName('TableCreated');
  }

  static tableDeleted(): DomainEventName {
    return new DomainEventName('TableDeleted');
  }

  static tableRenamed(): DomainEventName {
    return new DomainEventName('TableRenamed');
  }

  static fieldCreated(): DomainEventName {
    return new DomainEventName('FieldCreated');
  }

  static fieldDeleted(): DomainEventName {
    return new DomainEventName('FieldDeleted');
  }

  equals(other: DomainEventName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

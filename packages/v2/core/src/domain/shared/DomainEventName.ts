import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from './DomainError';
import { ValueObject } from './ValueObject';

const domainEventNameSchema = z.string().min(1);

export class DomainEventName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<DomainEventName, DomainError> {
    const parsed = domainEventNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid DomainEventName' }));
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

  static fieldDuplicated(): DomainEventName {
    return new DomainEventName('FieldDuplicated');
  }

  static viewColumnMetaUpdated(): DomainEventName {
    return new DomainEventName('ViewColumnMetaUpdated');
  }

  static baseCreated(): DomainEventName {
    return new DomainEventName('BaseCreated');
  }

  static recordCreated(): DomainEventName {
    return new DomainEventName('RecordCreated');
  }

  static recordsBatchCreated(): DomainEventName {
    return new DomainEventName('RecordsBatchCreated');
  }

  static recordUpdated(): DomainEventName {
    return new DomainEventName('RecordUpdated');
  }

  static recordsBatchUpdated(): DomainEventName {
    return new DomainEventName('RecordsBatchUpdated');
  }

  static recordsDeleted(): DomainEventName {
    return new DomainEventName('RecordsDeleted');
  }

  static recordReordered(): DomainEventName {
    return new DomainEventName('RecordReordered');
  }

  static fieldOptionsAdded(): DomainEventName {
    return new DomainEventName('FieldOptionsAdded');
  }

  equals(other: DomainEventName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

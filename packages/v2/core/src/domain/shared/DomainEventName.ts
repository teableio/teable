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

  static tableTrashed(): DomainEventName {
    return new DomainEventName('TableTrashed');
  }

  static tableRestored(): DomainEventName {
    return new DomainEventName('TableRestored');
  }

  static tableRenamed(): DomainEventName {
    return new DomainEventName('TableRenamed');
  }

  static tablePropertiesUpdated(): DomainEventName {
    return new DomainEventName('TablePropertiesUpdated');
  }

  static fieldCreated(): DomainEventName {
    return new DomainEventName('FieldCreated');
  }

  static fieldDeleted(): DomainEventName {
    return new DomainEventName('FieldDeleted');
  }

  static fieldUpdated(): DomainEventName {
    return new DomainEventName('FieldUpdated');
  }

  static fieldDuplicated(): DomainEventName {
    return new DomainEventName('FieldDuplicated');
  }

  static viewColumnMetaUpdated(): DomainEventName {
    return new DomainEventName('ViewColumnMetaUpdated');
  }

  static viewCreated(): DomainEventName {
    return new DomainEventName('ViewCreated');
  }

  static viewDeleted(): DomainEventName {
    return new DomainEventName('ViewDeleted');
  }

  static viewRenamed(): DomainEventName {
    return new DomainEventName('ViewRenamed');
  }

  static viewDescriptionUpdated(): DomainEventName {
    return new DomainEventName('ViewDescriptionUpdated');
  }

  static viewFilterUpdated(): DomainEventName {
    return new DomainEventName('ViewFilterUpdated');
  }

  static viewGroupUpdated(): DomainEventName {
    return new DomainEventName('ViewGroupUpdated');
  }

  static viewOptionsUpdated(): DomainEventName {
    return new DomainEventName('ViewOptionsUpdated');
  }

  static viewShareMetaUpdated(): DomainEventName {
    return new DomainEventName('ViewShareMetaUpdated');
  }

  static viewShareIdRefreshed(): DomainEventName {
    return new DomainEventName('ViewShareIdRefreshed');
  }

  static viewShareEnabled(): DomainEventName {
    return new DomainEventName('ViewShareEnabled');
  }

  static viewShareDisabled(): DomainEventName {
    return new DomainEventName('ViewShareDisabled');
  }

  static viewSortUpdated(): DomainEventName {
    return new DomainEventName('ViewSortUpdated');
  }

  static viewManualSortApplied(): DomainEventName {
    return new DomainEventName('ViewManualSortApplied');
  }

  static viewLockedUpdated(): DomainEventName {
    return new DomainEventName('ViewLockedUpdated');
  }

  static viewOrderUpdated(): DomainEventName {
    return new DomainEventName('ViewOrderUpdated');
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

  static buttonClicked(): DomainEventName {
    return new DomainEventName('ButtonClicked');
  }

  static recordsBatchUpdated(): DomainEventName {
    return new DomainEventName('RecordsBatchUpdated');
  }

  static tableActionTriggerRequested(): DomainEventName {
    return new DomainEventName('TableActionTriggerRequested');
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

  static computedActivityBatchChanged(): DomainEventName {
    return new DomainEventName('ComputedActivityBatchChanged');
  }

  equals(other: DomainEventName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

import type { ITablePersistenceDTO } from '../../../ports/mappers/TableMapper';
import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import type { DomainEventName } from '../../shared/DomainEventName';
import type { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';

/**
 * Abstract base class for all table update events.
 * The tableSnapshot is optional during domain creation and
 * must be enriched before publishing via withSnapshot().
 */
export abstract class AbstractTableUpdatedEvent implements IDomainEvent {
  abstract readonly name: DomainEventName;
  abstract readonly occurredAt: OccurredAt;

  protected constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId,
    readonly tableSnapshot?: ITablePersistenceDTO
  ) {}

  /**
   * Returns true if this event has been enriched with a table snapshot.
   */
  hasSnapshot(): boolean {
    return this.tableSnapshot !== undefined;
  }

  /**
   * Creates a new event instance with the provided table snapshot.
   * Subclasses must implement this to return a properly typed event.
   */
  abstract withSnapshot(snapshot: ITablePersistenceDTO): AbstractTableUpdatedEvent;
}

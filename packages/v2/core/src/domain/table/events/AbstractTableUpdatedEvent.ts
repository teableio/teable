import type { BaseId } from '../../base/BaseId';
import type { IDomainEvent } from '../../shared/DomainEvent';
import type { DomainEventName } from '../../shared/DomainEventName';
import type { OccurredAt } from '../../shared/OccurredAt';
import type { TableId } from '../TableId';

/**
 * Abstract base class for all table update events.
 * Events contain only the identifiers needed for projections to fetch data themselves.
 */
export abstract class AbstractTableUpdatedEvent implements IDomainEvent {
  abstract readonly name: DomainEventName;
  abstract readonly occurredAt: OccurredAt;

  /**
   * Request ID for tracing. Set by EventBus at publish time.
   */
  requestId?: string;

  protected constructor(
    readonly tableId: TableId,
    readonly baseId: BaseId
  ) {}
}

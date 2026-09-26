import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type {
  DurableProjectionTarget,
  IDurableSubscriptionCatalog,
  IDurableSubscriptionCatalogSnapshot,
  LegacyProjectionTarget,
  ProjectionEventRoutingDecision,
  SameTxProjectionTarget,
} from '../../ports/DurableSubscriptionCatalog';
import type { EventType } from '../../ports/EventHandler';
import type { IExecutionContext } from '../../ports/ExecutionContext';

export type DurableSubscriptionCatalogEntry = Readonly<{
  event: EventType<IDomainEvent>;
  messageName: string;
  durableMode: 'shadow' | 'active';
  sameTxTargets: ReadonlyArray<SameTxProjectionTarget>;
  durableTargets: ReadonlyArray<DurableProjectionTarget>;
  directTargets: ReadonlyArray<LegacyProjectionTarget>;
}>;

export type DurableSubscriptionCatalogDefinition = Readonly<{
  generation: number;
  entries: ReadonlyArray<DurableSubscriptionCatalogEntry>;
}>;

export class ImmutableDurableSubscriptionCatalog
  implements IDurableSubscriptionCatalog, IDurableSubscriptionCatalogSnapshot
{
  private constructor(
    readonly generation: number,
    private readonly entriesByEventName: ReadonlyMap<string, DurableSubscriptionCatalogEntry>
  ) {}

  static create(
    definition: DurableSubscriptionCatalogDefinition
  ): Result<ImmutableDurableSubscriptionCatalog, DomainError> {
    const validation = validateDefinition(definition);
    if (validation.isErr()) {
      return err(validation.error);
    }
    const entriesByEventName = new Map<string, DurableSubscriptionCatalogEntry>();
    for (const entry of definition.entries) {
      entriesByEventName.set(entry.event.name, Object.freeze(entry));
    }
    return ok(new ImmutableDurableSubscriptionCatalog(definition.generation, entriesByEventName));
  }

  snapshot(_context: IExecutionContext): Result<IDurableSubscriptionCatalogSnapshot, DomainError> {
    return ok(this);
  }

  resolve(event: IDomainEvent): Result<ProjectionEventRoutingDecision, DomainError> {
    const entry =
      this.entriesByEventName.get(event.constructor.name) ??
      this.entriesByEventName.get(event.name.toString());
    if (!entry) {
      return ok({
        messageName: event.name.toString(),
        durableMode: 'active',
        sameTxTargets: [],
        durableTargets: [],
        directTargets: [],
      });
    }
    return ok({
      messageName: entry.messageName,
      durableMode: entry.durableMode,
      sameTxTargets: entry.sameTxTargets,
      durableTargets: entry.durableTargets,
      directTargets: entry.directTargets,
    });
  }
}

const validateDefinition = (
  definition: DurableSubscriptionCatalogDefinition
): Result<void, DomainError> => {
  if (!Number.isSafeInteger(definition.generation) || definition.generation < 1) {
    return err(
      catalogError('Catalog generation must be a positive integer', {
        generation: definition.generation,
      })
    );
  }
  const eventNames = new Set<string>();
  const consumerIds = new Set<string>();
  for (const entry of definition.entries) {
    if (eventNames.has(entry.event.name)) {
      return err(catalogError(`Duplicate catalog entry for ${entry.event.name}`));
    }
    eventNames.add(entry.event.name);
    if (!entry.messageName.trim()) {
      return err(catalogError(`Missing message name for ${entry.event.name}`));
    }
    for (const target of [
      ...entry.sameTxTargets,
      ...entry.durableTargets,
      ...entry.directTargets,
    ]) {
      const key = `${entry.messageName}\0${target.consumerId}`;
      if (consumerIds.has(key)) {
        return err(
          catalogError(`Consumer ${target.consumerId} is duplicated for ${entry.messageName}`)
        );
      }
      consumerIds.add(key);
      if (!target.consumerId.trim()) {
        return err(catalogError(`Empty consumer id for ${entry.messageName}`));
      }
    }
  }
  return ok(undefined);
};

const catalogError = (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
  domainError.invariant({
    code: 'projection_message.subscription_catalog_invalid',
    message,
    ...(details ? { details } : {}),
  });

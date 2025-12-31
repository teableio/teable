Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared Architecture Notes

## Responsibilities

- Shared domain base classes and common value objects.
- Core abstractions like DomainEvent, AggregateRoot, ValueObject.
- Structured domain error model used across domain/application layers.

## Subfolders

- `graph/` - Graph utilities for domain ordering (topological sort).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: explain shared domain abstractions.
- `ActorId.ts` - Role: value object; Purpose: identify the acting user/system.
- `AggregateRoot.ts` - Role: aggregate base; Purpose: collect and release domain events.
- `DomainBasics.spec.ts` - Role: domain tests; Purpose: verify ValueObject/AggregateRoot behavior.
- `DomainEvent.ts` - Role: domain event interface; Purpose: standardize event shape.
- `DomainEventName.ts` - Role: value object; Purpose: validate event names.
- `DomainError.ts` - Role: domain error model; Purpose: provide structured error codes/tags and predicates.
- `Entity.ts` - Role: entity base; Purpose: provide entity ID accessor.
- `IdGenerator.spec.ts` - Role: ID tests; Purpose: validate ID rules and prefix generators.
- `IdGenerator.ts` - Role: helper; Purpose: generate prefixed random IDs.
- `OccurredAt.ts` - Role: value object; Purpose: represent event occurrence time.
- `RehydratedValueObject.ts` - Role: rehydration base; Purpose: allow empty placeholder until repository rehydrate.
- `ValueObject.ts` - Role: value object base; Purpose: define equality contract.

## Examples

- `packages/v2/core/src/domain/table/Table.ts` - AggregateRoot usage.
- `packages/v2/core/src/domain/table/events/TableCreated.ts` - DomainEvent implementation.
- `packages/v2/core/src/domain/table/DbTableName.ts` - RehydratedValueObject usage.
- `packages/v2/core/src/domain/table/TableName.ts` - ValueObject usage.

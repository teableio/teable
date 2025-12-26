Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/services Architecture Notes

## Responsibilities

- Implement application services that coordinate repositories, schema updates, and event publishing.
- Provide transactional orchestration around domain mutations and specs.
- Keep domain logic inside domain model/visitors; this layer only wires ports.

## Files

- `FieldCreationSideEffectFlow.ts` - Role: application service; Purpose: apply cross-table side effects after field creation.
- `TableUpdateFlow.ts` - Role: application service; Purpose: shared table update workflow (mutate + persist + publish).

Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/specification Architecture Notes

## Responsibilities

- Specification pattern core abstractions and composition.
- Composition specs expose child accessors (e.g. `leftSpec`, `rightSpec`, `innerSpec`) for traversal helpers in adapters.
- Used for in-memory evaluation and persistence translation.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe spec core.
- `AndSpec.ts` - Role: spec composition; Purpose: AND two specs.
- `ISpecVisitor.ts` - Role: visitor interface; Purpose: define spec visit API.
- `ISpecification.ts` - Role: spec interface; Purpose: isSatisfiedBy/mutate/accept contract.
- `MutateOnlySpec.ts` - Role: spec base; Purpose: provide mutate-only specs with neutral isSatisfiedBy.
- `NotSpec.ts` - Role: spec composition; Purpose: negate a spec.
- `OrSpec.ts` - Role: spec composition; Purpose: OR two specs.
- `SpecBasics.spec.ts` - Role: tests; Purpose: verify basic spec behavior.
- `SpecBuilder.ts` - Role: builder base; Purpose: compose specs via and/or groups.

## Examples

- `packages/v2/core/src/domain/table/specs/TableSpecBuilder.spec.ts` - Spec builder usage.
- `packages/v2/core/src/ports/memory/MemoryTableRepository.ts` - isSatisfiedBy in memory filtering.

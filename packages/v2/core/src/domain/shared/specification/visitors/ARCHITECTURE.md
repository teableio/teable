Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/shared/specification/visitors Architecture Notes

## Responsibilities

- Spec visitor base classes and filter interfaces.
- Adapter layer uses these to translate specs into queries.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe spec visitors.
- `AbstractSpecFilterVisitor.ts` - Role: abstract base; Purpose: compose where conditions with and/or/not.
- `ISpecFilterVisitor.ts` - Role: interface; Purpose: expose where clause result.
- `NoopSpecVisitor.ts` - Role: no-op visitor; Purpose: placeholder or test default.

## Examples

- `packages/v2/core/src/domain/shared/specification/SpecBasics.spec.ts` - visitor + spec composition.

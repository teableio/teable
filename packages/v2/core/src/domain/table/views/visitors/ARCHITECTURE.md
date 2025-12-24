Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/views/visitors Architecture Notes

## Responsibilities

- View visitor interfaces and default implementations.
- Enable subtype-specific dispatch logic.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe view visitor role.
- `IViewVisitor.ts` - Role: visitor interface; Purpose: declare per-view visit methods.
- `CloneViewVisitor.ts` - Role: visitor; Purpose: clone view subtypes with same id/name.
- `NoopViewVisitor.ts` - Role: no-op visitor; Purpose: default empty implementation.

## Examples

- `packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.ts` - ViewVisitor implementation.

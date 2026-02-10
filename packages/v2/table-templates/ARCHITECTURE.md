Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/table-templates Architecture Notes

## Responsibilities

- Provide reusable table field templates for tests, benchmarks, and playgrounds.
- Expose template metadata (name/description) with creation helpers.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe template package role.
- `src/index.ts` - Role: templates entry; Purpose: export template builders and metadata.

## Examples

- `packages/v2/table-templates/src/index.ts` - Template definitions and creation helpers.

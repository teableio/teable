Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/views/types Architecture Notes

## Responsibilities

- Concrete view subtype implementations.
- Keep ViewType aligned with the entity subtype.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe view subtypes.
- `CalendarView.ts` - Role: view subtype; Purpose: calendar view entity.
- `FormView.ts` - Role: view subtype; Purpose: form view entity.
- `GalleryView.ts` - Role: view subtype; Purpose: gallery view entity.
- `GridView.ts` - Role: view subtype; Purpose: grid view entity.
- `KanbanView.ts` - Role: view subtype; Purpose: kanban view entity.
- `PluginView.ts` - Role: view subtype; Purpose: plugin view entity.

## Examples

- `packages/v2/core/src/domain/table/views/ViewFactory.ts` - View creation.

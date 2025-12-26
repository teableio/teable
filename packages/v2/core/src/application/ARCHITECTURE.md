Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application Architecture Notes

## Responsibilities

- Application services that orchestrate domain behavior and coordinate ports.
- Own cross-aggregate workflows, transactions, and event publishing boundaries.
- Must not contain domain rules; delegate those to domain services/entities/visitors.

## Subfolders

- `services/` - Application service implementations (orchestration only).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe application layer scope.

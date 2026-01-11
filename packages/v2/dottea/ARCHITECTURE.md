# v2/dottea Architecture Notes

## Responsibilities

- Parse `.tea` zip files and extract `structure.json` for v2 imports.
- Validate and normalize table/field/view structure payloads.
- Remain infrastructure-only (no domain writes).

## Files

- `ARCHITECTURE.md` - Role: package architecture note; Purpose: describe dottea parser scope.
- `src/index.ts` - Role: parser implementation; Purpose: read zip sources and return structure DTOs.

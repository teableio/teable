---
name: teable-v2-table-template
description: Create or update Teable v2 table templates in packages/v2/table-templates (template seeds, fields, records, and exports).
---

# Teable v2 Table Template Skill

Use this skill when you need to add or modify table templates in the v2 codebase. Templates live in `packages/v2/table-templates/src/index.ts`.

## Quick workflow

1. Open the template source file: `packages/v2/table-templates/src/index.ts`.
2. Add a seed builder:
   - Single table: create a `createXSeed(): SingleTableSeed`.
   - Multi table: create a `createXTemplateSeed(): TemplateSeed`.
3. Use helpers for IDs and select options:
   - `createFieldId()` for field IDs
   - `createTableId()` if you must predefine table IDs
   - `createSelectOption()` for single/multi-select choices
4. Create the template definition:
   - Single table: `singleTable(key, name, description, createXSeed, defaultRecordCount)`
   - Multi table: `createTemplate(key, name, description, createXTemplateSeed, defaultRecordCount)`
5. Export the template and add it to `tableTemplates` array.
6. If you need a field-only helper, export `createXFields = () => createXSeed().fields;`.

## Notes and conventions

- Keep templates in `packages/v2/table-templates/src/index.ts` (this package is the single source of truth).
- The `createInput` generator in `TableTemplateDefinition` handles optional record seeding and name prefixing. You only need to supply seed fields and records.
- Prefer `singleTable(...)` unless the template truly needs multiple tables (e.g., CRM with Companies + Contacts).
- Use string keys that are stable and URL-safe (e.g., `content-calendar`, `bug-triage`).
- When seeding records, keep records small and representative; use `normalizeTemplateRecords` behavior to cap or pad.
- New templates should cover as many field types as possible, as long as the business context makes sense (use `allFieldTypesTemplate` for inspiration).

## Example pattern

```ts
const createMyTemplateSeed = (): SingleTableSeed => {
  const nameFieldId = createFieldId();
  return {
    fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name' }],
    records: [{ fields: { [nameFieldId]: 'Example' } }],
  };
};

export const myTemplate = singleTable(
  'my-template',
  'My Template',
  'Short description.',
  createMyTemplateSeed,
  1
);

export const tableTemplates = [
  // ...existing templates,
  myTemplate,
] as const;
```

## References

- Source of truth: `packages/v2/table-templates/src/index.ts`
- Package note: `packages/v2/table-templates/ARCHITECTURE.md`
- E2E contract: ensure `creates tables for every template with seeded records` passes in `packages/v2/e2e`.
- Suggested run: `pnpm -C packages/v2/e2e test -- --runInBand --testNamePattern "creates tables for every template with seeded records"`

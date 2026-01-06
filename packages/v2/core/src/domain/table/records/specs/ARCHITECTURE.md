Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/records/specs Architecture Notes

## Core Principle (NON-NEGOTIABLE)

**All condition/filter handling MUST use the specification + visitor pattern.**

- Conditions are domain specifications (`RecordConditionSpec`)
- Translation to infrastructure (SQL, memory evaluation) happens via visitors
- NEVER directly parse condition objects with switch/if/match chains
- This ensures single source of truth, type safety, and consistency

```typescript
// ✅ CORRECT pattern
const spec = builder.build();              // Create spec via builder
const result = spec.accept(visitor);       // Translate via visitor

// ❌ WRONG - duplicates visitor logic
match(operator)
  .with('is', () => /* inline SQL */)
  .with('isNot', () => /* inline SQL */)
```

## Responsibilities

- Define record condition operators and values.
- Model record query conditions as specifications with field-aware visitors.
- Provide a spec builder for and/or/not composition.
- **Enforce visitor-based translation** for all condition consumers.

## Subfolders

- `visitors/` - Visitor interfaces and default no-op implementations.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record condition specs.
- `RecordConditionOperators.ts` - Role: operators; Purpose: define operators, date modes, and field-operator compatibility.
- `RecordConditionValues.ts` - Role: value objects; Purpose: wrap literals, lists, date modes, and field references.
- `RecordConditionSpec.ts` - Role: spec base; Purpose: common condition spec behavior and evaluation helpers.
- `RecordConditionSpecBuilder.ts` - Role: spec builder; Purpose: compose condition specs with and/or/not groups.
- `FieldConditionSpecBuilder.ts` - Role: field spec builder; Purpose: validate operator/value compatibility and create specs per field.
- `RecordConditionSpecFactory.ts` - Role: spec factory; Purpose: delegate spec creation via field-level builder.
- `SingleLineTextConditionSpec.ts` - Role: spec; Purpose: text conditions for single line fields.
- `LongTextConditionSpec.ts` - Role: spec; Purpose: text conditions for long text fields.
- `ButtonConditionSpec.ts` - Role: spec; Purpose: text conditions for button fields.
- `NumberConditionSpec.ts` - Role: spec; Purpose: number conditions for numeric fields.
- `RatingConditionSpec.ts` - Role: spec; Purpose: number conditions for rating fields.
- `CheckboxConditionSpec.ts` - Role: spec; Purpose: boolean conditions for checkbox fields.
- `DateConditionSpec.ts` - Role: spec; Purpose: date/time conditions for date fields.
- `SingleSelectConditionSpec.ts` - Role: spec; Purpose: conditions for single select fields.
- `MultipleSelectConditionSpec.ts` - Role: spec; Purpose: conditions for multiple select fields.
- `AttachmentConditionSpec.ts` - Role: spec; Purpose: empty/not-empty checks for attachments.
- `UserConditionSpec.ts` - Role: spec; Purpose: user conditions with single/multiple operators.
- `LinkConditionSpec.ts` - Role: spec; Purpose: link conditions including contains.
- `FormulaConditionSpec.ts` - Role: spec; Purpose: computed field conditions for formulas.
- `RollupConditionSpec.ts` - Role: spec; Purpose: computed field conditions for rollups.
- `ConditionalRollupConditionSpec.ts` - Role: spec; Purpose: conditions for conditional rollup fields.
- `ConditionalLookupConditionSpec.ts` - Role: spec; Purpose: conditions for conditional lookup fields.
- `ITableRecordConditionSpecVisitor.ts` - Role: visitor interface; Purpose: per-condition visit hooks for translation.

## Examples

- `packages/v2/core/src/domain/table/records/specs/RecordConditionSpecBuilder.ts` - Composing record condition specs.
- `packages/v2/core/src/domain/table/records/specs/FieldConditionSpecBuilder.ts` - Operator validation and field-level spec creation.

## Visitor Usage Pattern

All adapters that need to translate conditions MUST implement `ITableRecordConditionSpecVisitor`:

```typescript
// Adapter layer: translate spec to SQL
class TableRecordConditionWhereVisitor implements ITableRecordConditionSpecVisitor<SqlWhere> {
  visitSingleLineTextIs(spec: SingleLineTextConditionSpec): Result<SqlWhere, DomainError> {
    return buildIsCondition(spec.field(), spec.value());
  }
  // ... all other operators
}

// Usage in query builder
const spec = yield * fieldCondition.toRecordConditionSpec(table);
const visitor = new TableRecordConditionWhereVisitor();
const whereClause = yield * spec.accept(visitor);
query.where(whereClause);
```

This pattern ensures:

- Adding a new operator → TypeScript error until visitor is updated
- Adding a new field type → TypeScript error until spec is created
- All translation logic is centralized and testable

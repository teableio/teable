Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/formula-sql-pg Architecture Notes

## Responsibilities

- Convert Teable formula ASTs into PostgreSQL-safe SQL expressions.
- Apply lenient, safe type coercions and emit structured error strings instead of runtime errors.
- Support multi-value fields via JSON/array normalization and optional element-wise operations.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the package scope.
- `src/index.ts` - Role: package entry; Purpose: export translator API + shared types.
- `src/FormulaSqlPgTranslator.ts` - Role: orchestrator; Purpose: parse formula, build context, and run the visitor.
- `src/FormulaSqlPgVisitor.ts` - Role: AST visitor; Purpose: traverse formula nodes and delegate translation.
- `src/FormulaSqlPgExpressionBuilder.ts` - Role: expression builder; Purpose: type coercion, error propagation, and SQL fragment generation.
- `src/FormulaSqlPgFunctions.ts` - Role: function registry; Purpose: map formula functions to SQL implementations.
- `src/SqlExpression.ts` - Role: value model; Purpose: carry SQL + type/multiplicity + error metadata.
- `src/FieldSqlCoercionVisitor.ts` - Role: field visitor; Purpose: generate safe casts for field references.
- `src/PgSqlHelpers.ts` - Role: helper library; Purpose: shared SQL snippets for casting, arrays, and errors.
- `src/testkit/FormulaSqlPgTestkit.ts` - Role: test scaffold; Purpose: create tables/records via commands and evaluate formulas in Postgres.

## Examples

- `packages/v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts` - Formula translation entry.
- `packages/v2/formula-sql-pg/src/FormulaSqlPgVisitor.ts` - Node traversal and delegation.
- `packages/v2/formula-sql-pg/src/FormulaSqlPgExpressionBuilder.ts` - Core SQL building and coercions.

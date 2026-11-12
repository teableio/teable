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
- `src/FormulaOutputSql.ts` - Role: stored/transient result finalization; Purpose: share display extraction, scalar/array representation, numeric finalization and explicit formula-error handling.
- `src/UserSnapshotSql.ts` - Role: snapshot SQL; Purpose: share collaborator snapshot title/fallback handling without querying another metadata plane.
- `src/PgSqlHelpers.ts` - Role: helper library; Purpose: shared SQL snippets for casting, arrays, and errors.
- `src/testkit/FormulaSqlPgTestkit.ts` - Role: test scaffold; Purpose: create tables/records via commands and evaluate formulas in Postgres.

## Examples

- `packages/v2/formula-sql-pg/src/FormulaSqlPgTranslator.ts` - Formula translation entry.
- `packages/v2/formula-sql-pg/src/FormulaSqlPgVisitor.ts` - Node traversal and delegation.
- `packages/v2/formula-sql-pg/src/FormulaSqlPgExpressionBuilder.ts` - Core SQL building and coercions.

## Compilation and sharing

The parser visitor produces `FormulaExpressionNode` objects in a per-compilation
`FormulaExpressionGraph`. Operators and function calls retain child references;
formula fields retain their identity and point to their defining expression.
Repeated calls and diamond dependencies share nodes. The graph must not contain
SQL obtained by recursively expanding a formula field.

`FormulaSqlPgLowering` visits each graph node once. It uses the existing function
and coercion implementations to infer the physical SQL type and produces typed
`SqlExpr` references for the next node. Keep `valueType`, `isArray`, `storageKind`
and field formatting identity together. In particular, IF/SWITCH must normalize
mixed native-array/JSONB branches before reporting JSONB storage.

`FormulaSqlPgBindings` bounds expansion: literals/columns and short single-use
expressions stay inline; shared expressions and large fragments receive lazy,
formula-local MATERIALIZED CTEs. Value, display, error condition and error message
are independent outputs. A scalar reference to a CTE is demanded by its consumer,
so an unselected IF branch does not execute merely because it has a shared binding.
A plain derived-table alias is insufficient: PostgreSQL may inline it again.
Statement-stable functions such as NOW can share within one compilation. Any new
volatile or effectful formula operation needs an explicit sharing policy before
it is added to the graph's interned calls.

`translateExpression` still returns standalone SQL channels for existing callers.
When combining channels or adding host casts, use
`translator.renderExpression(expr, raw => ...)` so the final SQL has one shared
binding scope. `renderSql` does this for display/error rendering. Computed UPDATE
builders do it for typed values. Use `translateExpressions` / `renderExpressions` for multiple independent outputs.
The batch builder groups same-level formulas by time zone and compiles each group
with one graph and binding scope, so different formulas also share common subtrees.
Batch-level formula dependencies remain references to prior CTE columns; consumed computed layers and same-layer CSE have optimizer
boundaries tested against native PostgreSQL.

`TODAY()` computes the current calendar date and its midnight instant entirely in
PostgreSQL using the defining formula field's time zone, not the JavaScript host
or database session time zone. Recursive formula references retain that defining
zone in the expression graph; ordinary lowering and fused array operations use
the same zone for their coercions. A referencing field may format the result in
another zone, but must not reinterpret the referenced formula's midnight.

Reference-map mode binds an exact alias to a real field plus its SQL resolver, or to a
domain-typed system/parameter value. Field references still pass through the same field/lookup
resolution and coercion used by table mode; adapters must not turn all JSON-backed fields into
primitive text or construct an alternate formula type system. Masks belong in the supplied input
SQL. A masked user snapshot must not regain a value through an actor fallback.

Stored computed fields and transient query projections use `finalizeFormulaOutputSql` inside the
translator's render scope. Scalar outputs cross the inferred physical storage boundary in SQL:
String becomes text, Datetime becomes timestamptz, and Number retains stored float8 behavior.
Mixed conditional branches therefore match their stored text representation before alias sorting;
naive date results cannot acquire the Node process time zone during driver decoding. A wire
`numberOrString` is not an exact-NUMERIC formula promise. Transient query compilation takes the
routed formula policy in enforce mode, including the final rendered SQL size. It also opts into
a 1 MiB UTF-8 byte limit per `REPT` intermediate before allocation; omitted `maxReptBytes` preserves
stored formula behavior. Nested/lazy branches retain their ordinary evaluation semantics.

## Regression acceptance

- `FormulaExpressionGraph.spec.ts`: graph identity, dependency sharing, branches,
  field distinction and compilation isolation.
- `FormulaCompilerAcceptance.spec.ts`: incident formula, repeated expensive
  subexpressions, formula diamond, depth growth, dead branches and errors.
- `ConditionalArrayStorage*.spec.ts`, `ConditionalErrorPropagation.spec.ts`:
  physical branch types, selected errors and SQL NULL behavior.
- `adapter-table-repository-postgres/.../SameTableBatchQueryBuilder.pg-plan.spec.ts`:
  production UPDATE SQL on PostgreSQL 16/17, actual extraction loops, plan size and
  PostgreSQL 17 planner memory. Its dedicated CI workflow uses memory-limited
  database containers and retains SQL, parameters, plans and server evidence.

SQL snapshots remain useful for review, but changing their text is not proof of
correctness or bounded database work. Compare result portions separately and run
the native plan gate. Do not increase plan budgets solely to make a regression pass.

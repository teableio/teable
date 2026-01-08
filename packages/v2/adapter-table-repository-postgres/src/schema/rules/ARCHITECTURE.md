# Schema Rules System

This directory contains the schema rule system for managing PostgreSQL table schemas in a modular, composable way.

## Overview

The schema rule system abstracts database schema operations (creating columns, indexes, constraints, etc.) into discrete, reusable rule objects. Each rule represents an atomic schema capability with three operations:

- **up**: Generate SQL statements to apply the rule
- **down**: Generate SQL statements to revert the rule
- **isValid**: Validate whether the current database state satisfies the rule

## Directory Structure

```
rules/
├── ARCHITECTURE.md         # This file
├── index.ts                # Main exports
├── context/
│   ├── SchemaIntrospector.ts       # Interface for querying database schema
│   ├── PostgresSchemaIntrospector.ts # PostgreSQL implementation
│   └── SchemaRuleContext.ts        # Context passed to rules
├── core/
│   └── ISchemaRule.ts              # Core rule interface
├── field/
│   ├── ColumnRule.ts               # Standard column creation
│   ├── FkColumnRule.ts             # Foreign key column
│   ├── ForeignKeyRule.ts           # FK constraint
│   ├── GeneratedColumnRule.ts      # GENERATED ALWAYS AS column
│   ├── IndexRule.ts                # Regular index
│   ├── UniqueIndexRule.ts          # Unique index
│   ├── JunctionTableRule.ts        # Junction table for ManyMany/OneWay
│   ├── LinkValueColumnRule.ts      # JSONB column for link display values
│   ├── OrderColumnRule.ts          # Order column for link sorting
│   ├── ReferenceRule.ts            # Reference table entries
│   ├── FieldMetaRule.ts            # Field metadata updates
│   └── FieldSchemaRulesFactory.ts  # Factory to create rules from fields
├── helpers/
│   └── StatementBuilders.ts        # SQL statement builder utilities
├── resolver/
│   └── SchemaRuleResolver.ts       # Dependency resolution and execution
└── checker/
    ├── SchemaCheckResult.ts        # Check result types and helpers
    └── SchemaChecker.ts            # Async generator for streaming validation
```

## Key Concepts

### ISchemaRule Interface

```typescript
interface ISchemaRule {
  readonly id: string; // Unique identifier
  readonly dependencies: ReadonlyArray<string>; // Rules that must run first
  readonly required: boolean; // Required vs optional

  isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>>;
  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
}
```

### Rule Dependencies

Rules can declare dependencies on other rules. The `SchemaRuleResolver` uses topological sorting to ensure dependencies are executed first. For example:

- `IndexRule` depends on `ColumnRule` (can't index a column that doesn't exist)
- `ForeignKeyRule` depends on `FkColumnRule`

### SchemaIntrospector

The `SchemaIntrospector` interface abstracts database schema queries. The PostgreSQL implementation queries `information_schema` and `pg_catalog` to check for existing columns, indexes, constraints, etc.

### Field Rules Factory

The `FieldSchemaRulesFactory` uses the visitor pattern to map each field type to its required schema rules:

- **SingleLineTextField**: `ColumnRule`
- **FormulaField**: `ColumnRule` + `ReferenceRule`
- **LinkField**: `LinkValueColumnRule` + `ReferenceRule` + (junction table OR FK columns + indexes + constraints)
- **CreatedTimeField**: `GeneratedColumnRule`

## Usage

```typescript
import {
  createFieldSchemaRules,
  createSchemaRuleContext,
  PostgresSchemaIntrospector,
  schemaRuleResolver,
} from "./rules";

// Create context
const introspector = new PostgresSchemaIntrospector(db);
const ctx = createSchemaRuleContext({
  db,
  introspector,
  schema: "my_base_id",
  tableName: "my_table_id",
  tableId: "my_table_id",
  field,
});

// Create rules for a field
const rulesResult = createFieldSchemaRules(field, {
  schema: ctx.schema,
  tableName: ctx.tableName,
  tableId: ctx.tableId,
});

// Generate UP statements
const statementsResult = schemaRuleResolver.upAll(rules, ctx);

// Validate rules
const validationResult = await schemaRuleResolver.validateAll(rules, ctx);
```

## Schema Checker

The `SchemaChecker` provides an async generator for streaming validation results. This is useful for UI feedback during schema validation.

```typescript
import { createSchemaChecker, PostgresSchemaIntrospector } from "./rules";

const introspector = new PostgresSchemaIntrospector(db);
const checker = createSchemaChecker({ db, introspector, schema: null });

// Stream results for each field and rule
for await (const result of checker.checkTable(table)) {
  // result: SchemaCheckResult
  // - status: 'success' | 'error' | 'warn' | 'running' | 'pending'
  // - fieldId, fieldName, ruleId, ruleDescription
  // - message, details (missing/extra schema objects)
  console.log(result);
}
```

### Check Result Types

- **pending**: Rule not yet started
- **running**: Rule currently being validated
- **success**: Rule validation passed (✓)
- **error**: Required rule failed (✗)
- **warn**: Optional rule not satisfied (⚠)

### Dependency Handling

Rules with dependencies are only checked after their dependencies pass. If a dependency fails, dependent rules are skipped with an error message.

## Design Principles

1. **Single Responsibility**: Each rule handles one schema concern
2. **Composability**: Rules can be combined to form complex schemas
3. **Dependency Management**: Rules declare dependencies, resolver handles ordering
4. **Idempotency**: `up` uses `IF NOT EXISTS`, `down` uses `IF EXISTS`
5. **No Exceptions**: All operations return `Result<T, DomainError>`
6. **No DI Required**: Rules are plain classes, no dependency injection needed
7. **Streaming Validation**: `SchemaChecker` yields results as async generator for real-time UI updates

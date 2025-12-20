# Teable v2 (DDD) agent guide

This repo is introducing a new `packages/v2/*` architecture. Keep `v2` strict and boring: **domain first**, **interfaces first**, **Result-only errors**, **specifications for querying**, **builders/factories for creation**.

## v2 layering (strict)

`packages/v2/core` is the domain/core.

- **Allowed dependencies (inside `v2/core`)**
  - `neverthrow` for `Result`
  - `zod` for validation (`safeParse` only)
  - `nanoid` for ID generation
  - `ts-pattern` for match pattern
  - `@teable/v2-di` is allowed only in `src/commands/**` (application wiring), not in domain
  - Pure TS/JS standard library
- **Forbidden inside `v2/core`**
  - No NestJS, Prisma, HTTP, queues, DB clients, file system, env access
  - No direct infrastructure code
  - No `throw` / exceptions for control flow

Future adapters live in their own workspace packages under `packages/v2/*` and depend on `@teable/v2-core` (never the other way around).

## v2 API contracts (HTTP)

For HTTP-ish integrations, keep framework-independent contracts/mappers in `packages/v2/contract-http`:

- Define API paths (e.g. `/tables`) as constants.
- Re-export command input schemas (zod) for route-level validation if needed.
- Keep DTO types + domain-to-DTO mappers here.
- Router packages (e.g. `@teable/v2-contract-http-express`, `@teable/v2-contract-http-fastify`) should be thin adapters that only:
  - parse JSON/body
  - create a container
  - resolve handlers
  - call the endpoint executor/mappers from `@teable/v2-contract-http`
- OpenAPI is generated from the ts-rest contract via `@teable/v2-contract-http-openapi`.

## Dependency injection (DI)

- Do not import `tsyringe` / `reflect-metadata` directly anywhere; use `@teable/v2-di`.
- Do not use DI inside `v2/core/src/domain/**`; DI is only for application wiring (e.g. `v2/core/src/commands/**`).
- Prefer constructor injection with explicit tokens for ports (interfaces).
- Provide environment-level composition roots as separate packages (e.g. `@teable/v2-container-node`, `@teable/v2-container-browser`) that register all port implementations.

## Tracing (DDD)

- Tracing is an application/port concern; never use tracing decorators or tracer interfaces in `packages/v2/core/src/domain/**`.
- Use `@TraceSpan(...)` only in `packages/v2/core/src/commands/**` (and other app handlers) to wrap spans.
- Real tracing happens in adapters by supplying an `ITracer` implementation; core defaults should be no-op.
- Keep span attributes minimal and avoid PII unless explicitly required.

## Command/Event mediator (bus)

- Command handlers are registered via `@CommandHandler(Command)` and invoked through `ICommandBus.execute(...)`.
- Event handlers are registered via `@EventHandler(Event)` and invoked through `IEventBus.publish(...)`/`publishMany(...)`.
- Do not resolve handlers directly from the container in business code or adapters; always go through the bus.
- `ICommandBus`/`IEventBus` are ports; default in-memory implementations live in `v2/core/src/ports/memory` and can be swapped by adapters (RxJS/Kafka/etc).
- Containers must register `v2CoreTokens.commandBus` and `v2CoreTokens.eventBus`.

## Query mediator (bus)

- Query handlers are registered via `@QueryHandler(Query)` and invoked through `IQueryBus.execute(...)`.
- Do not resolve query handlers directly from the container in business code or adapters; always go through the bus.
- `IQueryBus` is a port; default in-memory implementations live in `v2/core/src/ports/memory`.
- Containers must register `v2CoreTokens.queryBus`.

## Unit of work (transactions)

- Cross-repository workflows in commands must be wrapped in `IUnitOfWork.withTransaction(...)`.
- Repositories should reuse `IExecutionContext.transaction` when present (do not start nested transactions).
- Postgres implementation lives in `@teable/v2-db-postgres` (`PostgresUnitOfWork`, `PostgresUnitOfWorkTransaction`); register it in containers.
- Publish domain events only after transactional work succeeds.

## Build tooling (v2)

- v2 packages build with `tsdown` (not `tsc` emit). `tsc` is used only for `typecheck` (`--noEmit`).
- Each v2 package has a local `tsdown.config.ts` that extends the shared base config from `@teable/v2-tsdown-config`.
- Outputs are written to `dist/` (CommonJS `.js` + `.d.ts`), and workspace deps (`@teable/v2-*`) are kept external (no bundling across packages).

## Error handling (non-negotiable)

- **Never throw in `v2/core`.**
- Use `neverthrow` `Result` everywhere.
- If something isn’t implemented yet: return `err('Not implemented')` (or a typed error string).
- Use `zod.safeParse(...)` and convert failures into `err(...)` (no `parse()`).

## Type system rules (non-negotiable)

Inside `v2/core` domain APIs:

- Do not use raw primitives (`string`, `number`, `boolean`) as domain parameters/returns for domain concepts.
- Use **Value Objects** / **branded types** for IDs, names, and key concepts.
- IDs are **nominal** (not structurally compatible): `FieldId` must not be assignable to `ViewId`.
- Raw primitives are allowed only at the **outer boundary** (DTOs) and must be immediately validated and converted via factories/builders.

Practical exceptions that are required by the architecture:

- `neverthrow` error side uses strings (e.g. `Result<T, string>`).
- The Specification interface requires `isSatisfiedBy(...): boolean`.
- Value Objects may expose `toString()` / `toDate()` / `toNumber()` for adapter/serialization boundaries (avoid using these in domain logic).
- Rehydration-only Value Objects (e.g. `DbTableName`, `DbFieldName`) must extend `RehydratedValueObject`; create empty placeholders in domain, set real values only via repository rehydrate, and return `err(...)` when accessed before rehydrate.

## Builders/factories (non-negotiable)

- Do not `new Table()` / `new Field()` / `new View()` outside factories/builders.
- Table creation must go through the **TableBuilder** (the public creation API).
- Value Objects are created via static factory methods that validate with `zod`.
- Builder configuration methods should be fluent (return the builder) and must not throw; validation/creation errors are surfaced via `build(): Result<...>`.

## Specification pattern (required)

Repositories query via specifications, not ad-hoc filters.

- Implement `ISpecification` exactly as defined in `v2/core`.
- Provide composable specs (`AndSpec`, `OrSpec`, `NotSpec`).
- `accept(visitor)` is wired for future translation into persistence queries.
- Build specs via entity spec builders (e.g. `Table.specs(baseId)`); do not `new` spec classes directly.
- Each spec targets a single attribute (e.g. `TableByNameSpec` only checks name). `BaseId` is its own spec and is composed via `and/or/not`.
- `and` and `or` must be separated by nesting (use `andGroup`/`orGroup`); never mix them at the same level. BaseId specs are auto-included by the builder unless explicitly disabled.
- Spec visitors rely on `visit(spec)` + type narrowing inside the visitor; avoid per-spec visitor interfaces or `isWith*` guards.

## Visitor pattern (preferred)

- For multi-type logic that already has a visitor (fields, specs, etc.), prefer a dedicated visitor file over switch/if chains.
- Keep type-to-value mappings in visitors so new types require explicit visitor updates.

## Folder conventions (recommended)

Inside `packages/v2/core/src`:

- `domain/` — aggregates, entities, value objects, domain events
- `specification/` — spec framework + visitors
- `ports/` — interfaces/ports (repositories, event bus/publisher, mappers)
- `commands/` — commands + handlers (application use-cases over domain)
- `queries/` — queries + handlers (application read use-cases over domain)

## Naming conventions

- Value Objects: `*Id`, `*Name` (e.g. `TableId`, `FieldName`)
- Commands: `*Command`
- Queries: `*Query`
- Handlers/use-cases: `*Handler`
- Domain events: past tense (e.g. `TableCreated`)
- Specifications: `*Spec` (e.g. `TableByIdSpec`)

## Adding a new field type

1. Add a new field subtype under `domain/table/fields/types/`.
2. Add any new value objects/config under the same subtree.
3. Extend the table builder with a new field child-builder:
   - add `TableFieldBuilder.<newType>()` (in `domain/table/TableBuilder.ts`)
   - implement a `<NewType>FieldBuilder` with fluent `with...()` methods and `done(): TableBuilder`
4. Update `IFieldVisitor` (and any visitors like `NoopFieldVisitor`) to support the new field subtype.
5. Update `CreateTableCommand` input validation to allow the new type.

## Adding a repository adapter later

1. Keep the port in `v2/core/src/ports/TableRepository.ts`.
2. Implement the adapter in a separate package (e.g. `packages/v2/adapter-postgres-state`).
3. Translate Specifications via a visitor (start with the stub visitor in `v2/core`).
4. Map persistence DTOs <-> domain using mapper interfaces from `v2/core/src/ports/mappers`.

## Testing expectations (minimal)

## Testing strategy (domain → e2e)

v2 uses a layered test strategy. The same behavior should usually be asserted **once** at the most appropriate layer (avoid duplicating identical assertions across many layers).

### 1) Domain unit tests (`v2/core` domain)

**Where**

- `packages/v2/core/src/domain/**/*.spec.ts`

**Focus**

- Value Object validation (`.create(...)` + `zod.safeParse`)
- Aggregate/entity behavior and invariants
- Builder behavior (`Table.builder()...build()`), including default view behavior
- Domain event creation/recording (e.g. `TableCreated`)
- Specification correctness for in-memory satisfaction (`isSatisfiedBy`)

**Must NOT do**

- No DI/container, no repositories/ports, no DB, no HTTP, no filesystem, no timeouts
- No infrastructure DTOs (HTTP/persistence) and no framework code

**What to assert**

- `Result` is `ok/err` (never exceptions)
- Invariants on returned domain objects (counts, names, IDs are nominal types, etc.)
- Domain events are produced and contain essential info (do not snapshot the entire object)

### 2) Application/use-case tests (`v2/core` commands + DI)

**Where**

- Prefer `packages/v2/test-node/src/**/*.spec.ts` (a dedicated test package)

**Focus**

- Handler orchestration (build aggregate, call repository, publish events)
- Correct `Result` behavior for ok/err paths
- Command-level validation (invalid input → `err(...)`)
- Correct wiring via DI (handlers resolved from container; do not `new Handler(...)` in tests)

**Allowed**

- Fakes/in-memory ports (recommended) OR the node-test container (pglite-backed) when you want a slightly higher-confidence integration without HTTP.

**What to assert**

- Handler returns expected status (`ok/err`) and minimal returned data (e.g. created table name)
- Domain events were published (e.g. contains `TableCreated`)
- Repository side-effect happened (either “save called” via fake, or “can be queried back” via `findOne(spec)`)

### 3) Adapter integration tests (persistence/infra adapters)

**Where**

- `packages/v2/adapter-*/src/**/*.spec.ts`

**Focus**

- Spec → query translation via Spec Visitors (no ad-hoc where parsing)
- Mapper correctness (persistence DTO ↔︎ domain)
- Repository behavior against a real DB driver

**Allowed**

- `pglite` for tests (fast, hermetic)

**What to assert**

- Round-trips: save → query by spec → domain object matches essentials
- Visitor builds the expected query constraints (at least for supported specs)

### 4) Contract tests (`contract-http`)

**Where**

- `packages/v2/contract-http/src/**/*.spec.ts` (optional but recommended for mapping-heavy endpoints)

**Focus**

- DTO mappers and endpoint executors
- Contract response shapes and status codes

**What to assert**

- `execute*Endpoint(...)` returns only the status codes declared in the contract
- Response DTO structure matches schema intent (avoid deep snapshots)

### 5) Router adapter tests (Express/Fastify)

**Where**

- `packages/v2/contract-http-express/src/**/*.spec.ts`
- `packages/v2/contract-http-fastify/src/**/*.spec.ts`

**Focus**

- Framework glue: request parsing, ts-rest integration, error mapping
- Container creation is correct and lazy (don’t eagerly connect to PG when a custom container is injected)

**What to assert**

- Valid request → expected status/result
- Invalid request → 400 (schema validation)

### 6) E2E tests (`v2/e2e`)

**Where**

- `packages/v2/e2e/src/**/*.e2e.spec.ts`

**Focus**

- “Over-the-wire” HTTP behavior using the generated ts-rest client
- Cross-package integration: router + contract + container + repository adapter

**Allowed**

- Start an in-process server on an ephemeral port (no fixed ports)
- Use the node-test container with `pglite` and ensure proper cleanup (`dispose`)

**What to assert**

- HTTP status codes and response DTOs (validate shape, not internal domain objects)
- Minimal business outcome (e.g. table created, includes `TableCreated` event)

## Quality checks (required for big changes)

- After substantial changes, run `pnpm -C packages/v2/<pkg> typecheck` and `pnpm -C packages/v2/<pkg> lint` for each affected package and report any failures.
- Resolve any TypeScript errors before marking the task complete.
- Run eslint with auto-fix (`pnpm -C packages/v2/<pkg> lint -- --fix` or `pnpm -C packages/v2/<pkg> fix-all-files`) and format the touched files before completion.

Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# di Architecture Notes

## Responsibilities

- Provide centralized DI registration for v2 core internal services.
- Allow external containers to override default implementations.
- Eliminate registration duplication across container packages.
- Register read-only preparation services under `v2CoreTokens`: handlers, dry-run queries and preview planners consume the same injected preparation service. Production callers must not construct preparation services manually or provide default service instances.
- Preserve host overrides by registering them before `registerV2CoreServices`. Explain overlays use a child container with explicit overlay repositories and update-flow dependencies; they must not resolve preparation against the live repository.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe DI registration scope.
- `index.ts` - Role: barrel export; Purpose: re-export registration utilities.
- `registerCoreServices.ts` - Role: registration utility; Purpose: register all core application services with override support.

## Usage Pattern

```typescript
// In container packages (e.g. @teable/v2-container-node):
import { registerV2CoreServices, v2CoreTokens } from "@teable/v2-core";
import { Lifecycle } from "@teable/v2-di";

// 1. Register infrastructure first (ports implementations)
c.register(v2CoreTokens.tableRepository, PostgresTableRepository);
c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork);
// ...

// 2. Optionally override core services BEFORE calling registerV2CoreServices
// c.register(v2CoreTokens.tableQueryService, CustomTableQueryService);

// 3. Register core services (skips already-registered tokens)
registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });
```

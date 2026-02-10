# Teable v2 agent guide

DDD/domain-model guidance has moved to the skill `teable-ddd-domain-model` in `.codex/skills/teable-ddd-domain-model`. Use that skill for any v2/core domain, specification, or aggregate changes.

## Git hygiene

- Ignore git changes that you did not make by default; never revert unknown/unrelated modifications unless explicitly instructed.

## v2 API contracts (HTTP)

For HTTP-ish integrations, keep framework-independent contracts/mappers in `packages/v2/contract-http`:

- Define API paths (e.g. `/tables`) as constants.
- Use action-style paths with camelCase action names (e.g. `/tables/create`, `/tables/get`, `/tables/rename`); avoid RESTful nested resources like `/bases/{baseId}/tables/{tableId}`.
- Re-export command input schemas (zod) for route-level validation if needed.
- Keep DTO types + domain-to-DTO mappers here.
- Router packages (e.g. `@teable/v2-contract-http-express`, `@teable/v2-contract-http-fastify`) should be thin adapters that only:
  - parse JSON/body
  - create a container
  - resolve handlers
  - call the endpoint executor/mappers from `@teable/v2-contract-http`
- OpenAPI is generated from the ts-rest contract via `@teable/v2-contract-http-openapi`.

## UI components (frontend)

- In app UIs (e.g. `apps/playground`), use shadcn wrappers from `apps/playground/src/components/ui/*` (or `@teable/ui-lib`) instead of importing Radix primitives directly.
- If a shadcn wrapper is missing, add it under `apps/playground/src/components/ui` before using the primitive.

## Dependency injection (DI)

- Do not import `tsyringe` / `reflect-metadata` directly anywhere; use `@teable/v2-di`.
- Do not use DI inside `v2/core/src/domain/**`; DI is only for application wiring (e.g. `v2/core/src/commands/**`).
- Prefer constructor injection with explicit tokens for ports (interfaces).
- Provide environment-level composition roots as separate packages (e.g. `@teable/v2-container-node`, `@teable/v2-container-browser`) that register all port implementations.

## Build tooling (v2)

- v2 packages build with `tsdown` (not `tsc` emit). `tsc` is used only for `typecheck` (`--noEmit`).
- Each v2 package has a local `tsdown.config.ts` that extends the shared base config from `@teable/v2-tsdown-config`.
- Outputs are written to `dist/` (ESM `.js` + `.d.ts`), and workspace deps (`@teable/v2-*`) are kept external (no bundling across packages).

## Source visibility (v2 packages)

**All v2 packages must support source visibility** to allow consumers to reference TypeScript sources without building `dist/` outputs. This is required for development workflows, testing, and tools like Vitest/Vite that can consume TypeScript directly.

**Required configuration:**

- In `package.json`:
  - Set `types` field to `"src/index.ts"` (not `"dist/index.d.ts"`)
  - Set `exports["."].types` to `"./src/index.ts"` (not `"./dist/index.d.ts"`)
  - Set `exports["."].import` to `"./src/index.ts"` (not `"./dist/index.js"`) to allow Vite/Vitest to use source files directly
  - Keep `exports["."].require` pointing to `"./dist/index.cjs"` for CommonJS compatibility
  - Include `"src"` in the `files` array (in addition to `"dist"`)
- In `tsconfig.json`:
  - Map workspace dependencies to their `src` paths in `compilerOptions.paths` (e.g. `"@teable/v2-core": ["../core/src"]`)
  - Include those source paths in the `include` array

**Example `package.json` configuration:**
```json
{
  "types": "src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "src"]
}
```

**Note:** Since v2 packages are workspace-only (`"private": true`) and not published to npm, pointing `import` to source files is safe. Vite/Vitest can process TypeScript files directly, enabling faster development cycles without requiring `dist/` to be built first.

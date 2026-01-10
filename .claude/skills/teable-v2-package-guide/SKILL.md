# Teable V2 Package Creation Guide

## When to Use This Skill

Use this skill when you need to:
- Create a new v2 package
- Configure package.json for v2 packages
- Set up TypeScript configuration
- Understand the v2 package conventions

## Package Location

All v2 packages are located in `packages/v2/` directory.

## Creating a New Package

### 1. Directory Structure

```
packages/v2/<package-name>/
├── src/
│   └── index.ts          # Main entry point
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── tsdown.config.ts      # Optional, for custom build config
```

### 2. Package.json Configuration

**IMPORTANT: Development-Friendly Exports**

The key to avoiding rebuilds during development is the `exports` configuration:

```json
{
  "name": "@teable/v2-<package-name>",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "module": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "src"
  ],
  "scripts": {
    "build": "tsdown --tsconfig tsconfig.build.json",
    "dev": "tsdown --tsconfig tsconfig.build.json --watch",
    "clean": "rimraf ./dist ./coverage ./tsconfig.tsbuildinfo ./tsconfig.build.tsbuildinfo ./.eslintcache",
    "lint": "eslint . --ext .ts,.js,.mjs,.cjs,.mts,.cts --cache --cache-location ../../../.cache/eslint/v2-<package-name>.eslintcache",
    "typecheck": "tsc --project ./tsconfig.json --noEmit",
    "test-unit": "vitest run --silent",
    "test-unit-cover": "pnpm test-unit --coverage",
    "fix-all-files": "eslint . --ext .ts,.js,.mjs,.cjs,.mts,.cts --fix"
  },
  "dependencies": {
    // Add your dependencies here
  },
  "devDependencies": {
    "@teable/v2-tsdown-config": "workspace:*",
    "@teable/eslint-config-bases": "workspace:^",
    "@types/node": "22.18.0",
    "@vitest/coverage-v8": "4.0.16",
    "eslint": "8.57.0",
    "prettier": "3.2.5",
    "rimraf": "5.0.5",
    "tsdown": "0.18.1",
    "typescript": "5.4.3",
    "vite-tsconfig-paths": "4.3.2",
    "vitest": "4.0.16"
  }
}
```

### Key Export Configuration Explained

```json
"exports": {
  ".": {
    "types": "./src/index.ts",     // TypeScript types from source
    "import": "./src/index.ts",    // ESM import uses source directly
    "module": "./dist/index.js",   // Bundlers use built output
    "require": "./dist/index.cjs"  // CommonJS uses built output
  }
}
```

**Why this works:**
- `types` and `import` point to `./src/index.ts` - this allows other packages to import TypeScript source directly during development
- `module` and `require` point to `./dist/` - this is used by bundlers and production builds
- No rebuild needed when you change source code - other packages see changes immediately

### 3. TypeScript Configuration

**tsconfig.json** (for development/typechecking):
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**tsconfig.build.json** (for building):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "**/*.spec.ts", "**/*.test.ts"]
}
```

### 4. Build Configuration (Optional)

**tsdown.config.ts**:
```typescript
import { defineConfig } from '@teable/v2-tsdown-config';

export default defineConfig();
```

## Common Patterns

### Workspace Dependencies

Use `workspace:*` for internal dependencies:
```json
"dependencies": {
  "@teable/v2-core": "workspace:*",
  "@teable/v2-di": "workspace:*"
}
```

### Dependency Injection

V2 packages use `@teable/v2-di` for DI:
```typescript
import { injectable, inject } from '@teable/v2-di';

@injectable()
export class MyService {
  constructor(
    @inject(someToken) private readonly dependency: SomeDependency
  ) {}
}
```

### Error Handling

Use `neverthrow` for Result types:
```typescript
import { ok, err, Result } from 'neverthrow';
import { domainError, type DomainError } from '@teable/v2-core';

function doSomething(): Result<Data, DomainError> {
  if (error) {
    return err(domainError.invariant({ message: 'Something went wrong' }));
  }
  return ok(data);
}
```

## Checklist for New Package

- [ ] Create directory `packages/v2/<package-name>/`
- [ ] Create `src/index.ts` with exports
- [ ] Configure `package.json` with correct exports (pointing to source)
- [ ] Create `tsconfig.json` and `tsconfig.build.json`
- [ ] Add to root `pnpm-workspace.yaml` if needed
- [ ] Run `pnpm install` to link workspace dependencies
- [ ] Verify imports work without building: `pnpm typecheck`

## Troubleshooting

### "Cannot find module" errors
1. Check that `exports` in `package.json` points to correct paths
2. Ensure `types` field points to `src/index.ts`
3. Run `pnpm install` to refresh workspace links

### Changes not reflected in other packages
1. Verify `exports.import` points to `./src/index.ts` (not `./dist/`)
2. Check if the consuming package has cached the old build
3. Restart TypeScript server in your IDE

### Build errors
1. Ensure `tsconfig.build.json` excludes test files
2. Check that all dependencies are properly declared
3. Run `pnpm clean` before rebuilding

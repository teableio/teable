# @teable/core

> **Note**
> This package is part of [teableio/teable](https://github.com/teableio/teable).

A package holding some basic typescript utilities: typeguards, assertions...

- [x] Packaged as ES module (type: module in package.json).
- [x] Can be build with tsup (no need if using tsconfig aliases).
- [x] Simple unit tests demo with either Vitest (`pnpm test-unit`) or TS-Jest (`pnpm test-unit-jest`).

## Install

From any package or apps:

```bash
yarn add @teable/core@"workspace:^"
```

## Enable aliases

```json5
{
  //"extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@teable/core": ["../../../packages/core/src/index"],
    },
  },
}
```

## Consume

```typescript
import { isPlainObject } from "@teable/core";

isPlainObject(true) === false;
```

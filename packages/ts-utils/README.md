# @teable-group/ts-utils

> **Note**
> This package is part of [belgattitude/nextjs-monorepo-example](https://github.com/belgattitude/nextjs-monorepo-example).

A package holding some basic typescript utilities: typeguards, assertions...

- [x] Packaged as ES module (type: module in package.json).
- [x] Can be build with tsup (no need if using tsconfig aliases).
- [x] Simple unit tests demo with either Vitest (`yarn test-unit`) or TS-Jest (`yarn test-unit-jest`).

## Install

From any package or apps:

```bash
yarn add @teable-group/ts-utils@"workspace:^"
```

## Enable aliases

```json5
{
  //"extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@teable-group/ts-utils": ["../../../packages/ts-utils/src/index"],
    },
  },
}
```

## Consume

```typescript
import { isPlainObject } from "@teable-group/ts-utils";

isPlainObject(true) === false;
```

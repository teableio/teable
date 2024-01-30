# @teable/common-i18n

<p align="left">
  <a aria-label="Build" href="https://github.com/teableio/teable/actions?query=workflow%3ACI">
    <img alt="build" src="https://img.shields.io/github/workflow/status/teableio/teable/CI-web-app/main?label=CI&logo=github&style=flat-quare&labelColor=000000" />
  </a>
</p>

## Intro

One possible way to share locales amongst apps in the monorepo.

### Usage

Add the workspace dependency to the consuming app or package.

```bash
yarn add @teable/common-locales:"workspace:^"
```

Add an alias in tsconfig.js to enable fast-refresh.

```json5
{
  "compilerOptions": {
    "paths": {
      "@teable/common-i18n": ["../../../packages/common-i18n/src/index"],
      "@teable/common-i18n/locales/*": ["../../../packages/common-i18n/src/locales/*"],
    },
  },
}
```

Optionally create a file named `./types.d/react-i18next.d.ts` to enable typechecks and autocompletion of keys.

```typescript
import "react-i18next";
import type { I18nNamespaces } from "@teable/common-i18n";

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: I18nNamespaces;
  }
}
```

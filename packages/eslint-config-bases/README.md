# @teable/eslint-config-bases

<p align="left">
  <a aria-label="Build" href="https://github.com/teableio/teable/actions?query=workflow%3ACI">
    <img alt="build" src="https://img.shields.io/github/workflow/status/teable-group/teable/CI-web-app/main?label=CI&logo=github&style=flat-quare&labelColor=000000" />
  </a>
</p>

# About

Example of composable eslint config bases that can be easily shared and fine-tuned by apps and
packages that lives in a [monorepo](https://github.com/teableio/teable).

## Features

## Features

- **Monorepo friendly:** Each workspace can have its own config.
- **Composable:** Compose your workspace eslint config from pre-defined bases.
- **Peace of mind:** Plugins does not need to be installed per workspaces, thx to [@rushstack/eslint-patch](https://www.npmjs.com/package/@rushstack/eslint-patch).
- **Extensible:** Easily add additional plugins per workspaces (ie: nextjs, remix...)
- **Performance:** Plugins enabled on file conventions patterns to increase perf.

## Install

Add the following devDependencies to workspace (apps/packages in monorepo) or main project package.json.

```bash
$ yarn add --dev eslint
$ yarn add --dev @teable/eslint-config-bases:"workspace:^"
```

> **Tip** the [workspace:^](https://yarnpkg.com/features/workspaces#workspace-ranges-workspace) is supported by yarn and pnpm.

## Usage

In your app or package, create an `./apps/my-app/.eslintrc.js` file that extends any of the
existing base configs. For example:

```javascript
// Workaround for https://github.com/eslint/eslint/issues/3458 (re-export of @rushstack/eslint-patch)
require("@teable/eslint-config-bases/patch/modern-module-resolution");

module.exports = {
  // Be sure to set root to true in monorepo.
  root: true,
  // Will help typescript extended rules.
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: "tsconfig.json",
  },
  ignorePatterns: ["**/node_modules", "**/.cache", "build", ".next"],
  extends: [
    "@teable/eslint-config-bases/typescript",
    "@teable/eslint-config-bases/sonar",
    "@teable/eslint-config-bases/regexp",
    "@teable/eslint-config-bases/react",
    "@teable/eslint-config-bases/jest",
    "@teable/eslint-config-bases/rtl",
    "@teable/eslint-config-bases/storybook",
    "@teable/eslint-config-bases/playwright",

    // Add specific rules for your framework if needed.
    // ie:
    // - nextjs: 'plugin:@next/next/core-web-vitals',
    // - remix:  '@remix-run/eslint-config',
    // ...

    // Post configure the prettier base so there won't be
    // any conficts between eslint / prettier
    "@teable/eslint-config-bases/prettier-plugin",
  ],
  rules: {
    // Specific global rules for your app or package
  },
  overrides: [
    // Specific file rules for your app or package
  ],
};
```

> **Tip:** "@teable/eslint-config-bases/prettier-plugin" must be set at the end to disable any
> conflicting rules.

## Bases

You can find the bases in [./src/bases](./src/bases).

| Base                                    | Match convention                  | Scope                                                           |
| :-------------------------------------- | :-------------------------------- | :-------------------------------------------------------------- |
| [typescript](./src/bases/typescript.js) | _all_                             | Naming conventions, consistent imports, import sorting...       |
| [sonar](./src/bases/sonar.js)           | `*.{js,jsx,ts,tsx}`               | Keep levels of code complexity sane. (excl test and stories)    |
| [regexp](./src/bases/regexp.js)         | `*.{js,jsx,jsx,tsx}`              | Keep regexp consistent and safer.                               |
| [react](./src/bases/react.js)           | `*.{jsx,tsx}`                     | Recommendations for react, react-hooks and jsx projects.        |
| [jest](./src/bases/jest.js)             | `**/?(*.)+(test).{js,jsx,ts,tsx}` | Catch inconsistencies or error in jest tests.                   |
| [rtl](./src/bases/rtl.js)               | `**/?(*.)+(test).{js,jsx,ts,tsx}` | Potential errors / deprecations in react-testing-library tests. |
| [storybook](./src/bases/storybook.js)   | `*.stories.{ts,tsx,mdx}`          | Potential errors / deprecations in stories.                     |
| [playwright](./src/bases/playwright.js) | `**/e2e/**/*.test.{js,ts}`        | Post configure eslint for prettier compatibility.               |
| [prettier](./src/bases/prettier.js)     | _all_                             | Post configure eslint for prettier compatibility.               |

> **Notes**:
>
> - The order is important. Some bases will disable or tune previously defined
>   rules. For example the [react base](./src/bases/react.js) will tune the naming conventions
>   for function components and increase recommended cognitive complexity. The [typescript base](./src/bases/typescript.js)
>   will also relax conventions for javascript files.
> - Based on filename conventions some rules are relaxed or disabled to avoid false positives and
>   keep a good level of performance. For example the [sonar base](./src/bases/sonar.js) won't run on
>   test and storybook files. If you work on different conventions the patterns must be updated.

## Prettier integration

To prevent conflicts between prettier and eslint, you must re-export the prettier base from `@teable/eslint-config-bases`.

```javascript
const { getPrettierConfig } = require("@teable/eslint-config-bases/helpers");
module.exports = {
  ...prettierConfig,
  overrides: [
    // whatever you need
  ],
};
```

> **Tip**: You can tune the provided [prettier.base.config](./src/prettier.base.config.js) for your own needs.

## Notes

### Typescript

Generic typescript project, mostly based on

| Type/Plugin                                                                                      | Comment                                                                      |
| :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| [eslint:recommended](https://eslint.org/docs/rules/)                                             | The basics for code linting.                                                 |
| [@typescript-eslint/recommended](https://typescript-eslint.io/rules/)                            | The basics for typescript.                                                   |
| [@typescript-eslint/consistent-type](https://typescript-eslint.io/rules/consistent-type-imports) | Use TS 3.8+ imports/exports, helps with [esbuild](https://esbuild.github.io) |
| [@typescript-eslint/naming-convention](https://typescript-eslint.io/rules/naming-convention)     |                                                                              |
| [eslint-plugin-import](https://github.com/import-js/eslint-plugin-import)                        | Order imports                                                                |

## Sonarjs

| Type/Plugin                                                                               | Comment                      |
| :---------------------------------------------------------------------------------------- | :--------------------------- |
| [eslint-plugin-sonarjs/recommended](https://github.com/SonarSource/eslint-plugin-sonarjs) | Help to keep complexity sane |

### React

| Type/Plugin                                                                                                             | Comment                                  |
| :---------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- |
| [eslint-plugin-react/recommended](https://github.com/yannickcr/eslint-plugin-react)                                     |                                          |
| [eslint-plugin-react-hooks/recommended](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks) |                                          |
| [eslint-plugin-jsx-a11y/recommended](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y)                              | Helps to produce accessibility-ready jsx |

### Jest

| Type/Plugin                                                                            | Comment                     |
| :------------------------------------------------------------------------------------- | :-------------------------- |
| [eslint-plugin-jest/recommended](https://github.com/jest-community/eslint-plugin-jest) | Jest recommended practices. |

### React Testing Library

| Type/Plugin                                                                                                   | Comment                               |
| :------------------------------------------------------------------------------------------------------------ | :------------------------------------ |
| [eslint-plugin-testing-library/recommended](https://github.com/testing-library/eslint-plugin-testing-library) | Ease when using react-testing-library |

### Regexp

| Type/Plugin                                                                           | Comment |
| :------------------------------------------------------------------------------------ | :------ |
| [eslint-plugin-regexp/recommended](https://github.com/ota-meshi/eslint-plugin-regexp) |         |

### Etc

...

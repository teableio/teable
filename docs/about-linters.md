# About linters

Linters in a monorepo should offer consistency but also offer flexibility in each app and package (a.k.a. workspace).

## Recommended approach

Define a package holding all your base configurations and enable them per workspace.

### Example config

If you use the provided example of `packages/eslint-config-bases`, it's easy to add or
customize rules on per workspace basis by creating an `.eslintrc.js` file in the workspace root.

```javascript
module.exports = {
  root: true, // Be sure to set root to true in monorepo.
  ignorePatterns: ["**/node_modules", "**/.cache", "build", ".next"],
  extends: [
    "@teable-group/eslint-config-bases/typescript",
    "@teable-group/eslint-config-bases/sonar",
    "@teable-group/eslint-config-bases/regexp",
    "@teable-group/eslint-config-bases/jest",
    "@teable-group/eslint-config-bases/react",
    "@teable-group/eslint-config-bases/rtl",
    "@teable-group/eslint-config-bases/graphql-schema",
    "@teable-group/eslint-config-bases/storybook",

    // Add specific rules for your framework if needed.
    // ie:
    // - nextjs: 'plugin:@next/next/core-web-vitals',
    // - remix:  '@remix-run/eslint-config',
    // ...

    // Post configure the prettier base so there won't be
    // any conficts between eslint / prettier
    "@teable-group/eslint-config-bases/prettier",
  ],
  rules: {
    // Specific global rules for your app or package
  },
  overrides: [
    // Specific file rules for your app or package
  ],
};
```

### Workspace structure

```
.
├── apps
│   └── nextjs-app
│       └── .eslintrc.js
└── packages
    └── eslint-config-bases
```

## Commands

If you are in a specific package, you can run the linter from the package directory.

| Name              | Description            |
| ----------------- | ---------------------- |
| `yarn lint`       | Display linter issues. |
| `yarn lint --fix` | Run automatic fixes.   |

It's possible to run the linter globally from any folder of the monorepo.

| Name                | Description                                    |
| ------------------- | ---------------------------------------------- |
| `yarn g:lint`       | Display linter issues in all apps and packages |
| `yarn g:lint --fix` | Run automatic fixes                            |

## Lint-staged

See the [specific doc](./about-lint-staged.md).

## Performance

By default, all lint command will automatically enable cache.

On Github CI, the cache will be persisted thx to `action/cache`.

<details>
  <summary>action/cache example</summary>

```yaml
- name: Restore packages cache
  uses: actions/cache@v2
  with:
    path: |
      ${{ github.workspace }}/.cache
      ${{ github.workspace }}/**/tsconfig.tsbuildinfo
      ${{ github.workspace }}/**/.eslintcache

    key: ${{ runner.os }}-packages-cache-${{ hashFiles('**/yarn.lock') }}-${{ hashFiles('packages/**.[jt]sx?', 'packages/**.json') }}
    restore-keys: |
      ${{ runner.os }}-packages-cache-${{ hashFiles('**/yarn.lock') }}-
```

</details>

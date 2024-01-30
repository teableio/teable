<div align="center">
  <h2 align="center">Developers Guide</h1>

  <p align="center"><strong>Monorepo concepts, tips and tricks oriented around NextJs</strong></p>
</div>

> Howtos for monorepo. New to monorepos ? [check this FAQ](./README.md#monorepo). This example is managed by [Yarn 3.2+](https://dev.to/arcanis/yarn-32-libc-yarn-explain-next-major--o22)
> / [typescript path aliases](https://www.typescriptlang.org/tsconfig#paths). Not the only way to do.

Useful to

- Establish a **structure** and present a lifecycle perspective (dx, ci/cd, deployments...)
- How to create and consume **shared packages**, locales, assets, api types...
- Integrate **tools & configs** (eslint, jest, playwright, storybook, changelogs, versioning, codecov, codeclimate...).
- Clarify some **advantages** of monorepos (team cohesion, consistency, duplication, refactorings, atomic commits...).
- Create nextjs/vercel/prisma... bug reports with **reproducible examples** _(initial goal of this repo)_.

#### Apps

- [apps/nextjs-app](./apps/nextjs-app): React, SSR, i18n, tailwind v3... [README](./apps/nextjs-app/README.md) | [DEMO/Vercel](https://monorepo-nextjs-app.vercel.app) | [CHANGELOG](./apps/nextjs-app/CHANGELOG.md)
- [apps/nestjs-backend](./apps/nestjs-backend): nestjs, api, prisma, jest... [README](./apps/nestjs-backend/README.md) | [CHANGELOG](./apps/nestjs-backend/CHANGELOG.md)

> Apps should not depend on apps, they can depend on packages

#### packages

- [packages/sdk](./packages/sdk): publishable. [README](./packages/sdk/README.md) | [CHANGELOG](./packages/sdk/CHANGELOG.md)
- [packages/core](./packages/core): share code between frontend and backend. [README](./packages/core/README.md) | [CHANGELOG](./packages/core/CHANGELOG.md)
- [packages/db-main-prisma](./packages/db-main-prisma): used by bac-app. [README](./packages/db-main-prisma/README.md) | [CHANGELOG](./packages/db-main-prisma/CHANGELOG.md)
- [packages/eslint-config-bases](./packages/eslint-config-bases): [README](./packages/eslint-config-bases/README.md) | [CHANGELOG](./packages/eslint-config-bases/CHANGELOG.md)
- [packages/ui-lib](./packages/ui-lib): publishable. [README](./packages/ui-lib/README.md) | [CHANGELOG](./packages/ui-lib/CHANGELOG.md)
- [packages/common-i18n](./packages/common-i18n): [README](./packages/common-i18n/README.md) | [CHANGELOG](./packages/common-i18n/CHANGELOG.md)

> Apps can depend on packages, packages can depend on each others...

#### Shared static assets

If needed static resources like **images**,... can be shared by using symlinks in the repo.

- See the global [static](./static) folder.

#### Folder overview

<details>
<summary>Detailed folder structure</summary>

```
.
├── apps
│   └── nextjs-app                (NextJS app with nestjs backend)
│       ├── e2e/                  (E2E tests with playwright)
│       ├── public/
│       │   └── images/
│       ├── src/
│       │   └── backend           (nestjs backend)
│       │       └── tsconfig.json (nestjs tsconfig)
│       ├── CHANGELOG.md
│       ├── next.config.mjs
│       ├── package.json          (define package workspace:package deps)
│       ├── tsconfig.json         (define path to packages)
│       └── vitest.config.ts
│
├── packages
│   ├── sdk                     (basic ts libs)
│   │   ├── src/
│   │   ├── CHANGELOG.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── db-main-prisma          (basic db layer with prisma)
│   │   ├── e2e/                (E2E tests)
│   │   ├── prisma/
│   │   ├── src/
│   │   ├── CHANGELOG.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── eslint-config-bases
│   │   ├── src/
│   │   ├── CHANGELOG.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ui-lib                  (basic design-system in react)
│       ├── src/
│       ├── CHANGELOG.md
│       ├── package.json
│       └── tsconfig.json
│
├── static                       (no code: images, json, locales,...)
│   ├── assets
│   └── locales
├── Makefile
├── package.json                 (the workspace config)
└── tsconfig.base.json           (base typescript config)
```

</details>

## Howto

### 1. Enable workspace support

<details>
<summary>Root package.json with workspace directories</summary>

```json5
{
  "name": "@teable/teable",
  // Set the directories where your apps, packages will be placed
  "workspaces": ["apps/*", "packages/*"],
  //...
}
```

_The package manager will scan those directories and look for children `package.json`. Their
content is used to define the workspace topology (apps, libs, dependencies...)._

</details>

### 2. Create a new package

Create a folder in [./packages/](./packages) directory with the name of
your package.

<details>
   <summary>Create the package folder</summary>

```bash
mkdir packages/magnificent-poney
mkdir packages/magnificent-poney/src
cd packages/magnificent-poney
```

</details>

Initialize a package.json with the name of your package.

> Rather than typing `yarn init`, prefer to take the [./packages/ui-lib/package.json](./packages/ui-lib/package.json)
> as a working example and edit its values.

<details>
<summary>Example of package.json</summary>

```json5
{
  "name": "@teable/magnificent-poney",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "clean": "rimraf ./tsconfig.tsbuildinfo",
    "lint": "eslint . --ext .ts,.tsx,.js,.jsx",
    "typecheck": "tsc --project ./tsconfig.json --noEmit",
    "test": "run-s 'test:*'",
    "test:unit": "echo \"No tests yet\"",
    "fix:staged-files": "lint-staged --allow-empty",
    "fix:all-files": "eslint . --ext .ts,.tsx,.js,.jsx --fix",
  },
  "devDependencies": {
    "@teable/eslint-config-bases": "workspace:^",
  },
}
```

</details>

### 3. Using the package in app

#### Step 3.1: package.json

First add the package to the app package.json. The recommended way is to
use the [workspace protocol](https://yarnpkg.com/features/protocols#workspace) supported by
yarn and pnpm.

```bash
cd apps/my-app
yarn add @teable/magnificent-poney@'workspace:^'
```

Inspiration can be found in [apps/nextjs-app/package.json](./apps/nextjs-app/package.json).

<details>
<summary>package.json</summary>

```json5
{
  "name": "my-app",
  "dependencies": {
    "@teable/magnificient-poney": "workspace:^",
  },
}
```

</details>

#### Step 3.2: In tsconfig.json

Then add a typescript path alias in the app tsconfig.json. This
will allow you to import it directly (no build needed)

Inspiration can be found in [apps/nextjs-app/tsconfig.json](./apps/nextjs-app/tsconfig.json).

<details>
  <summary>Example of tsonfig.json</summary>

```json5
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      // regular app aliases
      "@/components/*": ["./components/*"],
      // packages aliases, relative to app_directory/baseUrl
      "@teable/magnificent-poney/*": ["../../../packages/magnificent-poney/src/*"],
      "@teable/magnificent-poney": ["../../../packages/magnificent-poney/src/index"],
    },
  },
}
```

> PS:
>
> - Don't try to set aliases in the global tsonfig.base.json to keep strict with
>   graph dependencies.
> - The **star** in `@teable/magnificent-poney/*` allows you to import subfolders. If you use
>   a barrel file (index.ts), the alias with star can be removed.

</details>

#### Step 3.3: Next config

Edit your `next.config.mjs` and enable the [experimental.externalDir option](https://github.com/vercel/next.js/pull/22867).
Feedbacks [here](https://github.com/vercel/next.js/discussions/26420).

```js
const nextConfig = {
  experimental: {
    externalDir: true,
  },
};
```

<details>
  <summary>Using a NextJs version prior to 10.2.0 ?</summary>

If you're using an older NextJs version and don't have the experimental flag, you can simply override your
webpack config.

```js
const nextConfig = {
  webpack: (config, { defaultLoaders }) => {
    // Will allow transpilation of shared packages through tsonfig paths
    // @link https://github.com/vercel/next.js/pull/13542
    const resolvedBaseUrl = path.resolve(config.context, "../../");
    config.module.rules = [
      ...config.module.rules,
      {
        test: /\.(tsx|ts|js|jsx|json)$/,
        include: [resolvedBaseUrl],
        use: defaultLoaders.babel,
        exclude: (excludePath) => {
          return /node_modules/.test(excludePath);
        },
      },
    ];
    return config;
  },
};
```

</details>

> PS: If your shared package make use of scss bundler... A custom webpack configuration will be necessary
> or use [next-transpile-modules](https://github.com/martpie/next-transpile-modules), see FAQ below.

#### Step 3.4: Using the package

The packages are now linked to your app, just import them like regular packages: `import { poney } from '@teable/magnificent-poney'`.

### 4. Publishing

> Optional

If you need to share some packages outside of the monorepo, you can publish them to npm or private repositories.
An example based on microbundle is present in each package. Versioning and publishing can be done with [atlassian/changeset](https://github.com/atlassian/changesets),
and it's simple as typing:

```bash
$ pnpm g:changeset
```

Follow the instructions... and commit the changeset file. A "Version Packages" P/R will appear after CI checks.
When merging it, a [github action](./.github/workflows/release-or-version-pr.yml) will publish the packages
with resulting semver version and generate CHANGELOGS for you.

> PS:
>
> - Even if you don't need to publish, changeset can maintain an automated changelog for your apps. Nice !
> - To disable automatic publishing of some packages, just set `"private": "true"` in their package.json.
> - Want to tune the behaviour, see [.changeset/config.json](./.changeset/config.json).

## 4. Monorepo essentials

### Monorepo scripts

Some convenience scripts can be run in any folder of this repo and will call their counterparts defined in packages and apps.

| Name                         | Description                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm g:changeset`           | Add a changeset to declare a new version                                                                                             |
| `pnpm g:typecheck`           | Run typechecks in all workspaces                                                                                                     |
| `pnpm g:lint`                | Display linter issues in all workspaces                                                                                              |
| `pnpm g:lint --fix`          | Attempt to run linter auto-fix in all workspaces                                                                                     |
| `pnpm g:lint-styles`         | Display css stylelint issues in all workspaces                                                                                       |
| `pnpm g:lint-styles --fix`   | Attempt to run stylelint auto-fix issues in all workspaces                                                                           |
| `pnpm g:test`                | Run unit and e2e tests in all workspaces                                                                                             |
| `pnpm g:test-unit`           | Run unit tests in all workspaces                                                                                                     |
| `pnpm g:test-e2e`            | Run e2e tests in all workspaces                                                                                                      |
| `pnpm g:build`               | Run build in all workspaces                                                                                                          |
| `pnpm g:clean`               | Clean builds in all workspaces                                                                                                       |
| `pnpm g:check-dist`          | Ensure build dist files passes es2017 (run `g:build` first).                                                                         |
| `pnpm g:check-size`          | Ensure browser dist files are within size limit (run `g:build` first).                                                               |
| `pnpm clean:global-cache`    | Clean tooling caches (eslint, jest...)                                                                                               |
| `pnpm deps:check --dep dev`  | Will print what packages can be upgraded globally (see also [.ncurc.yml](https://github.com/sortlist/packages/blob/main/.ncurc.yml)) |
| `pnpm deps:update --dep dev` | Apply possible updates (run `pnpm install && pnpm dedupe` after)                                                                     |
| `pnpm install:playwright`    | Install playwright for e2e                                                                                                           |
| `pnpm dedupe`                | Built-in pnpm deduplication of the lock file                                                                                         |

### Maintaining deps updated

The global commands `pnpm deps:check` and `pnpm deps:update` will help to maintain the same versions across the entire monorepo.
They are based on the excellent [npm-check-updates](https://github.com/raineorshine/npm-check-updates)
(see [options](https://github.com/raineorshine/npm-check-updates#options), i.e: `pnpm check:deps -t minor`).

> After running `pnpm deps:update`, a `pnpm install` is required. To prevent
> having duplicates in the pnpm-lock.yaml, you can run `pnpm dedupe --check` and `pnpm dedupe` to
> apply deduplication. The duplicate check is enforced in the example github actions.

## 5. Quality

### 5.1 Linters

See an example in [./apps/nextjs-app/.eslintrc.js](./apps/nextjs-app/.eslintrc.js) and our
[eslint-config-bases](./packages/eslint-config-bases/README.md).

### 5.2 Hooks / Lint-staged

Check the [.husky](./.husky) folder content to see what hooks are enabled. Lint-staged is used to guarantee
that lint and prettier are applied automatically on commit and/or pushes.

### 5.3 Tests

Tests relies on ts-jest or vitest depending on the app. All setups supports typescript path aliases.
React-testing-library is enabled whenever react is involved.

Configuration lives in the root folder of each apps/packages. As an
example see

- [./apps/nextjs-app/vitest.config.ts](./apps/nextjs-app/vitest.config.ts).

### 5.4 CI

You'll find some example workflows for github action in [.github/workflows](./.github/workflows).
By default, they will ensure that

- You don't have package duplicates.
- You don't have typecheck errors.
- You don't have linter / code-style errors.
- Your test suite is successful.
- Your apps (nextjs) or packages can be successfully built.
- Basic check-size example in nextjs-app.

Each of those steps can be opted-out.

To ensure decent performance, those features are present in the example actions:

- **Caching** of packages (node_modules...) - install around 25s
- **Caching** of nextjs previous build - built around 20s
- **Triggered when changed** using [actions paths](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#onpushpull_requestpaths), ie:

  > ```
  >  paths:
  >    - "apps/nextjs-app/**"
  >    - "packages/**"
  >    - "package.json"
  >    - "tsconfig.base.json"
  >    - "yarn.lock"
  >    - ".yarnrc.yml"
  >    - ".github/workflows/**"
  >    - ".eslintrc.base.json"
  >    - ".eslintignore"
  > ```

## 6. Editor support

### 6.1 VSCode

The ESLint plugin requires that the `eslint.workingDirectories` setting is set:

```
"eslint.workingDirectories": [
    {
        "pattern": "./apps/*/"
    },
    {
        "pattern": "./packages/*/"
    }
],
```

More info [here](https://github.com/microsoft/vscode-eslint#mono-repository-setup)

## 7. Deploy

### Vercel

Vercel support natively monorepos, see the [vercel-monorepo-deploy](./docs/deploy/deploy-vercel.md) document.

### Docker

There's a basic example for building a docker image, read the [docker doc](./docs/docker/docker.md).

### Others

Netlify, aws-amplify, k8s-docker, serverless-nextjs recipes might be added in the future. PR's welcome too.

## FAQ

### Monorepo

#### Benefits

- [x] **Ease of code reuse.** You can easily extract shared libraries (like api, shared ui, locales, images...) and use them across apps without
      the need of handling them in separate git repos (removing the need to publish, version, test separately...). This limit the tendency to create code duplication
      amongst developers when time is short.
- [x] **Atomic commits.** When projects that work together are contained in separate repositories, releases need to sync which versions of one project work
      with the other. In monorepo CI, sandboxes and releases are much easier to reason about (ie: [dependency hell](https://en.wikipedia.org/wiki/Dependency_hell)...).
      A pull-request contains all changes at once, no need to coordinate multiple packages versions to test it integrally (multiple published canary versions...).
- [x] **Code refactoring.** Changes made on a library will immediately propagate to all consuming apps / packages.
      Typescript / typechecks, tests, ci, sandboxes... will improve the confidence to make a change _(or the right one thanks to improved discoverability of
      possible side effects)_. It also limits the tendency to create tech debt as it invites the dev to refactor all the code that depends on a change.
- [x] **Collaboration across teams**. Consistency, linters, discoverability, duplication... helps to maintain
      cohesion and collaboration across teams.

#### Drawbacks

- [x] **Increased build time**. Generally a concern but not relevant in this context thanks to the combination of
      nextjs/webpack5, typescript path aliases and yarn. Deps does
      not need to be build... modified files are included as needed and properly cached (nextjs webpack5, ci, deploy, docker/buildkit...).
- [x] **Versioning and publishing**. Sometimes a concern when you want to use the shared libraries outside of the monorepo.
      See the notes about [atlassian changeset](https://github.com/atlassian/changesets). Not relevant here.
- [x] **Git repo size**. All packages and apps and history will fit in the same git repository increasing its size and
      checkout time. Generally when you reach size problems, check for assets like images first and extract
      packages that don't churn anymore.
- [x] **Multi-languages**. Setting up a monorepo containing code in multiple languages (php, ruby, java, node) is extremely
      difficult to handle due to nonexistence of mature tooling (bazel...).The general idea is
      to create a monorepo with the same stack (node, typescript...) and managed by the same
      package manager (yarn, pnpm,...)

#### Exact vs semver dependencies

Apps dependencies and devDependencies are pinned to exact versions. Packages deps will use semver compatible ones.
For more info about this change see [reasoning here](https://docs.renovatebot.com/dependency-pinning/) and our
[renovabot.json5](renovate.json5) configuration file.

To help keeping deps up-to-date, see the `pnpm deps:check && pnpm deps:update` scripts and / or use the [renovatebot](https://github.com/marketplace/renovate).

> When adding a dep through yarn cli (i.e.: yarn add something), it's possible to set the save-exact behaviour automatically
> by setting `defaultSemverRangePrefix: ""` in [yarnrc.yml](./.yarnrc.yml). But this would make the default for packages/\* as well.
> Better to handle `yarn add something --exact` on per-case basis.

## License

AGPL-3.0

# The web-app

<p align="left">
  <a aria-label="Build" href="https://github.com/teableio/teable/actions?query=workflow%3ACI">
    <img alt="build" src="https://img.shields.io/github/workflow/status/teable-group/teable/CI-web-app/main?label=CI&logo=github&style=flat-quare&labelColor=000000" />
  </a>
</p>

## Intro

Basic demo nextjs nextjs-app, part of the [teable](https://github.com/teableio/teable).

- Home: [Demo/Vercel](https://monorepo-nextjs-app.vercel.app)
- SSR-I18n: [Demo/Vercel english](https://monorepo-nextjs-app.vercel.app/en/home) | [Demo/vercel french](https://monorepo-nextjs-app.vercel.app/fr/home)
- API: [Demo rest/Vercel](https://monorepo-nextjs-app.vercel.app/api/rest/post/1)
- [Changelog](https://github.com/teableio/teable/blob/main/apps/nextjs-app/CHANGELOG.md)

## Quick start

> For rest/api database access be sure to start `docker-compose up main-db`,
> see detailed instructions (seeding, docker, supabase...) in the [@teable-group/db-main-prisma README](https://github.com/teableio/teable/blob/main/packages/db-main-prisma/README.md).

```bash
$ yarn install
$ cd apps/nextjs-app
$ yarn dev
```

### Features

> Some common features that have been enabled to widen monorepo testing scenarios.

- [x] Api routes: some api routes for rest.
- [x] I18n: based on [next-i18next](https://github.com/isaachinman/next-i18next)
<!-- - [x] Styling: [Emotion v11](https://emotion.sh/) support with critical path extraction enabled. -->
- [x] Styling: [Tailwind v3](https://tailwindcss.com/) with JIT mode enabled and common plugins.
- [x] Security: [next-secure-headers](https://github.com/jagaapple/next-secure-headers) with basic defaults.
- [x] Seo: [next-seo](https://github.com/garmeeh/next-seo)
- [x] Tests: [jest](https://jestjs.io/) + [ts-jest](https://github.com/kulshekhar/ts-jest) + [@testing-library/react](https://testing-library.com/)
- [x] E2E: [Playwright](https://playwright.dev/)

### Monorepo deps

This app relies on packages in the monorepo, see detailed instructions in [README.md](https://github.com/teableio/teable)

```json5
{
  dependencies: {
    "@teable-group/sdk": "workspace:*",
    "@teable-group/db-main-prisma": "workspace:*",
    "@teable-group/ui-lib": "workspace:*",
  },
}
```

And their counterparts in [tsconfig.json](./tsconfig.json)

```json5
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@teable-group/ui-lib/*": ["../../../packages/ui-lib/src/*"],
      "@teable-group/ui-lib": ["../../../packages/ui-lib/src/index"],
      "@teable-group/sdk/*": ["../../../packages/sdk/src/*"],
      "@teable-group/sdk": ["../../../packages/sdk/src/index"],
      "@teable-group/db-main-prisma/*": ["../../../packages/db-main-prisma/src/*"],
      "@teable-group/db-main-prisma": ["../../../packages/db-main-prisma/src/index"],
    },
  },
}
```

## API routes

### Rest api

Try this route http://localhost:3000/api/rest/poem

### Graphql (sdl)

In development just open http://localhost:3000/api/graphql-sdl to have the graphiql console.

Try

```gql
query {
  allPoems {
    id
    title
  }
}
```

## Some tips

### I18N & typings

Translations are handled by [next-i18next](https://github.com/isaachinman/next-i18next).
See the [next-i18next.config.js](./next-i18next.config.js).
The keys autocompletion and typechecks are enabled in [./src/typings/react-i18next.d.ts](./src/typings/react-i18next.d.ts).

## Structure

```
.
├── apps
│   └── nextjs-app
│       ├── public/
│       │   └── locales/
│       ├── src/
│       │   ├── backend/*     (backend code)
│       │   ├── components/*
│       │   ├── features/*    (regrouped by context)
│       │   └── pages/api     (api routes)
│       ├── .env
│       ├── .env.development
│       ├── (.env.local)*
│       ├── next.config.mjs
│       ├── next-i18next.config.js
│       ├── tsconfig.json    (local paths enabled)
│       └── tailwind.config.js
└── packages  (monorepo's packages that this app is using)
    ├── sdk
    ├── main-db-prisma
    └── ui-lib
```

### Develop

```
$ yarn dev
```

<div align="center">
  <h1 align="center"><a aria-label="NextJs Monorepo" href="https://github.com/teable-group/teable">Teable</a></h1>
  <p align="center"><strong>Teable an AI native visualization database that empowers everyone</strong></p>
  <p>We believe that databases will become the infrastructure of generative AI in the same way as computing power. By utilizing database capabilities, every enterprise, organization, and even individual can train their own private AI assistant to gain a competitive edge.</p>
</div>
<p align="center">
  <a aria-label="Build" href="https://github.com/teable-group/teable/actions?query=workflow%3ACI">
    <img alt="build" src="https://img.shields.io/github/workflow/status/teable-group/teable/CI-nextjs-app/main?label=CI&logo=github&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="Codefactor grade" href=https://www.codefactor.io/repository/github/teable-group/teable">
    <img alt="Codefactor" src="https://img.shields.io/codefactor/grade/github/teable-group/teable?label=Codefactor&logo=codefactor&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="CodeClimate maintainability" href="https://codeclimate.com/github/teable-group/teable">
    <img alt="Maintainability" src="https://img.shields.io/codeclimate/maintainability/teable-group/teable?label=Maintainability&logo=code-climate&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="CodeClimate technical debt" href="https://codeclimate.com/github/teable-group/teable">
    <img alt="Techdebt" src="https://img.shields.io/codeclimate/tech-debt/teable-group/teable?label=TechDebt&logo=code-climate&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="Codacy grade" href="https://www.codacy.com/gh/teable-group/teable/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=teable-group/teable&amp;utm_campaign=Badge_Grade">
    <img alt="Codacy grade" src="https://img.shields.io/codacy/grade/dff9c944af284a0fad4e165eb1727467?logo=codacy&style=flat-square&labelColor=000&label=Codacy">
  </a>
  <a aria-label="LoC">  
    <img alt="LoC" src="https://img.shields.io/tokei/lines/github/teable-group/teable?style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="Top language" href="https://github.com/teable-group/teable/search?l=typescript">
    <img alt="GitHub top language" src="https://img.shields.io/github/languages/top/teable-group/teable?style=flat-square&labelColor=000&color=blue">
  </a>
  <a aria-label="Licence" href="https://github.com/teable-group/teable/blob/main/LICENSE">
    <img alt="Licence" src="https://img.shields.io/github/license/teable-group/teable?style=flat-quare&labelColor=000000" />
  </a>
</p>

## Structure

[![Open in Gitpod](https://img.shields.io/badge/Open%20In-Gitpod.io-%231966D2?style=for-the-badge&logo=gitpod)](https://gitpod.io/#https://github.com/teable-group/teable)

```
.
├── apps
│   ├── nextjs-app          (front-end, include web and electron app )
│   └── nestjs-backend      (backend, running on server or electron app)
└── packages
    ├── common-i18n         (locales...)
    ├── core                (share code and interface between app and backend)
    ├── sdk                 (sdk for extensions)
    ├── db-main-prisma      (schema, migrations, prisma client)
    ├── eslint-config-bases (to shared eslint configs)
    └── ui-lib              (storybook)
```

## Run Project

### 1. Install (we use build in yarn version for package management)

```sh
yarn install
```

### 2. migration

```sh
cd packages/db-main-prisma
yarn prisma-db-push
yarn prisma-db-seed
yarn prisma-migrate dev
```

### 3. dev server

you should only start backend, it will start next server for front-end automatically

```sh
cd apps/nestjs-backend
yarn dev
```

## Developers

goto [developer readme](./DEVELOPER.md)

## Sponsors :heart:

If you are enjoying some this guide in your company, I'd really appreciate a [sponsorship](https://github.com/sponsors/teable-group), a [coffee](https://ko-fi.com/teable-group) or a dropped star.
That gives me some more time to improve it to the next level.

## License

AGPL-3.0

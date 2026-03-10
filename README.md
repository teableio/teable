<div align="center">
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="static/assets/images/teable-vertical-dark.png">
      <img alt="teable logo" height="150" src="static/assets/images/teable-vertical-light.png">
    </picture>
  </h1>
  <h3 align="center"><strong>Manage Your Data & Connect Your Team</strong></h3>
  <p>Teable uses a simple, spreadsheet-like interface to create powerful database applications. Collaborate with your team in real-time, and scale to millions of rows
  <p>Try out Teable using our hosted version at <a href="https://teable.ai">teable.ai</a></p>
</div>

<div align="center">
<a href="https://trendshift.io/repositories/8516" target="_blank"><img src="https://trendshift.io/api/badge/repositories/8516" alt="teableio%2Fteable | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</div>

<p align="center">
  <a target="_blank" href="https://teable.ai">Home</a> | <a target="_blank" href="https://help.teable.ai">Help</a> | <a target="_blank" href="https://teable.ai/blog">Blog</a> | <a target="_blank" href="https://teable.ai/templates">Template</a> | <a target="_blank" href="https://help.teable.ai/en/api-doc/token">API</a> | <a target="_blank" href="https://discord.gg/uZwp7tDE5W">Discord</a> | <a target="_blank" href="https://twitter.com/teableio">Twitter</a>
</p>

<p align="center">
  <a aria-label="Build" href="https://github.com/teableio/teable/actions?query=Build%20and%20Push%20to%20Docker%20Registry">
    <img alt="build" src="https://img.shields.io/github/actions/workflow/status/teableio/teable/docker-push.yml?label=Build&logo=github&style=flat-quare&labelColor=000000" />
  </a>
  <a aria-label="Coverage Status" href="https://coveralls.io/github/teableio/teable?branch=develop">
    <img alt="Coverage" src="https://coveralls.io/repos/github/teableio/teable/badge.svg?branch=develop" />
  </a>
  <a aria-label="Codacy grade" href="https://www.codacy.com/gh/teableio/teable/dashboard?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=teableio/teable&amp;utm_campaign=Badge_Grade">
    <img alt="Codacy grade" src="https://img.shields.io/codacy/grade/dff9c944af284a0fad4e165eb1727467?logo=codacy&style=flat-square&labelColor=000&label=Codacy">
  </a>
  <a aria-label="Top language" href="https://github.com/teableio/teable/search?l=typescript">
    <img alt="GitHub top language" src="https://img.shields.io/github/languages/top/teableio/teable?style=flat-square&labelColor=000&color=blue">
  </a>
  <a aria-label="Gurubase" href="https://gurubase.io/g/teable">
    <img alt="Gurubase" src="https://img.shields.io/badge/Gurubase-Ask%20Teable%20Guru-006BFF" />
  </a>
</p>
  <h1 align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="static/assets/images/teable-interface-dark.png">
      <img alt="teable interface" width="100%" src="static/assets/images/teable-interface-light.png">
    </picture>
  </h1>

## Quick Guide

1. Looking for a quick experience? Select a scenario from the [template center](https://app.teable.ai/public/template) and click "Use this template".
2. Seeking high performance? Try the [1 million rows demo](https://app.teable.ai/share/shrVgdLiOvNQABtW0yX/view) to feel the speed of Teable.
3. Interested in deploying it yourself? Click [Deploy on Railway](https://railway.app/template/wada5e?referralCode=rE4BjB)

## ✨Features

### 🍺 Feature Packed

Everything you need, right out of the box:

- [x] Aggregation
- [x] Attachments Preview
- [x] Batch Editing
- [x] Charts
- [x] Comments
- [x] Custom Columns
- [x] Field Conversion
- [x] Filtering
- [x] Formatting
- [x] Formula Support
- [x] Grouping
- [x] History
- [x] Import/Export
- [x] Millions of Rows
- [x] Plugins
- [x] Real-time
- [x] Search
- [x] Sorting
- [x] SQL Query
- [x] Undo/Redo
- [x] Validation

### 🏞️ Multiple Views

Visualize and interact with data in various ways best suited for their specific tasks.

- [x] Grid View
- [x] Form View
- [x] Kanban View
- [x] Gallery View
- [x] Calendar View

<table align="center" style="width: 100%;">
  <tr>
    <td width="50%"><img alt="Grid View" src="static/assets/images/view-grid.png"></td>
    <td width="50%"><img alt="Search" src="static/assets/images/search.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Calendar View" src="static/assets/images/view-calendar.png"></td>
    <td width="50%"><img alt="Gallery View" src="static/assets/images/view-gallery.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Kanban View" src="static/assets/images/view-kanban.png"></td>
    <td width="50%"><img alt="Form View" src="static/assets/images/view-form.png"></td>
  </tr>
  <tr>
    <td width="50%"><img alt="Comments" src="static/assets/images/comments.png"></td>
    <td width="50%"><img alt="Record history" src="static/assets/images/record-history.png"></td>
  </tr>
</table>

More features have been added. See our <a target="_blank" href="https://help.teable.ai/en/changelog">Changelog</a>.

---

# Structure

[![Open in Gitpod](https://img.shields.io/badge/Open%20In-Gitpod.io-%231966D2?style=for-the-badge&logo=gitpod)](https://gitpod.io/#https://github.com/teableio/teable)

```
.
├── apps (AGPL 3.0)
│   ├── nextjs-app          (front-end)
│   └── nestjs-backend      (backend)
├── packages (MIT)
│   ├── common-i18n         (locales)
│   ├── core                (share code and interface)
│   ├── sdk                 (sdk for extensions)
│   ├── db-main-prisma      (schema, migrations, prisma client)
│   ├── eslint-config-bases (to shared eslint configs)
│   └── ui-lib              (ui component)
└── plugins (AGPL 3.0)      (custom plugins)

```

## Deploy

### Deploy With Docker

```sh
cd dockers/examples/standalone/
docker-compose up -d
```

for more details, see [install teable](https://help.teable.ai/en/deploy/docker)

### One Click Deployment

These platforms are easy to deploy with one click and come with free credits.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/wada5e?referralCode=rE4BjB)

[![Deploy on Sealos](https://sealos.io/Deploy-on-Sealos.svg)](https://template.sealos.io/deploy?templateName=teable)

[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/QF8695)

[![Deploy to RepoCloud](https://d16t0pc4846x52.cloudfront.net/deploylobe.svg)](https://repocloud.io/details/?app_id=273)

[![Deploy on Elestio](https://elest.io/images/logos/deploy-to-elestio-btn.png)](https://elest.io/open-source/teable)

[![Deploy on AlibabaCloud ComputeNest](https://service-info-public.oss-cn-hangzhou.aliyuncs.com/computenest-en.svg)](https://computenest.console.aliyun.com/service/instance/create/default?ServiceName=Teable%20%E7%A4%BE%E5%8C%BA%E7%89%88)


## Development

#### 1. Initialize

```sh
# Enabling the Help Management Package Manager
corepack enable

# Install project dependencies
pnpm install
```

#### 2. Select Database

we currently support `sqlite` (dev only) and `postgres`, you can switch between them by running the following command

```sh
make switch-db-mode
```

#### 3. Custom Environment Variables（Optional）

```sh
cd apps/nextjs-app
cp .env.development .env.development.local
```

#### 4. Run Dev Server

you just need to start backend, it will start next server for frontend automatically, file change will be auto reload

```sh
cd apps/nestjs-backend
pnpm dev
```

By default, the plugin development server is not started. To preview and develop plugins, run:
```sh
# build packages
pnpm build:packages

# start plugin development server
cd plugins
pnpm dev
```
This will start the plugin development server on port 3002.


## Why Teable?

No-code tools have significantly speed up how we get things done, allowing non-tech users to build amazing apps and changing the way many work and live. People like using spreadsheet-like UI to handle their data because it's easy, flexible, and great for team collaboration. They also prefer designing their app screens without being stuck with clunky templates.

Giving non-techy people the ability to create their software sounds exciting. But that's just the start:

- As businesses expand, their data needs intensify. No one wishes to hear that once their orders reach 100k, they'll outgrow their current interface. Yet, many no-code platforms falter at such scales.
- Most no-code platforms are cloud-based. This means your important data sits with the provider, and switching to another platform can be a headache.
- Sometimes, no-code tools can't do what you want because of their limitations, leaving users stuck.
- If a tool becomes essential, you'll eventually need some tech expertise. But developers often find these platforms tricky.
- Maintaining systems with complex setups can be hard for developers, especially if these aren't built using common software standards.
- Systems that don't use these standards might need revamping or replacing, costing more in the long run. It might even mean ditching the no-code route and going back to traditional coding.

#### What We Think the Future Of No-code Products Look Like

- An interface that anyone can use to build applications easily.
- Easy access to data, letting users grab, move, and reuse their information as they wish.
- Data privacy and choice, whether that's in the cloud, on-premise, or even just on your local.
- It needs to work for developers too, not just non-tech users.
- It should handle lots of data, so it can grow with your business.
- Flexibility to integrate with other software, combining strengths to get the job done.
- Last, native AI integration to takes usability to the next level.

In essence, Teable isn't just another no-code solution, it's a comprehensive answer to the evolving demands of modern software development, ensuring that everyone, regardless of their technical proficiency, has a platform tailored to their needs.

# License

Teable Community Edition (CE) is free for self-hosting under the AGPL license. See [./LICENSE](./LICENSE) for details.

Teable Enterprise Edition (EE) includes advanced features such as AI, authority matrix, automation and advanced admin. For detailed information and pricing, please visit [pricing](https://app.teable.ai/public/pricing?host=self-hosted&billing=year).

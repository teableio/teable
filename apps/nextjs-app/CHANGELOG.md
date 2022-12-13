# nextjs-app

## 3.55.0

### Minor Changes

- [#2739](https://github.com/teable-group/teable/pull/2739) [`b7182753`](https://github.com/teable-group/teable/commit/b71827533118907feb6bc30b95bae8c5c969d9c2) Thanks [@belgattitude](https://github.com/belgattitude)! - Add flamegraph command to debug performance issue on homepage

  ```
  npm i --global autocannon
  cd ./apps/nextjs-app
  yarn flamegraph-home
  ```

  Example output:

  ```
  ┌─────────┬───────┬───────┬───────┬───────┬──────────┬───────────┬─────────┐
  │ Stat    │ 2.5%  │ 50%   │ 97.5% │ 99%   │ Avg      │ Stdev     │ Max     │
  ├─────────┼───────┼───────┼───────┼───────┼──────────┼───────────┼─────────┤
  │ Latency │ 11 ms │ 15 ms │ 46 ms │ 82 ms │ 35.46 ms │ 276.28 ms │ 4632 ms │
  └─────────┴───────┴───────┴───────┴───────┴──────────┴───────────┴─────────┘
  ┌───────────┬─────┬──────┬─────┬─────────┬─────────┬────────┬─────────┐
  │ Stat      │ 1%  │ 2.5% │ 50% │ 97.5%   │ Avg     │ Stdev  │ Min     │
  ├───────────┼─────┼──────┼─────┼─────────┼─────────┼────────┼─────────┤
  │ Req/Sec   │ 0   │ 0    │ 0   │ 669     │ 139.06  │ 232.54 │ 148     │
  ├───────────┼─────┼──────┼─────┼─────────┼─────────┼────────┼─────────┤
  │ Bytes/Sec │ 0 B │ 0 B  │ 0 B │ 14.1 MB │ 2.93 MB │ 4.9 MB │ 3.12 MB │
  └───────────┴─────┴──────┴─────┴─────────┴─────────┴────────┴─────────┘

  Req/Bytes counts sampled once per second.
  # of samples: 20

  3k requests in 20.04s, 58.6 MB read
  ```

  Open the visual flamegraph from the provided url.

### Patch Changes

- [#2740](https://github.com/teable-group/teable/pull/2740) [`e0b03b05`](https://github.com/teable-group/teable/commit/e0b03b059ea2b75272c2a86139f7ff8b0af874a9) Thanks [@belgattitude](https://github.com/belgattitude)! - Changesets: by default will tag and version private packages

  Doc: https://github.com/changesets/changesets/blob/main/docs/versioning-apps.md
  Ref: [changesets@2.25.0](https://github.com/changesets/changesets/releases/tag/%40changesets%2Fcli%402.25.0) & [#662](https://github.com/changesets/changesets/pull/662).

- Updated dependencies [[`e0b03b05`](https://github.com/teable-group/teable/commit/e0b03b059ea2b75272c2a86139f7ff8b0af874a9)]:
  - @teable-group/api-gateway@1.2.2
  - @teable-group/common-i18n@1.2.1
  - @teable-group/sdk@3.15.1
  - @teable-group/db-main-prisma@2.12.2
  - @teable-group/core@1.1.1
  - @teable-group/ui-lib@3.15.1

## 3.54.0

### Minor Changes

- [#2713](https://github.com/teable-group/teable/pull/2713) [`e279d984`](https://github.com/teable-group/teable/commit/e279d984d01937264b077a111863b38d15fcb1d0) Thanks [@belgattitude](https://github.com/belgattitude)! - Move typescript utils to @teable-group/core

### Patch Changes

- Updated dependencies [[`e279d984`](https://github.com/teable-group/teable/commit/e279d984d01937264b077a111863b38d15fcb1d0), [`e279d984`](https://github.com/teable-group/teable/commit/e279d984d01937264b077a111863b38d15fcb1d0)]:
  - @teable-group/sdk@3.15.0
  - @teable-group/core@1.1.0
  - @teable-group/ui-lib@3.15.0

## 3.53.0

### Minor Changes

- [#2622](https://github.com/teable-group/teable/pull/2622) [`f2339d6e`](https://github.com/teable-group/teable/commit/f2339d6e62d844a1267c416d09110198e4f2af59) Thanks [@belgattitude](https://github.com/belgattitude)! - Add example with next-auth, go to /auth/login and /admin (user: admin, pass: demo)

### Patch Changes

- Updated dependencies [[`f2339d6e`](https://github.com/teable-group/teable/commit/f2339d6e62d844a1267c416d09110198e4f2af59)]:
  - @teable-group/common-i18n@1.2.0

## 3.52.3

### Patch Changes

- [#2611](https://github.com/teable-group/teable/pull/2611) [`de010ed2`](https://github.com/teable-group/teable/commit/de010ed28f21443bb1e1dbeea6c3c935a83365b3) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with nextjs config in mjs (next.config.mjs)

- Updated dependencies []:
  - @teable-group/api-gateway@1.2.1
  - @teable-group/common-i18n@1.1.1
  - @teable-group/sdk@3.14.2
  - @teable-group/db-main-prisma@2.12.1
  - @teable-group/ui-lib@3.14.5

## 3.52.2

### Patch Changes

- [#2602](https://github.com/teable-group/teable/pull/2602) [`2fc498cc`](https://github.com/teable-group/teable/commit/2fc498cc928c9a577fa4c4a0112f910e0c24f176) Thanks [@belgattitude](https://github.com/belgattitude)! - Move from @tsed/exceptions to @belgattitude/http-exception

  See https://github.com/belgattitude/http-exception

- Updated dependencies [[`2fc498cc`](https://github.com/teable-group/teable/commit/2fc498cc928c9a577fa4c4a0112f910e0c24f176)]:
  - @teable-group/sdk@3.14.2
  - @teable-group/ui-lib@3.14.4

## 3.52.1

### Patch Changes

- Updated dependencies []:
  - @teable-group/api-gateway@1.2.1
  - @teable-group/common-i18n@1.1.1
  - @teable-group/sdk@3.14.1
  - @teable-group/db-main-prisma@2.12.1
  - @teable-group/ui-lib@3.14.3

## 3.52.0

### Minor Changes

- [#2222](https://github.com/teable-group/teable/pull/2222) [`4ca97be`](https://github.com/teable-group/teable/commit/4ca97becf32c0f8bdb990ab8d6b8c8990d42fe17) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with graceful shutdown

## 3.51.1

### Patch Changes

- [#2214](https://github.com/teable-group/teable/pull/2214) [`62818ba`](https://github.com/teable-group/teable/commit/62818badff67ce032a209fe9217c319271833ddc) Thanks [@belgattitude](https://github.com/belgattitude)! - Speedup and clean yarn install on CI

- Updated dependencies [[`62818ba`](https://github.com/teable-group/teable/commit/62818badff67ce032a209fe9217c319271833ddc)]:
  - @teable-group/db-main-prisma@2.12.1
  - @teable-group/api-gateway@1.2.1
  - @teable-group/common-i18n@1.1.1
  - @teable-group/sdk@3.14.1
  - @teable-group/ui-lib@3.14.2

## 3.51.0

### Minor Changes

- [#2189](https://github.com/teable-group/teable/pull/2189) [`9d43ef2`](https://github.com/teable-group/teable/commit/9d43ef26c4385bed2010aff563807a6b4088f37c) Thanks [@belgattitude](https://github.com/belgattitude)! - Example of CSP configuration

## 3.50.0

### Minor Changes

- [#2187](https://github.com/teable-group/teable/pull/2187) [`d6efad3`](https://github.com/teable-group/teable/commit/d6efad3c967b65dd74e8df3898f95c847fb2515c) Thanks [@belgattitude](https://github.com/belgattitude)! - Enable SWC compiler

## 3.49.3

### Patch Changes

- Updated dependencies [[`0279cc2`](https://github.com/teable-group/teable/commit/0279cc2598c0ffbc83219dda893e303a38af6bfd)]:
  - @teable-group/db-main-prisma@2.12.0
  - @teable-group/api-gateway@1.2.0
  - @teable-group/common-i18n@1.1.0
  - @teable-group/sdk@3.14.0
  - @teable-group/ui-lib@3.14.1

## 3.49.2

### Patch Changes

- Updated dependencies [[`31ac0da`](https://github.com/teable-group/teable/commit/31ac0da08875ece918777fa54379e7b2e4c4286f)]:
  - @teable-group/ui-lib@3.14.0

## 3.49.1

### Patch Changes

- Updated dependencies []:
  - @teable-group/api-gateway@1.2.0
  - @teable-group/common-i18n@1.1.0
  - @teable-group/sdk@3.14.0
  - @teable-group/db-main-prisma@2.11.0
  - @teable-group/ui-lib@3.13.1

## 3.49.0

### Minor Changes

- [#1876](https://github.com/teable-group/teable/pull/1876) [`5ad462a`](https://github.com/teable-group/teable/commit/5ad462a9a621564366c7a0ef0a77899fc855de85) Thanks [@belgattitude](https://github.com/belgattitude)! - Enable eslint global cache

### Patch Changes

- Updated dependencies [[`5ad462a`](https://github.com/teable-group/teable/commit/5ad462a9a621564366c7a0ef0a77899fc855de85)]:
  - @teable-group/api-gateway@1.2.0
  - @teable-group/common-i18n@1.1.0
  - @teable-group/sdk@3.14.0
  - @teable-group/db-main-prisma@2.11.0
  - @teable-group/ui-lib@3.13.0

## 3.48.0

### Minor Changes

- [#1846](https://github.com/teable-group/teable/pull/1846) [`f3b8320`](https://github.com/teable-group/teable/commit/f3b832052a47c7b508892d3bb5b5546b4b61816d) Thanks [@belgattitude](https://github.com/belgattitude)! - Example using vitest/happy-dom instead of jest

  Current basic unit test suite went from +/-12s to +/-5s on github action.

## 3.47.1

### Patch Changes

- [#1843](https://github.com/teable-group/teable/pull/1843) [`9804111`](https://github.com/teable-group/teable/commit/98041113ca05d96142b751b8d86aa2c54f06db10) Thanks [@belgattitude](https://github.com/belgattitude)! - Rename package graphql-mesh to api-gateway

- Updated dependencies [[`9804111`](https://github.com/teable-group/teable/commit/98041113ca05d96142b751b8d86aa2c54f06db10)]:
  - @teable-group/api-gateway@1.1.1

## 3.47.0

### Minor Changes

- [#1780](https://github.com/teable-group/teable/pull/1780) [`3d3863a`](https://github.com/teable-group/teable/commit/3d3863a06715cfda9f9d25ac7676889a3c22bc2e) Thanks [@belgattitude](https://github.com/belgattitude)! - Example of graphql gateway (mesh)

### Patch Changes

- Updated dependencies [[`3d3863a`](https://github.com/teable-group/teable/commit/3d3863a06715cfda9f9d25ac7676889a3c22bc2e)]:
  - @teable-group/graphql-mesh@1.1.0

## 3.46.0

### Minor Changes

- [#1741](https://github.com/teable-group/teable/pull/1741) [`70a76e7`](https://github.com/teable-group/teable/commit/70a76e747a425a0c975a8f80249421470efec0ce) Thanks [@belgattitude](https://github.com/belgattitude)! - Use emotion native ssr critical extraction

  Since React 18, latest nextjs and emotion the critical path extraction
  works out of the box. No flash of unstyled content anymore. Removes the
  double rendering too, expect better lighthouse and initial page rendering
  (to be measured).

## 3.45.0

### Minor Changes

- [#1727](https://github.com/teable-group/teable/pull/1727) [`a844907`](https://github.com/teable-group/teable/commit/a8449073efa6d1311ab9c51f9cacd451fafff3f4) Thanks [@belgattitude](https://github.com/belgattitude)! - Example and howto consume shared locales from @teable-group/common-i18n

### Patch Changes

- Updated dependencies [[`a844907`](https://github.com/teable-group/teable/commit/a8449073efa6d1311ab9c51f9cacd451fafff3f4)]:
  - @teable-group/common-i18n@1.0.0

## 3.44.2

### Patch Changes

- Updated dependencies []:
  - @teable-group/sdk@3.13.0
  - @teable-group/db-main-prisma@2.10.0
  - @teable-group/ui-lib@3.12.2

## 3.44.1

### Patch Changes

- Updated dependencies []:
  - @teable-group/sdk@3.13.0
  - @teable-group/db-main-prisma@2.10.0
  - @teable-group/ui-lib@3.12.1

## 3.44.0

### Minor Changes

- [#1656](https://github.com/teable-group/teable/pull/1656) [`9f2c2d0`](https://github.com/teable-group/teable/commit/9f2c2d049cfb87a3023a38b096f07f998862e3f6) Thanks [@belgattitude](https://github.com/belgattitude)! - Improved linter configs

### Patch Changes

- Updated dependencies [[`9f2c2d0`](https://github.com/teable-group/teable/commit/9f2c2d049cfb87a3023a38b096f07f998862e3f6)]:
  - @teable-group/sdk@3.13.0
  - @teable-group/db-main-prisma@2.10.0
  - @teable-group/ui-lib@3.12.0

## 3.43.2

### Patch Changes

- [#1649](https://github.com/teable-group/teable/pull/1649) [`113d338`](https://github.com/teable-group/teable/commit/113d338172d5f7c7e1c0a7adcca1354d18bad016) Thanks [@belgattitude](https://github.com/belgattitude)! - Rename web-app into nextjs-app

## 3.43.1

### Patch Changes

- Updated dependencies [[`ee0a3db`](https://github.com/teable-group/teable/commit/ee0a3dbd664c33d7149302ae3f776951dbd50492)]:
  - @teable-group/sdk@3.12.0
  - @teable-group/db-main-prisma@2.9.0
  - @teable-group/ui-lib@3.11.0

## 3.43.0

### Minor Changes

- [#1409](https://github.com/teable-group/teable/pull/1409) [`16121b8`](https://github.com/teable-group/teable/commit/16121b87b964aad903dab3deebae9827a79b54b2) Thanks [@belgattitude](https://github.com/belgattitude)! - Updated to use @sentry/nextjs rather than @sentry/\*. Added monitoring routes.

## 3.42.0

### Minor Changes

- [#1421](https://github.com/teable-group/teable/pull/1421) [`1826dcc`](https://github.com/teable-group/teable/commit/1826dcc42d1a46c7cdd4a4c7a396773f5188d7fe) Thanks [@belgattitude](https://github.com/belgattitude)! - Added example to build web-app on CI

### Patch Changes

- [#1421](https://github.com/teable-group/teable/pull/1421) [`1826dcc`](https://github.com/teable-group/teable/commit/1826dcc42d1a46c7cdd4a4c7a396773f5188d7fe) Thanks [@belgattitude](https://github.com/belgattitude)! - Small docker fix for setting user and group on latest alpine

## 3.41.0

### Minor Changes

- [#1383](https://github.com/teable-group/teable/pull/1383) [`9e4d041`](https://github.com/teable-group/teable/commit/9e4d0414f87bf54e8630233740e843489212a93c) Thanks [@belgattitude](https://github.com/belgattitude)! - With React 18

### Patch Changes

- [#1383](https://github.com/teable-group/teable/pull/1383) [`9e4d041`](https://github.com/teable-group/teable/commit/9e4d0414f87bf54e8630233740e843489212a93c) Thanks [@belgattitude](https://github.com/belgattitude)! - Updated nextjs.config with links

## 3.40.0

### Minor Changes

- [#1347](https://github.com/teable-group/teable/pull/1347) [`82e77f7c`](https://github.com/teable-group/teable/commit/82e77f7ce8a8fda3db16796685c817cb142114bb) Thanks [@belgattitude](https://github.com/belgattitude)! - Use and enforce workspace:^ protocol rather than workspace:\*

### Patch Changes

- Updated dependencies [[`e269ada4`](https://github.com/teable-group/teable/commit/e269ada479151a243128612278bc0d5642e6db04), [`82e77f7c`](https://github.com/teable-group/teable/commit/82e77f7ce8a8fda3db16796685c817cb142114bb)]:
  - @teable-group/ui-lib@3.10.0

## 3.39.0

### Minor Changes

- [#1341](https://github.com/teable-group/teable/pull/1341) [`e23bdf2c`](https://github.com/teable-group/teable/commit/e23bdf2c96ff65a8ce946a03eeaac97d3ac991aa) Thanks [@belgattitude](https://github.com/belgattitude)! - Add es-check to ensure produced build files passes ecmascript

* [#1341](https://github.com/teable-group/teable/pull/1341) [`05291de7`](https://github.com/teable-group/teable/commit/05291de7deeed720e8b7271d339050116b448177) Thanks [@belgattitude](https://github.com/belgattitude)! - Refactor scripts identifiers defined in package.json. Restrict usage of ':' in apps and packages

### Patch Changes

- Updated dependencies [[`05291de7`](https://github.com/teable-group/teable/commit/05291de7deeed720e8b7271d339050116b448177)]:
  - @teable-group/sdk@3.11.0
  - @teable-group/db-main-prisma@2.8.0
  - @teable-group/ui-lib@3.9.0

## 3.38.2

### Patch Changes

- Updated dependencies [[`50e79d76`](https://github.com/teable-group/teable/commit/50e79d7659a13a0715e864c5b4aff3bf999afcfe)]:
  - @teable-group/sdk@3.10.0

## 3.38.1

### Patch Changes

- [#1104](https://github.com/teable-group/teable/pull/1104) [`73d03354`](https://github.com/teable-group/teable/commit/73d0335454487812b78b65a4f17efe79a022fb53) Thanks [@renovate](https://github.com/apps/renovate)! - fix(deps): update dependency type-fest to v2.9.0

- Updated dependencies [[`43fd9647`](https://github.com/teable-group/teable/commit/43fd964796af951d1cfff78592330bc2fa231b75)]:
  - @teable-group/ui-lib@3.8.1

## 3.38.0

### Minor Changes

- [#508](https://github.com/teable-group/teable/pull/508) [`cb336eca`](https://github.com/teable-group/teable/commit/cb336eca54004d6117d004820c95055ffc655f3e) Thanks [@belgattitude](https://github.com/belgattitude)! - Improved docker example

## 3.37.0

### Minor Changes

- [#975](https://github.com/teable-group/teable/pull/975) [`17582dd0`](https://github.com/teable-group/teable/commit/17582dd09d1176311a2f2c8fd94bebaaf31fc0cf) Thanks [@belgattitude](https://github.com/belgattitude)! - Upgrade to tailwind V3

## 3.36.0

### Minor Changes

- [#963](https://github.com/teable-group/teable/pull/963) [`5e25fab2`](https://github.com/teable-group/teable/commit/5e25fab2f0d620e999f536a1fb8e0ef45d56fd64) Thanks [@belgattitude](https://github.com/belgattitude)! - Upgraded to react 18.0.0-rc.0

### Patch Changes

- Updated dependencies [[`5e25fab2`](https://github.com/teable-group/teable/commit/5e25fab2f0d620e999f536a1fb8e0ef45d56fd64)]:
  - @teable-group/sdk@3.9.0
  - @teable-group/ui-lib@3.8.0

## 3.35.1

### Patch Changes

- Updated dependencies [[`cfcab664`](https://github.com/teable-group/teable/commit/cfcab66479a8b28468f67748abb559c4eb2fb10a)]:
  - @teable-group/ui-lib@3.7.0

## 3.35.0

### Minor Changes

- [#890](https://github.com/teable-group/teable/pull/890) [`4e16294`](https://github.com/teable-group/teable/commit/4e1629403e4de5e847e27bb11cc81a0eac9165c5) Thanks [@belgattitude](https://github.com/belgattitude)! - E2E test example with playwright + github action

## 3.34.1

### Patch Changes

- Updated dependencies [[`fcd68ed`](https://github.com/teable-group/teable/commit/fcd68ed476734fefda85f5ffa2cf82cbd1502aa6)]:
  - @teable-group/sdk@3.8.1
  - @teable-group/ui-lib@3.6.1

## 3.34.0

### Minor Changes

- [#614](https://github.com/teable-group/teable/pull/614) [`b36771c`](https://github.com/teable-group/teable/commit/b36771cd573f3a0805eee97d8e2bffb079915bf9) Thanks [@belgattitude](https://github.com/belgattitude)! - Example of favicons

## 3.33.2

### Patch Changes

- [#593](https://github.com/teable-group/teable/pull/593) [`7622030`](https://github.com/teable-group/teable/commit/7622030785a60e6ee203db68b5b3e22373839840) Thanks [@belgattitude](https://github.com/belgattitude)! - Prevent installation of both v20 & v21 of i18next

## 3.33.1

### Patch Changes

- Updated dependencies [[`bbc1a8f`](https://github.com/teable-group/teable/commit/bbc1a8f07500d13ddf3e86f2cb4111f4f22ddb11)]:
  - @teable-group/db-main-prisma@2.7.0

## 3.33.0

### Minor Changes

- [#580](https://github.com/teable-group/teable/pull/580) [`fe262d0`](https://github.com/teable-group/teable/commit/fe262d011845ac4d9471b3334b4bd387d96b2e87) Thanks [@belgattitude](https://github.com/belgattitude)! - Optimize svg with svgo by default when building the apps

## 3.32.0

### Minor Changes

- [#538](https://github.com/teable-group/teable/pull/538) [`186e7d6`](https://github.com/teable-group/teable/commit/186e7d674b4e93d0e7067b2e80af7b98d52c42e2) Thanks [@belgattitude](https://github.com/belgattitude)! - Add example of mui / tailwind shared theme spec

## 3.31.0

### Minor Changes

- [#553](https://github.com/teable-group/teable/pull/553) [`77e758b`](https://github.com/teable-group/teable/commit/77e758bbed1bc4f13b99cdd0ed90fa11fde9518f) Thanks [@belgattitude](https://github.com/belgattitude)! - Add eslint-plugin-regexp

### Patch Changes

- Updated dependencies [[`77e758b`](https://github.com/teable-group/teable/commit/77e758bbed1bc4f13b99cdd0ed90fa11fde9518f)]:
  - @teable-group/sdk@3.8.0
  - @teable-group/db-main-prisma@2.6.0
  - @teable-group/ui-lib@3.6.0

## 3.30.0

### Minor Changes

- [#551](https://github.com/teable-group/teable/pull/551) [`a93c0b7`](https://github.com/teable-group/teable/commit/a93c0b76875073cb27ed76f31f793e2cbf4af107) Thanks [@belgattitude](https://github.com/belgattitude)! - Add eslint-plugin-tailwindcss to help consistency

## 3.29.0

### Minor Changes

- [#494](https://github.com/teable-group/teable/pull/494) [`6360483`](https://github.com/teable-group/teable/commit/63604839a2b8a2caac59e461d533100b5f9146aa) Thanks [@belgattitude](https://github.com/belgattitude)! - Import locally installed fonts rather than google hosted ones, thx fontsource.org

## 3.28.0

### Minor Changes

- [#439](https://github.com/teable-group/teable/pull/439) [`2f26167`](https://github.com/teable-group/teable/commit/2f2616760b024bb887d52f200d0943e57da69f61) Thanks [@belgattitude](https://github.com/belgattitude)! - Basic example for material-ui v5.0.0 and critical path extraction (emotion)

## 3.27.0

### Minor Changes

- [#438](https://github.com/teable-group/teable/pull/438) [`6b78e59`](https://github.com/teable-group/teable/commit/6b78e59e4933814e69c26c86743a5b003c92dc2a) Thanks [@belgattitude](https://github.com/belgattitude)! - Eslint performance by not running test plugins over regular code

### Patch Changes

- Updated dependencies [[`6b78e59`](https://github.com/teable-group/teable/commit/6b78e59e4933814e69c26c86743a5b003c92dc2a)]:
  - @teable-group/sdk@3.7.0
  - @teable-group/ui-lib@3.5.0
  - @teable-group/db-main-prisma@2.5.0

## 3.26.3

### Patch Changes

- Updated dependencies [[`dd239d6`](https://github.com/teable-group/teable/commit/dd239d63d99fdbf23150faf776f8c4be4dcf6e20)]:
  - @teable-group/db-main-prisma@2.4.0

## 3.26.2

### Patch Changes

- [#356](https://github.com/teable-group/teable/pull/356) [`db7870f`](https://github.com/teable-group/teable/commit/db7870fbef1ac0422e8d142ab6bcd7d593abd685) Thanks [@belgattitude](https://github.com/belgattitude)! - CI: add extra check for missing / undeclared dependencies

* [#354](https://github.com/teable-group/teable/pull/354) [`16e4e2d`](https://github.com/teable-group/teable/commit/16e4e2d7b6023a0cc9bf62120d7b5b8e223740b5) Thanks [@belgattitude](https://github.com/belgattitude)! - Improve eslint config and add eslint-plugin-import

* Updated dependencies [[`db7870f`](https://github.com/teable-group/teable/commit/db7870fbef1ac0422e8d142ab6bcd7d593abd685), [`16e4e2d`](https://github.com/teable-group/teable/commit/16e4e2d7b6023a0cc9bf62120d7b5b8e223740b5)]:
  - @teable-group/sdk@3.6.1
  - @teable-group/db-main-prisma@2.3.1
  - @teable-group/ui-lib@3.4.1

## 3.26.1

### Patch Changes

- [#334](https://github.com/teable-group/teable/pull/334) [`7c69c58`](https://github.com/teable-group/teable/commit/7c69c5863bb5e5d5b426ca7ded7362ce4f445305) Thanks [@belgattitude](https://github.com/belgattitude)! - next.config.js allow example unused variables in webpack override

* [#290](https://github.com/teable-group/teable/pull/290) [`ec1cd6a`](https://github.com/teable-group/teable/commit/ec1cd6a346f323ee67570082a32ecb9f7ec2d136) Thanks [@belgattitude](https://github.com/belgattitude)! - CI perf - nextjs build cache: prevent cache going stale

## 3.26.0

### Minor Changes

- [#330](https://github.com/teable-group/teable/pull/330) [`25a163d`](https://github.com/teable-group/teable/commit/25a163db7c17a3a126514978f427d41fe121b961) Thanks [@belgattitude](https://github.com/belgattitude)! - Add sharp as regular dependency

## 3.25.0

### Minor Changes

- [#323](https://github.com/teable-group/teable/pull/323) [`a416f35`](https://github.com/teable-group/teable/commit/a416f3550dd0bb8412297295206f586630e586c0) Thanks [@belgattitude](https://github.com/belgattitude)! - Example: eslint-plugin-sonarjs cause cause it desserves to belong here

### Patch Changes

- Updated dependencies [[`a416f35`](https://github.com/teable-group/teable/commit/a416f3550dd0bb8412297295206f586630e586c0)]:
  - @teable-group/sdk@3.6.0
  - @teable-group/db-main-prisma@2.3.0
  - @teable-group/ui-lib@3.4.0

## 3.24.0

### Minor Changes

- [#319](https://github.com/teable-group/teable/pull/319) [`2ccb056`](https://github.com/teable-group/teable/commit/2ccb056660dfd84a75e1a8733e56cc8d9b3fd353) Thanks [@belgattitude](https://github.com/belgattitude)! - Updated to Typescript 4.4.2 strict ("useUnknownInCatchVariables": true)

### Patch Changes

- Updated dependencies [[`2ccb056`](https://github.com/teable-group/teable/commit/2ccb056660dfd84a75e1a8733e56cc8d9b3fd353)]:
  - @teable-group/sdk@3.5.0
  - @teable-group/db-main-prisma@2.2.0
  - @teable-group/ui-lib@3.3.0

## 3.23.1

### Patch Changes

- [#312](https://github.com/teable-group/teable/pull/312) [`3982ef0`](https://github.com/teable-group/teable/commit/3982ef0c9c078b159d2d1aa0076367c49fedb4f0) Thanks [@belgattitude](https://github.com/belgattitude)! - Refactored and fully type i18n keys per activated namespaces

## 3.23.0

### Minor Changes

- [#311](https://github.com/teable-group/teable/pull/311) [`f4cce0d`](https://github.com/teable-group/teable/commit/f4cce0d2c24536c49b72a1a18565548879e639aa) Thanks [@belgattitude](https://github.com/belgattitude)! - Add example of translated Custom 404 page (getStaticProps)

* [#287](https://github.com/teable-group/teable/pull/287) [`5a24abb`](https://github.com/teable-group/teable/commit/5a24abb4db86141eb22ccc2634d87c2b0902c3af) Thanks [@belgattitude](https://github.com/belgattitude)! - Add 404 page in example to reduce bundle size

- [#309](https://github.com/teable-group/teable/pull/309) [`e7a6f54`](https://github.com/teable-group/teable/commit/e7a6f54ca392fef6afa6824dcfc6bed211442d5f) Thanks [@belgattitude](https://github.com/belgattitude)! - Testing: add example with react-i18n provider

## 3.22.0

### Minor Changes

- [#307](https://github.com/teable-group/teable/pull/307) [`adaf85e`](https://github.com/teable-group/teable/commit/adaf85edd8137eae23a2b084ca9d85ea7a11a6fd) Thanks [@belgattitude](https://github.com/belgattitude)! - Perf: next.config.js allow conditional typecheck in build (faster ci possible)

## 3.21.1

### Patch Changes

- Updated dependencies [[`6cc466a`](https://github.com/teable-group/teable/commit/6cc466a8d0caf4e2ec8931ce87696ee83af71d19)]:
  - @teable-group/db-main-prisma@2.1.0

## 3.21.0

### Minor Changes

- [#286](https://github.com/teable-group/teable/pull/286) [`e030e4b`](https://github.com/teable-group/teable/commit/e030e4b1c2e865378bb5bc3e219286fda9bbebfc) Thanks [@belgattitude](https://github.com/belgattitude)! - Enable experimental.esmExternals for NextJs 11.1.0

## 3.20.0

### Minor Changes

- [#278](https://github.com/teable-group/teable/pull/278) [`3b15241`](https://github.com/teable-group/teable/commit/3b15241726d57c7ddafc9b2766cb670ada617def) Thanks [@belgattitude](https://github.com/belgattitude)! - Add example of svg icons

* [#278](https://github.com/teable-group/teable/pull/278) [`3b15241`](https://github.com/teable-group/teable/commit/3b15241726d57c7ddafc9b2766cb670ada617def) Thanks [@belgattitude](https://github.com/belgattitude)! - Add webpack/svgr typescript type definitions

- [#278](https://github.com/teable-group/teable/pull/278) [`3b15241`](https://github.com/teable-group/teable/commit/3b15241726d57c7ddafc9b2766cb670ada617def) Thanks [@belgattitude](https://github.com/belgattitude)! - Add src/types.d folder to store the additional type defs

### Patch Changes

- Updated dependencies [[`3b15241`](https://github.com/teable-group/teable/commit/3b15241726d57c7ddafc9b2766cb670ada617def)]:
  - @teable-group/ui-lib@3.2.0

## 3.19.0

### Minor Changes

- [#265](https://github.com/teable-group/teable/pull/265) [`e321b8c`](https://github.com/teable-group/teable/commit/e321b8cdd35abab8a3c8cc08785017d39b04ce8d) Thanks [@belgattitude](https://github.com/belgattitude)! - Simplify setup, use NextJS 10.2+ experimental externalDirs option

## 3.18.0

### Minor Changes

- [#262](https://github.com/teable-group/teable/pull/262) [`dd2669d`](https://github.com/teable-group/teable/commit/dd2669d6d4079af52b7127722531404aec48d371) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with typed getServerSideProps

* [#261](https://github.com/teable-group/teable/pull/261) [`7e3b862`](https://github.com/teable-group/teable/commit/7e3b862766dd33423d295134fd3e365eed6fa220) Thanks [@belgattitude](https://github.com/belgattitude)! - Refactor app structure and configs

## 3.17.0

### Minor Changes

- [#260](https://github.com/teable-group/teable/pull/260) [`57e8cb1`](https://github.com/teable-group/teable/commit/57e8cb1fac0adbbdcbb88bdac709ed6e75e8887d) Thanks [@belgattitude](https://github.com/belgattitude)! - Typesafe features configs with i18n namespaces

* [#257](https://github.com/teable-group/teable/pull/257) [`d3b8916`](https://github.com/teable-group/teable/commit/d3b8916b9a9e208e746e85363f6a18dc164fee6c) Thanks [@belgattitude](https://github.com/belgattitude)! - Backend config for prisma updated to multi schema (prep)

### Patch Changes

- Updated dependencies [[`d3b8916`](https://github.com/teable-group/teable/commit/d3b8916b9a9e208e746e85363f6a18dc164fee6c)]:
  - @teable-group/db-main-prisma@2.0.0

## 3.16.0

### Minor Changes

- [#251](https://github.com/teable-group/teable/pull/251) [`931ba44`](https://github.com/teable-group/teable/commit/931ba441f6558386b6857571061f1cc559bf2e43) Thanks [@belgattitude](https://github.com/belgattitude)! - Updated to NextJs 11.1.0

* [#251](https://github.com/teable-group/teable/pull/251) [`931ba44`](https://github.com/teable-group/teable/commit/931ba441f6558386b6857571061f1cc559bf2e43) Thanks [@belgattitude](https://github.com/belgattitude)! - Typechecks enabled for next.config.js

## 3.15.1

### Patch Changes

- [#231](https://github.com/teable-group/teable/pull/231) [`90b0472`](https://github.com/teable-group/teable/commit/90b0472a3894a28a2b94e4ef85bee7d3a05f059e) Thanks [@belgattitude](https://github.com/belgattitude)! - Allow sentry/nextjs to be disabled by env variables (ie: in for local builds or CI)

## 3.15.0

### Minor Changes

- [#189](https://github.com/teable-group/teable/pull/189) [`9be480e`](https://github.com/teable-group/teable/commit/9be480efadf976df9e8a106532cb3860014bfd4d) Thanks [@belgattitude](https://github.com/belgattitude)! - Multistage docker build example

* [#207](https://github.com/teable-group/teable/pull/207) [`3ee5d16`](https://github.com/teable-group/teable/commit/3ee5d16081bbf12aaa0345e0587012cb94546914) Thanks [@belgattitude](https://github.com/belgattitude)! - Basic example of graphql (sdl based) route

### Patch Changes

- [#189](https://github.com/teable-group/teable/pull/189) [`9be480e`](https://github.com/teable-group/teable/commit/9be480efadf976df9e8a106532cb3860014bfd4d) Thanks [@belgattitude](https://github.com/belgattitude)! - Fix next.config.js to not rely on bundle-analyzer when installed in production

## 3.14.0

### Minor Changes

- [#216](https://github.com/teable-group/teable/pull/216) [`0184987`](https://github.com/teable-group/teable/commit/0184987f390b704dbfbcad0f272b220f4765f9c8) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with sentry

## 3.13.0

### Minor Changes

- [#210](https://github.com/teable-group/teable/pull/210) [`9d68258`](https://github.com/teable-group/teable/commit/9d6825850cb95e593b648f408814b02eb1c85fc7) Thanks [@belgattitude](https://github.com/belgattitude)! - Example of basic size-limit action

## 3.12.1

### Patch Changes

- [#181](https://github.com/teable-group/teable/pull/181) [`c5173ea`](https://github.com/teable-group/teable/commit/c5173ea4d9ae5f476c0434ad25a6ff7735350e06) Thanks [@belgattitude](https://github.com/belgattitude)! - Fix possible issues with peerDeps

- Updated dependencies [[`c5173ea`](https://github.com/teable-group/teable/commit/c5173ea4d9ae5f476c0434ad25a6ff7735350e06)]:
  - @teable-group/sdk@3.4.0
  - @teable-group/db-main-prisma@1.2.1

## 3.12.0

### Minor Changes

- [#140](https://github.com/teable-group/teable/pull/140) [`4929105`](https://github.com/teable-group/teable/commit/4929105635b9bfd460a5653ceb8cb05353bb9a8f) Thanks [@belgattitude](https://github.com/belgattitude)! - Example of fully typed api (ssr and frontend)

### Patch Changes

- [#172](https://github.com/teable-group/teable/pull/172) [`01e5e89`](https://github.com/teable-group/teable/commit/01e5e89e028029c5ef415f2f825d022f96a97fd4) Thanks [@belgattitude](https://github.com/belgattitude)! - Relaxed codeclimate config for react components

- Updated dependencies [[`4929105`](https://github.com/teable-group/teable/commit/4929105635b9bfd460a5653ceb8cb05353bb9a8f), [`01e5e89`](https://github.com/teable-group/teable/commit/01e5e89e028029c5ef415f2f825d022f96a97fd4), [`4929105`](https://github.com/teable-group/teable/commit/4929105635b9bfd460a5653ceb8cb05353bb9a8f), [`3c8ef69`](https://github.com/teable-group/teable/commit/3c8ef6900120557fae33ff565595f8fe2b9628a9), [`4929105`](https://github.com/teable-group/teable/commit/4929105635b9bfd460a5653ceb8cb05353bb9a8f), [`4929105`](https://github.com/teable-group/teable/commit/4929105635b9bfd460a5653ceb8cb05353bb9a8f)]:
  - @teable-group/sdk@3.3.0
  - @teable-group/db-main-prisma@1.2.0
  - @teable-group/ui-lib@3.1.3

## 3.11.1

### Patch Changes

- [#135](https://github.com/teable-group/teable/pull/135) [`d548b70`](https://github.com/teable-group/teable/commit/d548b70b53baaa67d6de4e8a7c6254b59db3ced3) Thanks [@belgattitude](https://github.com/belgattitude)! - CI: use built-in yarn cache from setup/node@v2.2

- Updated dependencies [[`d548b70`](https://github.com/teable-group/teable/commit/d548b70b53baaa67d6de4e8a7c6254b59db3ced3)]:
  - @teable-group/sdk@3.2.2
  - @teable-group/db-main-prisma@1.1.3
  - @teable-group/ui-lib@3.1.2

## 3.11.0

### Minor Changes

- [#71](https://github.com/teable-group/teable/pull/71) [`3903624`](https://github.com/teable-group/teable/commit/3903624ad3c87b282947ed3eea84f6451c622fe6) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with next-i18next and typed translation keys

### Patch Changes

- [#117](https://github.com/teable-group/teable/pull/117) [`4607a02`](https://github.com/teable-group/teable/commit/4607a02d91e87134f306d25dfeabdba9c83b3837) Thanks [@belgattitude](https://github.com/belgattitude)! - Improved documentation

- Updated dependencies [[`4607a02`](https://github.com/teable-group/teable/commit/4607a02d91e87134f306d25dfeabdba9c83b3837)]:
  - @teable-group/db-main-prisma@1.1.2

## 3.10.0

### Minor Changes

- [#112](https://github.com/teable-group/teable/pull/112) [`f1b34bf`](https://github.com/teable-group/teable/commit/f1b34bfbf65fd1cadde8ced3811bd88b014aa65d) Thanks [@belgattitude](https://github.com/belgattitude)! - Remove why-did-your-render, does not work well with emotion

## 3.9.1

### Patch Changes

- [#107](https://github.com/teable-group/teable/pull/107) [`90b0d23`](https://github.com/teable-group/teable/commit/90b0d23a8da942718f6f2834d73171ac9b4005da) Thanks [@belgattitude](https://github.com/belgattitude)! - Browserlist per environment (dev/prod)

## 3.9.0

### Minor Changes

- [#101](https://github.com/teable-group/teable/pull/101) [`218827a`](https://github.com/teable-group/teable/commit/218827aa16c68d728a31e3ffcefe03c0df8febd0) Thanks [@belgattitude](https://github.com/belgattitude)! - Update to tailwind 2.2.0 and jit mode

## 3.8.0

### Minor Changes

- [#98](https://github.com/teable-group/teable/pull/98) [`86022f7`](https://github.com/teable-group/teable/commit/86022f784a07c1ad222b3d8897fcba021d268564) Thanks [@belgattitude](https://github.com/belgattitude)! - Upgrade to NextJs 11

* [#98](https://github.com/teable-group/teable/pull/98) [`1392357`](https://github.com/teable-group/teable/commit/1392357e45c13bbbdf234208bc73c9f23be12ed3) Thanks [@belgattitude](https://github.com/belgattitude)! - Add nextjs eslint recommended configuration

## 3.7.0

### Minor Changes

- [#91](https://github.com/teable-group/teable/pull/91) [`3c646e7`](https://github.com/teable-group/teable/commit/3c646e7dfd6ec246035f048634f6533082412d3a) Thanks [@belgattitude](https://github.com/belgattitude)! - Example for google font preconnect

* [#91](https://github.com/teable-group/teable/pull/91) [`45de065`](https://github.com/teable-group/teable/commit/45de0659558ac7a3f88ee6cb7fd070bd0395f83e) Thanks [@belgattitude](https://github.com/belgattitude)! - Example: customize tailwind configuration

- [#89](https://github.com/teable-group/teable/pull/89) [`5fe5f2a`](https://github.com/teable-group/teable/commit/5fe5f2a9cc0528617f0b53f9fb369afaf252358f) Thanks [@belgattitude](https://github.com/belgattitude)! - Example for browserlist support

## 3.6.1

### Patch Changes

- [#84](https://github.com/teable-group/teable/pull/84) [`a9c0d5e`](https://github.com/teable-group/teable/commit/a9c0d5e2651732ab23f1a335acddd23aef5a6b88) Thanks [@belgattitude](https://github.com/belgattitude)! - Jest: use css transform from jest-css-modules-transform

* [#84](https://github.com/teable-group/teable/pull/84) [`697842e`](https://github.com/teable-group/teable/commit/697842e913bd7164b21b51c9c9adb943b0904293) Thanks [@belgattitude](https://github.com/belgattitude)! - Jest: added mock configs

- [#84](https://github.com/teable-group/teable/pull/84) [`697842e`](https://github.com/teable-group/teable/commit/697842e913bd7164b21b51c9c9adb943b0904293) Thanks [@belgattitude](https://github.com/belgattitude)! - ESlint: added plugin:testing-library/react

- Updated dependencies [[`a9c0d5e`](https://github.com/teable-group/teable/commit/a9c0d5e2651732ab23f1a335acddd23aef5a6b88), [`697842e`](https://github.com/teable-group/teable/commit/697842e913bd7164b21b51c9c9adb943b0904293), [`697842e`](https://github.com/teable-group/teable/commit/697842e913bd7164b21b51c9c9adb943b0904293)]:
  - @teable-group/sdk@3.2.1
  - @teable-group/db-main-prisma@1.1.1
  - @teable-group/ui-lib@3.1.1

## 3.6.0

### Minor Changes

- [#74](https://github.com/teable-group/teable/pull/74) [`5010c94`](https://github.com/teable-group/teable/commit/5010c944162165ab47923718a9ccaf1cafc419ee) Thanks [@belgattitude](https://github.com/belgattitude)! - Extract a separate prisma package lib

* [#79](https://github.com/teable-group/teable/pull/79) [`a38c143`](https://github.com/teable-group/teable/commit/a38c1434486d2affdd95bfd9836160d63a11a2f7) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with why-did-you-render

### Patch Changes

- Updated dependencies [[`5010c94`](https://github.com/teable-group/teable/commit/5010c944162165ab47923718a9ccaf1cafc419ee)]:
  - @teable-group/db-main-prisma@1.1.0

## 3.5.0

### Minor Changes

- [#69](https://github.com/teable-group/teable/pull/69) [`4fda76c`](https://github.com/teable-group/teable/commit/4fda76c2c9bc7b528d4a794b2738ef52fd505465) Thanks [@belgattitude](https://github.com/belgattitude)! - Styling the app with tailwind

## 3.4.0

### Minor Changes

- [#67](https://github.com/teable-group/teable/pull/67) [`152e4ad`](https://github.com/teable-group/teable/commit/152e4adc8be95f192b066f75ef4bb2dd42c46d12) Thanks [@belgattitude](https://github.com/belgattitude)! - Jest 27 and Typescript 4.3.1

### Patch Changes

- Updated dependencies [[`152e4ad`](https://github.com/teable-group/teable/commit/152e4adc8be95f192b066f75ef4bb2dd42c46d12)]:
  - @teable-group/sdk@3.2.0
  - @teable-group/ui-lib@3.1.0

## 3.3.0

### Minor Changes

- [#64](https://github.com/teable-group/teable/pull/64) [`800ccdc`](https://github.com/teable-group/teable/commit/800ccdcc93884157d4b9535272625a5a5719e83d) Thanks [@belgattitude](https://github.com/belgattitude)! - Add prisma and next-auth example

### Patch Changes

- Updated dependencies [[`800ccdc`](https://github.com/teable-group/teable/commit/800ccdcc93884157d4b9535272625a5a5719e83d), [`800ccdc`](https://github.com/teable-group/teable/commit/800ccdcc93884157d4b9535272625a5a5719e83d)]:
  - @teable-group/sdk@3.1.0

## 3.2.0

### Minor Changes

- [#61](https://github.com/teable-group/teable/pull/61) [`757aef8`](https://github.com/teable-group/teable/commit/757aef899e005b18aef175240856e5c89dc8e23c) Thanks [@belgattitude](https://github.com/belgattitude)! - Example for sharing static assets and locales

## 3.1.0

### Minor Changes

- [#50](https://github.com/teable-group/teable/pull/50) [`62cea64`](https://github.com/teable-group/teable/commit/62cea645216dad5e5160be0bb368967596ad90a5) Thanks [@belgattitude](https://github.com/belgattitude)! - Set baseUrl to ./src in tsconfig.json and jest.config.js

### Patch Changes

- [#46](https://github.com/teable-group/teable/pull/46) [`83a7239`](https://github.com/teable-group/teable/commit/83a7239773edd74a8aa93263fb93ffdc16bc2980) Thanks [@belgattitude](https://github.com/belgattitude)! - Remove the need for next-transpile-modules

## 3.0.1

### Patch Changes

- [#41](https://github.com/teable-group/teable/pull/41) [`f12f210`](https://github.com/teable-group/teable/commit/f12f21014caa6a70260711833543479f495b5348) Thanks [@belgattitude](https://github.com/belgattitude)! - Explicit dependencies on packages with workspace:\* protocol

## 3.0.0

### Major Changes

- [#39](https://github.com/teable-group/teable/pull/39) [`9f04b88`](https://github.com/teable-group/teable/commit/9f04b88d966e804ddc12e79372b3ac14f7330b86) Thanks [@belgattitude](https://github.com/belgattitude)! - Rename packages foo and bar into ui-lib and sdk

## 2.0.0

### Major Changes

- [#36](https://github.com/teable-group/teable/pull/36) [`6a93bf3`](https://github.com/teable-group/teable/commit/6a93bf35a0863be6a6811328c38cd7e3fc481a9a) Thanks [@belgattitude](https://github.com/belgattitude)! - Updated to nextjs 10.2 / Webpack 5 / Transpile 7

* [#36](https://github.com/teable-group/teable/pull/36) [`b015465`](https://github.com/teable-group/teable/commit/b015465469ea85e4174ed438ac89381489900ad4) Thanks [@belgattitude](https://github.com/belgattitude)! - Add example using emotion

- [#36](https://github.com/teable-group/teable/pull/36) [`3dd0d6a`](https://github.com/teable-group/teable/commit/3dd0d6a1ff20c49d4ad71907ea243287fbc36890) Thanks [@belgattitude](https://github.com/belgattitude)! - Add husky/lint-staged example

* [#36](https://github.com/teable-group/teable/pull/36) [`31475c5`](https://github.com/teable-group/teable/commit/31475c58ca1ebc155f178240468d0d6a9d323e34) Thanks [@belgattitude](https://github.com/belgattitude)! - Add eslint integration example

### Minor Changes

- [#36](https://github.com/teable-group/teable/pull/36) [`257ac52`](https://github.com/teable-group/teable/commit/257ac52c08fa4cc7b66bb90b028f1cb81453ffc7) Thanks [@belgattitude](https://github.com/belgattitude)! - Support for @next/bundle-analyzer + script bundle:analyze

* [#36](https://github.com/teable-group/teable/pull/36) [`9c84551`](https://github.com/teable-group/teable/commit/9c845516ae04b997e8d34647908d62f7902c006c) Thanks [@belgattitude](https://github.com/belgattitude)! - Example for next-secure-headers

- [#36](https://github.com/teable-group/teable/pull/36) [`f3d3b00`](https://github.com/teable-group/teable/commit/f3d3b00d4b16e94784ac2bd4d3b26a5f5d690430) Thanks [@belgattitude](https://github.com/belgattitude)! - Example with next-seo

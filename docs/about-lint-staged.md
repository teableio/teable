# About lint-staged

[Lint-staged](https://github.com/okonet/lint-staged) and [husky](https://github.com/typicode/husky) are used to automatically
run linters on commit.

## Structure

See [the doc to use lint-staged in a monorepo](https://github.com/okonet/lint-staged#how-to-use-lint-staged-in-a-multi-package-monorepo)
and the [linter docs](./about-linters.md).

```
.
├── apps
│   ├── remix-app
│   │   ├── .eslintrc.js
│   │   └── lint-staged.config.js   (overwrite global lint-staged.config.js, custom eslint)
│   └── nextjs-app
│       ├── .eslintrc.js
│       └── lint-staged.config.js   (overwrite global lint-staged.config.js, custom eslint)
├── packages
│   └── ui-lib
│       ├── .eslintrc.js
│       └── lint-staged.config.js   (overwrite global lint-staged.config.js, custom eslint)
│
├── lint-staged.common.js  (few common utils)
└── lint-staged.config.js  (base config to overwrite per apps/packages)
```

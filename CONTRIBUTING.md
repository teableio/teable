# Contributing

The base branch is **`main`**.

## Workflow

> **Note**
> Please feature/fix/update... into individual PRs (not one changing everything)

- Create a [github fork](https://docs.github.com/en/get-started/quickstart/fork-a-repo).
- On your fork, create a branch make the changes, commit and push.
- Create a pull-request.

## Checklist

If applicable:

- [x] **tests** should be included part of your PR (`pnpm g:test`).

## Local scripts

| Name                         | Description                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm g:typecheck`           | Run typechecks in all workspaces                                                                                                   |
| `pnpm g:test`                | Run unit and e2e tests in all workspaces                                                                                           |
| `pnpm g:lint`                | Display linter issues in all workspaces                                                                                            |
| `pnpm g:lint --fix`          | Attempt to run linter auto-fix in all workspaces                                                                                   |
| `pnpm g:build`               | Run build in all workspaces                                                                                                        |
| `pnpm g:clean`               | Clean builds in all workspaces                                                                                                     |
| `pnpm clean:global-cache`    | Clean tooling caches (eslint, jest...)                                                                                             |
| `pnpm deps:check --dep dev`  | Will print what packages can be upgraded globally (see also [.ncurc.yml](https://github.com/teableio/teable/blob/main/.ncurc.yml)) |
| `pnpm deps:update --dep dev` | Apply possible updates (run `pnpm install && pnpm dedupe` after)                                                                   |
| `pnpm check:install`         | Verify if there's no peer-deps missing in packages                                                                                 |
| `pnpm dedupe`                | Built-in pnpm deduplication of the lock file                                                                                       |

## Git message format

This repo adheres to the [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) convention.

Commit messages are enforced through [commitlint](https://github.com/conventional-changelog/commitlint) and [a husky](https://github.com/typicode/husky) [commit-msg](https://github.com/teableio/teable/blob/main/.husky/commit-msg) hook.

### Activated prefixes

- **chore**: Changes that affect the build system or external dependencies
- **ci**: Changes to our CI configuration files and scripts
- **docs**: Documentation only changes
- **feat**: A new feature
- **fix**: A bug fix
- **perf**: A code change that improves performance
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **lint**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **test**: Adding missing tests or correcting existing tests
- **translation**: Adding missing translations or correcting existing ones
- **revert**: When reverting a commit
- **style**: A change that affects the scss, less, css styles
- **release**: All related to changeset (pre exit...)

> **Note**
> Up-to-date configuration can be found in [commitlint.config.js](https://github.com/teableio/teable/blob/main/commitlint.config.js).

## Structure

```
.
├── apps
│   ├── ...
│   └── nextjs-app
├── packages
│   ├── ...
│   └── core
└ package.json
```

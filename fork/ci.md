# Fork CI

All fork CI runs on GitHub-hosted runners. The fork is public, so those minutes are free.

## What runs when

| Event                        | `ci.yml` (upstream matrix)                 | `fork-ci.yml`                                  |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Pull request into any branch | Runs, from its own `pull_request` trigger  | `fork-checks` only                             |
| Push to `custom`             | Runs, called by `fork-ci.yml` as `full matrix` | `fork-checks` and `full matrix`            |
| Manual (`workflow_dispatch`) | Runs, as `full matrix`                     | `fork-checks` and `full matrix`                |

`fork-checks` runs only `fork/scripts` tests. Format, lint, typecheck and every package suite
belong to `ci.yml`, so do not copy them into `fork-ci.yml`: the pull request would run them twice.

`ci.yml` path-filters through `.github/ci-paths.yml`, so a docs-only pull request skips most of
the matrix.

## The one fork edit in `ci.yml`

`ci.yml`'s push trigger covers `main` only. To reach pushes to `custom`, `fork-ci.yml` calls it
as a reusable workflow, which needs one line in `ci.yml`:

```yaml
on:
  ...
  workflow_call:
```

It is tagged `FORK-LOCAL` in place. If an upstream merge drops it, `fork-ci.yml` fails to resolve
the callee and pushes to `custom` lose their matrix.

Calling `ci.yml` instead of copying it has two consequences:

- `permissions` in the caller is a ceiling. `ci.yml`'s `changes` job asks for
  `pull-requests: read` for `dorny/paths-filter`, so `fork-ci.yml` grants it.
- `full matrix` passes `secrets: inherit`, so it is gated on the repository owner and never runs
  for a pull request. Never add `pull_request_target` to either file: it runs a fork's code with
  a write-scoped token.

The repository setting `fork-pr-contributor-approval` is `all_external_contributors`, so an
outside pull request runs nothing until the owner approves it.

## Billing lock

An account-level billing lock stops all Actions usage, free public-repository minutes included:
every job fails in seconds with "The job was not started because your account is locked due to a
billing issue". That happened on 2026-09-09 (run `34396878560`) and is why a self-hosted runner on
makemake carried fork CI until 2026-11-06. If it happens again, clear it at
<https://github.com/settings/billing>; publishing (`fork-npm-publish.yml`) stops too.

The makemake runner (`actions.runner.camerontaylor-paseo.makemake`, labels `self-hosted`,
`paseo-makemake`) is no longer used by any workflow. Remove it from the repository's runner
settings and stop its service on makemake.

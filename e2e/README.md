# e2e — outside-in scenarios for this surface

End-user scenarios that drive the running app from the outside, on localhost, with
synthetic data. Run them with the shared skill `outside-in-e2e-testing`.

## Start, seed, sign in (fill these in; never guess them)

| Step | Command | Address |
|---|---|---|
| Start the app locally | PENDING | PENDING |
| Seed synthetic data | PENDING | |
| Development-only sign-in | PENDING | |

## Run

```
npm ci                               # once; installs the pinned test runner from package-lock.json
npx playwright install webkit        # once per machine; ask before installing
npx playwright test --grep "@story-<n>"      # scoped
npx playwright test                           # full suite
```

## Conventions

- One scenario per acceptance criterion, in `tests/<journey>/<key>-<name>.spec.ts`.
- Tags on every scenario: `@journey-<name>`, `@surface-app` or `@surface-api`,
  and `@story-<n>` or `@bug-<n>`.
- Elements are found by `data-testid` only. Waits are assertions, never fixed sleeps.
- No `.only`, `.skip` or `.fixme`. A scenario is never weakened, skipped or deleted to
  get a pass.

## Journeys and their tags

| Journey | Tag | Covers |
|---|---|---|
| PENDING | | |

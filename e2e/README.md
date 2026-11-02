# e2e — outside-in scenarios for this surface

End-user scenarios that drive the running app from the outside, on localhost, with
synthetic data. Run them with the shared skill `outside-in-e2e-testing`.

## Start, seed, sign in (fill these in; never guess them)

Filled by the environment bootstrap story (priitkustala/ai-news#40) with the real commands and ports (LOCKED specification, section Local test environment, SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890). "Box" is the backend dev container at the repository root; the stack is started on the host (the box has no container engine). The full table is in `../AGENTS.md`, Build, Test, Run.

| Step | Command | Address |
|---|---|---|
| Start the app locally | host: `docker compose -p ai-news-backend_devcontainer -f .devcontainer/docker-compose.yml -f .devcontainer/docker-compose.override.yml up -d --wait ai-news-db ai-news-auth ai-news-rest ai-news-api ai-news-feeds ai-news-commands`; then box: `node dist/cli.js migrate` | `http://ai-news-api:8000` (Data API `/rest/v1`, Supabase Auth `/auth/v1`); fixture feeds `http://ai-news-feeds:8081`; PostgreSQL `ai-news-db:5432` on the compose network only |
| Seed synthetic data | box: `node dist/cli.js seed <fixture-set> <run-marker>` | |
| Development-only sign-in | box: `node dist/cli.js sign-in owner` (or `second-user`); prints `{"access_token": ...}` | |

## Variables the scenarios read

`node dist/cli.js keys` (run once in the backend box, from the repository root) writes them into the
git-ignored `.env.local` at the repository root; `e2e/playwright.config.ts` loads that file, and a
value already set in the environment wins (priitkustala/ai-news#40).

| Name | Value |
|---|---|
| `E2E_DATA_URL` | `http://ai-news-api:8000/rest/v1` (the local Supabase interface's Data API, through the gateway) |
| `E2E_PUBLISHABLE_KEY` | the local publishable key: the value `node dist/cli.js keys` wrote into `.env.local` (never the hosted project's, never committed) |
| `E2E_BACKEND_COMMAND` | `node /workspaces/ai-news-backend/dist/cli.js` (built by `npm run build`) |
| `E2E_FIXTURE_FEED_URL` | `http://ai-news-feeds:8081/feeds/techcrunch-ai.xml` (the fixture feed server) |
| `E2E_OD08` | `undecided` (OD-08 is open) |
| `E2E_RUN_TIME_ZONE` | `UTC` (a test variable; OD-09 stays open) |

## Run

```
npm ci                               # once; installs the pinned test runner from package-lock.json
npx playwright install webkit        # once per machine; ask before installing
npx playwright test --grep "@story-<n>"      # scoped
npx playwright test                           # full suite
```

## Conventions

- One scenario per runnable observation row of the sprint 02 coverage matrix, in
  `tests/<journey>/<key>-<ac>-<suffix>-<short-name>.spec.ts` (rule and examples in
  `tests/README-testids.md`, section File names).
- Tags on every scenario: `@journey-<name>`, exactly one surface tag (`@surface-app`,
  `@surface-job` or `@surface-data`; `@surface-api` is kept for the scaffold's
  predicate), and `@story-<n>` or `@bug-<n>`. `@surface-app` runs in the `iphone`
  project; `@surface-job` and `@surface-data` run in the `api` project, without a browser.
- The variables the helpers in `support/` read (`E2E_BACKEND_COMMAND`, `E2E_DATA_URL`,
  `E2E_PUBLISHABLE_KEY`, `E2E_RUN_TIME_ZONE` and the others) are listed in
  `tests/README-testids.md`; #40 writes their values here.
- Elements are found by `data-testid` only. Waits are assertions, never fixed sleeps.
- No `.only`, `.skip` or `.fixme`. A scenario is never weakened, skipped or deleted to
  get a pass.

## Journeys and their tags

| Journey | Tag | Covers |
|---|---|---|
| access | `@journey-access` | Every read and write of the exposed schema needs the owner's sign-in; no secret leaves its store. Rows here: AC-20a, AC-20b, AC-20c, AC-20d. |
| bookmark | `@journey-bookmark` | The owner bookmarks and unbookmarks items and hears the status change. Rows here: AC-15c, AC-15d. |
| bootstrap | `@journey-bootstrap` | The local environment starts with seeded synthetic data (the #40 bootstrap checks). Rows here: 40a, 40b, 40c, 40d, 40e, 40g. |
| filter-category | `@journey-filter-category` | The owner reads the category list with counts and narrows the feed to one category. Rows here: AC-06. |
| ingest | `@journey-ingest` | A daily ingestion run collects, processes, stores and retains items through the job command. Rows here: AC-01a, AC-01b, AC-01c, AC-02a, AC-02b, AC-03c, AC-03d, AC-03e, AC-04, AC-05, AC-07a, AC-07b, AC-22a, AC-22b, AC-22c, AC-26c, AC-27a, AC-27c, AC-28c, AC-28d. |
| measure | `@journey-measure` | The feed-quality measurement script runs on the frozen validation sample and reports each metric. Rows here: AC-25. |
| read-feed | `@journey-read-feed` | The owner opens and reads the headline feed and its states (last-updated, Stale, Error). Rows here: AC-08, AC-21a. |

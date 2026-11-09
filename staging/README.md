# Staging: the real ingestion of the committed source list

`staging/docker-compose.yml` is the compose project `ai-news-staging` (priitkustala/ai-news-backend#36). It runs the
backend's stack (database, auth, REST and the API gateway, copied from the local test environment) and one job
container, `staging-job`, which fetches the real feeds of `config/sources.json` into the project's own database.

## Open network for the job container only

`staging-job` is on two networks: `staging` (internal, shared with the stack) and `default` (compose's own bridge,
not internal). It is the only container that reaches the internet, because fetching the real feeds is its work. The
stack services are on `staging` only, as in the local test environment.

## No agent node runs here

The owner's decision of 2026-11-08: the staging environment has open network, so no agent node ever runs in it. The
file makes that so:

- the job container is the plain Node 22 image, pinned by digest, with no agent CLI installed;
- no agent configuration volume and no sign-in path is mounted anywhere;
- no service publishes a port;
- commands reach the project only by `docker compose exec` from the host.

## Keys

The keys live in the memory volume `stack-secrets` only, never on a disk. The volume empties when the project's
last container stops, so they are written again at every start (`node dist/cli.js keys` in the job).

## Order of the commands

From the backend folder on the host; `<s>` stands for `docker compose -f staging/docker-compose.yml`.

1. Create the two git-ignored folders `dist` and `node_modules` if absent (the job mounts its own memory on them).
2. `<s> up -d staging-job`
3. `<s> exec staging-job npm ci --ignore-scripts`, then `<s> exec staging-job npm run build`
4. `<s> exec staging-job node dist/cli.js keys`
5. `<s> up -d --wait`: the stack's first start, on those keys, so no separate first-start step is needed.
6. `<s> exec staging-job node dist/cli.js migrate`
7. `<s> exec staging-job node dist/cli.js seed-sources config/sources.json`
8. `<s> exec staging-job node dist/cli.js ingest <YYYY-MM-DD>` (the date of the run)

`<s> down -v` removes the project, its database and its keys.

The script that runs these for the owner is SI-41 (priitkustala/ai-news#110).

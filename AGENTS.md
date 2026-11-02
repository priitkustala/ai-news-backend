# ai-news backend

Canonical rule file of this repository. `CLAUDE.md` only imports it. Read it before any
work here. Changes to this file are reviewed in a pull request like code.

## What This Repository Is

The backend services of ai-news: they collect AI-specific news, process it and serve it to the iPhone app. Microservices architecture (owner decision, 2026-10-02). The iPhone app is not in this repository; it lives in `ai-news-frontend`.

- Language/runtime: TypeScript on Node 22 (OD-03), compiled by tsc 7.0.2
- Frameworks: none; pg 8.23.1 for PostgreSQL
- Deployment: the ingest command runs as a GitHub Actions scheduled workflow of this repository against Supabase (OD-01 B), built at Release and run; nothing is deployed by #40
- Owning team: ai-news; team context: `ai-news-team-context`

## Build, Test, Run

Filled by the environment bootstrap story (priitkustala/ai-news#40). "Box" is this
repository's dev container, from the repository root; "host" is Git Bash in this folder on
the host, because the box has no container engine. `<compose>` stands for
`docker compose -p ai-news-backend_devcontainer -f .devcontainer/docker-compose.yml -f .devcontainer/docker-compose.override.yml`.

| Task | Where | Command |
|---|---|---|
| Install | box | `npm ci --ignore-scripts` and `cd e2e && npm ci` |
| Build and type check | box | `npm run build` |
| Local keys, once | box | `node dist/cli.js keys` (writes the git-ignored `.env.local` and `.env.stack-*`; never overwrites) |
| Start the stack (priitkustala/ai-news#40) | host, Git Bash, this folder (or start the box with `sandbox`, which starts the services with the workload) | `docker compose -p ai-news-backend_devcontainer -f .devcontainer/docker-compose.yml -f .devcontainer/docker-compose.override.yml up -d --wait ai-news-db ai-news-auth ai-news-rest ai-news-api ai-news-feeds ai-news-commands` |
| Migrate, create the personas and load the base seed | box | `node dist/cli.js migrate` (safe to run again) |
| Stack state | host | `<compose> ps` |
| Stop | host | `<compose> stop` |
| Reset the database | host, then box | `<compose> rm -s -f -v ai-news-db` and `docker volume rm ai-news-backend_devcontainer_ai-news-db-data`, then the start command and `node dist/cli.js migrate` |
| Seed a fixture set | box | `node dist/cli.js seed <fixture-set> <run-marker>` |
| Development sign-in | box | `node dist/cli.js sign-in owner` (or `second-user`) |
| Run the job | box | `node dist/cli.js ingest <YYYY-MM-DD> [--dry-run]` |
| Scoped scenarios | box | `cd e2e && npx playwright test --project=api --grep "@story-40"` |
| One scenario | box | `cd e2e && npx playwright test --project=api tests/bootstrap/40-40-a-gateway-answers.spec.ts` |
| Unit and integration tests | - | none yet: no unit-tested module exists; the first feature story adds the runner as an approved dependency |
| Lint and format | - | none approved yet; the type check is `npm run build` (strict) |

## Protected Areas

- `AGENTS.md`, `CLAUDE.md`, `.github/`, `CODEOWNERS`: change only in a pull request
  whose purpose is that change; the owner reviews it.
- CI configuration, dependency lockfiles and anything holding configuration of
  secrets: stop and ask before changing.
- Secrets, tokens and keys never enter this repository, a prompt or memory.

## Local Conventions

- One story per session. Work starts from an approved story (issue) and a task brief
  (`docs/task-brief.md`).
- A bug or side issue found on the way is staged as a separate proposed item for the
  owner; the story in hand is not widened.
- Branch per story; changes reach `main` only through a pull request the owner
  reviews and merges. No agent merges, releases or deploys.
- Every pull request fills `.github/PULL_REQUEST_TEMPLATE.md`, and carries the label
  `ai-assisted` when any part was produced by an agent.
- Tests use seeded test data only, never real personal data.

## How to Verify: Done When

- `npm run build` exits 0.
- The scoped scenarios of the story pass, and the scoped regression
  `--grep "@journey-<journey>"` of each touched journey shows no other change.
- The diagnostic or before-build evidence the regression contract requires is attached
  to the pull request.

## Starting a Session Here

This repository is part of the ai-news project and is meant to be checked out inside
the project folder, next to `ai-news-team-context/`.

1. Read this file.
2. Read the team's front door, `../ai-news-team-context/AGENTS.md`, and load the
   shared context: from the project folder run `python scripts/session-context.py --text`
   (handoff, operating contract, notes).
3. Inside the dev container only this repository is mounted writable. The team
   context is mounted read-only at `/workspaces/ai-news-team-context` and the
   testing skill at `/workspaces/.skills/outside-in-e2e-testing`; read the front
   door and `rules/regression-contract.md` from there.
4. If the team context cannot be read at all (a clone on its own), stop and say
   so. Do not start work that the missing rules govern.

## Quality Assurance

- The team's testing rules: `../ai-news-team-context/rules/regression-contract.md`.
- Outside-in scenarios live in `e2e/` and cover the backend's published interface (`@surface-api`, project `api`). Run them with the
  shared skill `outside-in-e2e-testing` (preflight, start on localhost, tagged run,
  report by journey).
- Scenarios are written from a story's acceptance criteria before implementation and
  must first fail on their assertion.
- How to start, seed and sign in locally: `e2e/README.md`, section Start, seed, sign in.

## Autonomous Runs: the Sandbox

- Unattended or auto-accept work runs only inside this repository's dev container:
  run `sandbox` from this folder in Git Bash. On the host, commands and file changes
  are reviewed before they run.
- `.devcontainer/` belongs to this repository. The egress allowlist is the
  `x-extra-allowed-domains` anchor in `.devcontainer/docker-compose.yml` and changes
  only through a reviewed diff. Additions so far: `auth.openai.com`, `chatgpt.com`, `api.openai.com` (the second-vendor agent).
- Inside the box, use git there and not on the host checkout. No production
  credentials enter the box.
- Identities: attended sessions may use the owner's own sign-in. Unattended runs
  need scoped tokens and `AGENT_REQUIRE_AUTH=1`, so the boot check refuses a bad
  credential; which tokens, and whether the owner's personal identity is ever
  acceptable unattended, is an open owner decision (the template's boot check only
  warns about a personal identity).
- `sandbox` starts Claude Code in the box. Starting the Codex generator in the box
  is not yet validated; see the workspace's `runs/ai-news-app/harness.md`, section 7.

## Where the Rest Lives

- Team domain, decisions, specifications and memory: `ai-news-team-context` (bound by
  `.memspec.yaml` in this repository).
- The operating contract, the lifecycle and the roles: the ai-news workspace's
  contract record in that store.
- The standard this repository follows: the Agentic SDLC guidance kept in the ai-news
  workspace under `inputs/agentic-sdlc-guidance/` (not redistributed here).

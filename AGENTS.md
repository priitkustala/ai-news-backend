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
| Local keys, once | box | `node dist/cli.js keys` (writes `local.env` and the stack's files into the memory folder `AI_NEWS_SECRETS_DIR`, `/run/ai-news-secrets`, the tmpfs volume `stack-secrets`, never on the host disk; never overwrites; refuses when the variable is unset). The volume empties when the project's last container stops: then keys, step 7 (the first-start row below) and migrate |
| Start the stack (priitkustala/ai-news#40) | host, Git Bash, this folder (or start the box with `sandbox`, which starts the services with the workload) | `docker compose -p ai-news-backend_devcontainer -f .devcontainer/docker-compose.yml -f .devcontainer/docker-compose.override.yml up -d --wait ai-news-db ai-news-auth ai-news-rest ai-news-api ai-news-feeds ai-news-commands` |
| Migrate, create the personas and load the base seed | box | `node dist/cli.js migrate` (safe to run again) |
| Stack state | host | `<compose> ps` |
| Stop | host | `<compose> stop` |
| Reset the database | host, then box | `<compose> rm -s -f -v ai-news-db` and `docker volume rm ai-news-backend_devcontainer_ai-news-db-data`, then the start command and `node dist/cli.js migrate` |
| Seed a fixture set | box | `node dist/cli.js seed <fixture-set> <run-marker>` |
| Development sign-in | box | `node dist/cli.js sign-in owner` (or `second-user`) |
| Run the job | box | `node dist/cli.js ingest <YYYY-MM-DD> [--dry-run]` |
| Measure feed quality (priitkustala/ai-news-backend#4) | box | `node dist/cli.js measure` (runs the pipeline on the frozen sample and labels under `fixtures/validation-sample/` and the hostile fixtures under `fixtures/validation/`; prints the measurement report, values only, no verdict while OD-26 is open) |
| Scoped scenarios | box | `cd e2e && npx playwright test --project=api --grep "@story-40"` |
| One scenario | box | `cd e2e && npx playwright test --project=api tests/bootstrap/40-40-a-gateway-answers.spec.ts` |
| Unit and integration tests | - | none yet: no unit-tested module exists; the first feature story adds the runner as an approved dependency |
| Lint and format | - | none approved yet; the type check is `npm run build` (strict) |

### A story's own instance (priitkustala/ai-news#65)

The rows above are for the repository folder `ai-news-backend` and stay as they are. A story
can instead work in its own instance: a separate clone `ai-news-backend-<key>` next to it in
the project folder (`<key>` is the story key in lower case, `s-03`, or a task's issue number,
`65`), with its own branch, box, stack, database and pair network `<folder>-local`, so stories
build and test in parallel without sharing a database. `<folder>` is `ai-news-backend-<key>`;
`<icompose>` stands for, from that folder on the host,
`AI_NEWS_NETWORK=<folder>-local AI_NEWS_CLAUDE_VOLUME=instance-claude-config AI_NEWS_CODEX_VOLUME=instance-codex-config docker compose -p <folder>_devcontainer -f .devcontainer/docker-compose.yml -f .devcontainer/docker-compose.override.yml`.
`AI_NEWS_FRONTEND` names the paired frontend working copy that `ai-news-commands` mounts
read-only at `/workspaces/<copy>` for the `scan-secrets` relay (unset: the `ai-news-frontend`
folder); the host instance scripts set these variables.
`<icompose> config` prints no keys on a copy of this form, since they stand in the memory volume;
never run it on an older copy whose override still has `env_file` lines: it prints the local keys there.
A frontend instance pairs with one backend instance (see `ai-news-frontend`'s `AGENTS.md`).

| Task | Where | Command |
|---|---|---|
| Create | host, Git Bash, the project folder | `git clone --no-hardlinks --no-checkout --branch main ai-news-backend <folder>`, then in `<folder>`: `git fetch --no-tags ../ai-news-backend "+refs/remotes/origin/main:refs/remotes/origin/main"`, `git remote set-url origin https://github.com/priitkustala/ai-news-backend.git`, `git reset --hard refs/remotes/origin/main` (GitHub main as the checkout knows it; no git network command) |
| Start the box and its stack | host, `<folder>` | `AI_NEWS_NETWORK=<folder>-local AI_NEWS_CLAUDE_VOLUME=instance-claude-config AI_NEWS_CODEX_VOLUME=instance-codex-config sandbox` (the box mounts the instance's own Claude and Codex configuration volumes `<folder>_devcontainer_instance-claude-config` and `<folder>_devcontainer_instance-codex-config`, priitkustala/ai-news#69) |
| Branch | box | `git fetch origin --prune`, `git switch -c <issue>-<slug> --no-track origin/main` |
| Install and build | box | as above |
| Local keys, first start | box | `node dist/cli.js keys`; done at `keys: wrote local.env, stack-db.env, stack-auth.env, rest-db-uri, rest-jwt-secret, stack-api.env` |
| First start: the stack on the new keys | host, `<folder>` | `<icompose> rm -s -f -v ai-news-db`, `docker volume rm <folder>_devcontainer_ai-news-db-data`, `<icompose> up -d --wait --force-recreate ai-news-db ai-news-auth ai-news-rest ai-news-api ai-news-feeds ai-news-commands` |
| Migrate, seed, sign-in, scenarios | box | as above: `node dist/cli.js migrate`, `node dist/cli.js seed <fixture-set> <run-marker>`, `node dist/cli.js sign-in owner`, `cd e2e && npx playwright test --project=api --grep "@story-<n>"` |
| Start the stack again | host, `<folder>` | `<icompose> up -d --wait ai-news-db ai-news-auth ai-news-rest ai-news-api ai-news-feeds ai-news-commands` |
| Stack state | host, `<folder>` | `<icompose> ps` |
| Stop | host, `<folder>` | `<icompose> stop` |
| Remove, after the owner merged the instance's pull request | box, then host | box: `git status --porcelain` prints nothing, and `git rev-parse HEAD` equals the `headRefOid` of `gh pr list --repo priitkustala/ai-news-backend --head <branch> --state merged --json headRefOid`; otherwise stop. Remove a paired frontend instance first. Host, `<folder>`: `<icompose> down -v` (the instance's containers, networks, database volume and its two configuration volumes `<folder>_devcontainer_instance-claude-config` and `<folder>_devcontainer_instance-codex-config` go; the external `agent-*` volumes stay), then from the project folder `rm -rf <folder>` |

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
- Repository work, from the branch through commits, push, pull request, review and
  the steps after the merge, follows the project skill `github-flow` in the team
  context store (`.agents/skills/github-flow`); Claude Code loads it with the Skill
  tool, Codex CLI reads its `SKILL.md`.
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
   context is mounted read-only at `/workspaces/ai-news-team-context`, with the
   testing skill at `/workspaces/ai-news-team-context/.agents/skills/outside-in-e2e-testing`;
   read the front door and `rules/regression-contract.md` from there.
   The `github-flow` skill is read inside the box at
   `/workspaces/ai-news-team-context/.agents/skills/github-flow/SKILL.md`.
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
- orchestrators run box agents of any agent CLI by the team skill run-agents-in-dev-container.
- a box agent of Codex CLI runs with the launcher's parameter AI_NEWS_BOX_CLI=codex and is evaluated by Claude Code.
- `.devcontainer/` belongs to this repository. The egress allowlist is the
  `x-extra-allowed-domains` anchor in `.devcontainer/docker-compose.yml` and changes
  only through a reviewed diff. Additions so far: `auth.openai.com`, `chatgpt.com`, `api.openai.com` (the second-vendor agent).
- Box policy (priitkustala/ai-news#69): `.devcontainer/managed-settings.json` is mounted
  read-only at `/etc/claude-code/managed-settings.json` in every box built from this
  repository (the override file), at the highest settings precedence. It sets
  `permissions.defaultMode` `bypassPermissions`: every Claude Code session in the box,
  attended sessions in this folder's box included, starts with permissions skipped, and
  the container is the boundary. Its deny rules (`Task`, `Agent`, `Workflow`,
  `Bash(claude -p *)`, `Bash(claude --print *)`, `Bash(codex exec *)`) still apply in that
  mode, so no session in the box starts a subagent, a workflow or a nested agent run;
  `includeCoAuthoredBy` is `false`. The workload sets
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The file binds Claude Code sessions only.
  If an attended session shows Claude Code's one-time confirmation of the mode, the owner
  accepts it once per configuration volume (it is recorded in that volume); a
  non-interactive run shows none.
- Claude Code is pinned to 2.1.287: the last step of `postCreateCommand` in
  `.devcontainer/devcontainer.json` installs `@anthropic-ai/claude-code@2.1.287` as the box
  user (the feature alone installs the newest release at every build). The version
  changes only by a reviewed diff of that line; the workspace launcher refuses to start a
  box agent when `claude --version` in the box differs from the pin.
- `sandbox sync` replaces the `.devcontainer` folder and keeps only `.env`,
  `TEMPLATE_VARIANT` and `docker-compose.override.yml`: its reviewed diff must restore
  `managed-settings.json` and the pin step of `devcontainer.json`.
- A story instance's box keeps its Claude and Codex state in two volumes of its own
  (`<folder>_devcontainer_instance-claude-config` and `_instance-codex-config`, removed
  with the instance), so it starts with no Codex sign-in; this folder's box keeps the
  shared `agent-claude-config` and `agent-codex-config`.
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

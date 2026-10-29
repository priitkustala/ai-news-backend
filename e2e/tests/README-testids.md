# Test identifiers and named outputs, ai-news-backend e2e (D-M rounds 1 to 3, #37)

Written 2026-10-28 by the D-M generator (Opus, claude-opus-5-5) for sprint 02 of ai-news-app. Source of truth: the LOCKED specification, SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890 (in the product-management workspace). Every scenario here is `@surface-job` or `@surface-data` and runs in the Playwright project `api` (no browser).

## data-testid names

None. The scenarios of this repository use no screen, so they use no `data-testid`; what they read is the named output of the job and of the data interface below.

## File names (sprint-02.md section 2.4)

Every scenario file is `tests/<journey>/<key>-<ac>-<suffix>-<short-name>.spec.ts`: `<journey>` is the row's journey tag without `@journey-`; `<key>` is the owning story's staged key (`S-<nn>`, or `40` for a bootstrap row); `<ac>` is the row's criterion (`AC-<nn>`, or `40` for a bootstrap row); `<suffix>` is the row's observation exactly as `coverage.md` writes it. A row whose observation is written `-` keeps that character as its suffix, so its file name carries three hyphens in a row, for example `tests/ingest/S-03-AC-04---keyword-relevance.spec.ts`; the rule is applied the same way in both repositories, in `coverage.md` and by `check_scenarios.py`. Each scenario's title starts with its row id (`AC-01a`, `AC-04`, `40a`), and its tags are exactly `@journey-<name>`, its one surface tag and `@story-<key>`. After the owner's approval the orchestrator replaces each staged key `S-<nn>` by its issue number (sprint-02.md section 5.2 step 4, `check_scenarios.py --remap`); `40` stays.

## Variables the scenarios read (written by #40, never guessed)

The helpers under `support/` read these from the environment and fail with an error that names the variable when it is unset. The environment bootstrap story (#40) writes each value into `e2e/README.md` (Start, seed, sign in).

| Variable | What it is | Read by |
|---|---|---|
| `E2E_BACKEND_COMMAND` | The command line that starts ai-news-backend's command-line entry (its subcommands are listed under Named commands and outputs) | `support/backend.ts` |
| `E2E_DATA_URL` | The Data API address of the local Supabase interface (Locked, Local test environment, row Data interface) | `support/data.ts` |
| `E2E_PUBLISHABLE_KEY` | The local publishable key of that interface, generated for the local stack, never the hosted project's | `support/data.ts` |
| `E2E_RUN_TIME_ZONE` | The run time zone that decides today's run date (OD-09, OPEN) | `support/env.ts` |
| `E2E_OD08` | The OD-08 state of the stack under test (`undecided`, `briefing`, `push` or `both`); it decides the declared exposed schema of `support/access.ts` (Locked, Interface between job and client: `briefings` and `push_subscriptions` only as OD-08 decides). #40 writes `undecided`; the Brief that takes OD-08 changes it | `support/access.ts` (AC-20a, AC-20b, AC-20c) |
| `E2E_FIXTURE_FEED_URL` | The address of one canned feed on the fixture feed server (Locked proposes port 8081; #40 fixes it); its host is the configured feed host of the local environment | 40b, AC-03e |
| `E2E_BASE_URL` | Unused by these scenarios (the `api` project calls the data interface by `E2E_DATA_URL`); kept from the scaffold | - |

## Named commands and outputs (the job and the data interface)

These are the outputs the `@surface-job` and `@surface-data` scenarios read, and the interface `@surface-app` scenarios use for their Given. Locked names the `ingest` command with a run date and `--dry-run`, the seed, the development sign-in, the measurement script and the repository scan (sections Architecture, Local test environment, Acceptance criteria AC-20 and AC-25); it does not name their exact spelling or output, so the spelling below is the one the scenarios expect, for the story named in the last column to provide (skill `outside-in-e2e-testing`: name the identifier the scenario expects so the implementation adds it). Each output is one JSON object on the last line of standard output. The job logs counts, source ids, source types and hosts only, never item text and never a community name (Locked R-21, OD-43).

| Subcommand of `E2E_BACKEND_COMMAND` | Output (last line of standard output) | Rows that read it | Provided by |
|---|---|---|---|
| `ingest <run-date>` and `ingest <run-date> --dry-run` | Run report: `run_id`, `run_date`, `status` (`running`, `completed`, `partial`, `failed`, `abandoned`, Locked Data model), `dry_run`, `fetched_count`, `processed_count`, `item_count`, `source_errors` (list of `source_id`, `error`), `rejected` (list of `source_id`, `reason`), `requests` (list of `source_id`, `source_type`, `host`) | 40e (exit status only); AC-01, AC-02, AC-03c to e, AC-21, AC-22, AC-26c, AC-27, AC-28; app rows use it for their Given | the command shell: #40; the run report: S-02 (AC-01a reports the run id) |
| `seed <fixture-set> <run-marker>` | Fixture manifest: a JSON object that echoes `fixture_set` and `run` and carries the fields a row names below; exit 0 once the fixture set is loaded. The set is a complete Given: the seed resets the run records, the source configuration and the stored items to the base seed plus that set (Isolation, below) | every feature row; 40g | #40 (the seed of Locked, Local test environment) |
| `sign-in <persona>` (`owner`, `second-user`) | `access_token` of the seeded persona's session (development sign-in; method OD-21) | 40c, 40g, AC-01, AC-15c, AC-15d, AC-20, AC-21, AC-14a, AC-21b | #40 |
| `measure` | Measurement report: `relevance_precision`, `relevance_recall`, `category_accuracy`, `other_share`, `duplicate_precision`, `duplicate_recall`, `top_n_must_read_share`, `top_n_skip_share` (each a share from 0 to 1, or `{"value": null, "unavailable_reason": "..."}` where the sample cannot give it), `category_accuracy_per_category` (one such value per category: `releases`, `research`, `policy`, `business`, `other`), `summary_presence_per_source` (one such value per source of the sample) (the metrics of W4 section 8 for the deterministic pipeline, Locked Problem and outcome; summary fidelity applies only to a model step, which OD-19 excludes), and `fixtures` (one record per fixture of the set: `fixture_id`, `schema_valid`, `labels_from_fixed_lists`); values only, no verdict until OD-26 | AC-25 | S-06 |
| `scan-secrets <path>...` | Scan report: `scanned` (list of `path`, `files`), `secret_matches` (count of strings matching the seeded database password, secret key or Reddit secret), `client_keys` (key kinds found in a built client, for example `publishable`) | AC-20d, AC-20e | S-05 |

Relations of the exposed schema that the scenarios read through the Data API (Locked, Architecture, Interface between job and client; column names from Locked Data model where it names them):

| Relation | Columns read | Rows that read it |
|---|---|---|
| `feed` (view) | `id`, `title`, `source_id`, `source_type`, `canonical_url`, `published_at` | AC-02, AC-04, AC-07, AC-08, AC-26c, AC-27a, AC-28d; AC-20 (every column of an owner row, to build a relation-valid insert) |
| `categories` (view) | `id` (`releases`, `research`, `policy`, `business`, `other`), `name`, `item_count`, `other_share`, `over_threshold` (the last two from S-03's migration) | AC-05, AC-06; AC-20 |
| `items` | `id`, `title`, `category`, `relevance_method`, `source_id`, `summary`, `canonical_url` | 40c, 40d, 40g, AC-01, AC-03c, AC-03d, AC-04, AC-05, AC-15c, AC-15d, AC-22, AC-28c; AC-20 |
| `ingestion_runs` | `run_date`, `status` (read whole, or filtered `run_date=eq.<date>`) | 40g, AC-01, AC-21a, AC-21b; AC-20 |
| `bookmarks` | `item_id`, `title`, `link`, `summary`; written by the owner with an insert (status 201) and read back filtered `item_id=eq.<id>` | AC-15c, AC-15d, AC-22c; AC-20 (declared from #40) |
| `push_subscriptions` | row count; `id`, `endpoint`, `keys` for the owner's row of AC-20 | AC-14a; AC-20 when `E2E_OD08` is `push` or `both` |
| `briefings` | `run_date` | AC-20 when `E2E_OD08` is `briefing` or `both` |

Request headers `apikey`, `Authorization: Bearer <session>` and `Prefer: return=representation`, row filters `<column>=eq.<value>`, and the answers the scenarios tell apart (200 with a JSON list for a read; 201 for an insert; 401 or 403 for an authorization refusal; 2xx with an empty list for an update or delete that row-level security filtered to no row; 400 for a malformed payload; 404 for a relation outside the exposed schema; 405 for a write to a read-only view) follow Supabase's Data API (PostgREST) convention: UNVERIFIED; check: 40c and 40d pass against the stack #40 builds, and the PostgREST pages on errors, preferences and row filters are read at #40's Brief. A 200 answer whose body is not a list of rows is malformed, never an empty read (`support/data.ts`).

Reads as evidence (round 20 R20-3): a scenario takes the rows of a read only through `support/data.ts` `expectRows`, which requires status 200 and a well-formed JSON list of row objects before any absence, equality or count is taken from it; a 200 answer whose body is `{}`, not JSON, or a list of non-objects is `malformed` and fails there, never reads as an empty relation. A refusal is judged by `isRefusedOrEmpty` (401, 403, or a well-formed empty list; AC-15d, 40d, AC-20a, AC-20b) and never through `expectRows`. In the run report, each `source_errors` entry's `error` and each `rejected` entry's `reason` is a present, non-blank string (AC-02a, AC-03d; round 20 R20-4); a record carrying only `source_id` fails.

## Isolation (round 19 F6)

Each fixture set is a complete Given. `seed <set> <run>` resets the run records (`ingestion_runs`), the source configuration and the stored items of the local database to the base seed plus that set, and its manifest echoes `fixture_set` and `run`; `support/job.ts` fails a scenario whose manifest does not. A scenario therefore sees its own set whatever ran before it, and checks the run-date state its Given needs by a readback before its When (AC-01a, AC-01b, AC-21a). Because a seed resets shared state, two scenarios must never seed at the same time: the scenarios run one at a time, by the configuration proposal staged in `e2e/pull-requests.md` (Configuration proposal: one worker), which is not applied by this draft. Under one worker no scenario can reset another's run records or source configuration while it runs.

## Fixture sets the seed loads (one per feature row; #40 provides every set)

The seed takes the row id as the fixture set and the run marker, so that created names are unique to the run (regression contract, Scenario rules 4). #40 provides every set so that each feature scenario fails on its assertion, not in set-up (S-01, Done when; regression contract, Test integrity 1). Bookmark rows are written by the scenarios through the data interface with the owner's session (the write the client makes) and read back, not by the seed.

| Fixture set (`seed` argument) | Row | What it loads (the row's Given; `<run>` is the run marker the scenario passes) | Manifest fields |
|---|---|---|---|
| `40g` | 40g | the base seed only (no feature set) | source_ids, item_ids, stale_run_date |
| `AC-01a` | AC-01a | the seeded fixture feeds and no run for today's run date (the run records reset; checked by a readback) | - |
| `AC-01b` | AC-01b | today's run date has a run that did not complete (the fixture set records it; checked by a readback) | - |
| `AC-01c` | AC-01c | the seeded local database and the --dry-run flag | - |
| `AC-02a` | AC-02a | one fixture feed answers HTTP 500 and one returns invalid XML among the seeded feeds; a feed that succeeds, its item titles carrying <run> | failing_sources (list of source_id and failure, `http-500` or `invalid-xml`), ok_source_id |
| `AC-02b` | AC-02b | items stored before and every fixture feed failing | - |
| `AC-03c` | AC-03c | a fixture feed with a DTD whose external entity resolves to the text xxe-<run> | - |
| `AC-03d` | AC-03d | a fixture feed with an item over the size limit, titled oversized-<run> | oversized_source_id |
| `AC-03e` | AC-03e | a fixture item linking to a host that is not in the configured feed list | - |
| `AC-04` | AC-04 | a general fixture source with one AI-keyword item (<run>-ai) and one non-AI item (<run>-general) | - |
| `AC-05` | AC-05 | fixture items that match each category's rules and one (<run>-unmatched) that matches none | - |
| `AC-06` | AC-06 | a seeded window in which Other holds 4 of 10 representative items (OD-15 sets the window and the denominator; the fixture set follows the decided rule) | - |
| `AC-07a` | AC-07a | two fixture items (<run>-same-url) whose addresses differ only in utm_* parameters | - |
| `AC-07b` | AC-07b | two items from different sources within 48 hours whose titles (<run>-near-title) are near-identical after normalisation | - |
| `AC-08` | AC-08 | more arXiv items for one day than the configured daily cap, as a fixture arXiv feed a run processes (the job applies the cap); the fixture manifest names the arXiv source, the day, the configured cap and the seeded count | arxiv_daily_cap, arxiv_day, arxiv_seeded_for_day, arxiv_source_id |
| `AC-15c` | AC-15c | a seeded item (<run>-a in its title) that no one has bookmarked; the scenario bookmarks it with the write the client makes (an insert into bookmarks under the owner's session) and reads it back | - |
| `AC-15d` | AC-15d | a seeded item (<run>-a in its title); the scenario bookmarks it with the write the client makes, under the owner's session, and reads it back | - |
| `AC-20a` | AC-20a | two seeded items (<run>-a, <run>-b in their titles) and rows in every declared relation; the owner's session observes the effect | - |
| `AC-20b` | AC-20b | two seeded items (<run>-a, <run>-b in their titles) and rows in every declared relation; the second synthetic user's session; the owner's session observes the effect | - |
| `AC-20c` | AC-20c | a seeded item (<run>-a in its title) and rows in every job-written declared relation; the seeded test owner signed in | - |
| `AC-20d` | AC-20d | the ai-news-backend repository and a captured log of a local job run | - |
| `AC-25` | AC-25 | the frozen validation sample with owner labels and the seeded injection and malformed fixtures | fixture_ids (every fixture record of the set), source_ids (the sample's sources) |
| `AC-21a` | AC-21a | the fixture feeds and earlier completed runs only, no run for today (the scenario's run makes today's completed run) | - |
| `AC-22a` | AC-22a | seeded unbookmarked items (<run>-old) older than the retention window (OD-20) | - |
| `AC-22b` | AC-22b | stored unbookmarked items (<run>-removed-source) of a source removed from configuration | - |
| `AC-22c` | AC-22c | one old item (<run>-bookmarked-old) that the scenario bookmarks with the write the client makes, and one unbookmarked old item (<run>-old) | - |
| `AC-26c` | AC-26c | the admitted post (<run>-reddit-admitted) stored by an earlier run, absent from this run's fixture listing and marked removed; test Reddit credentials set | - |
| `AC-27a` | AC-27a | no Reddit credentials set and a fixture Reddit listing on the fixture server | - |
| `AC-27c` | AC-27c | no Reddit credentials set and a fixture Reddit listing on the fixture server | - |
| `AC-28c` | AC-28c | a fixture shaped like the mirror (RSS 2.0, each description a whole article that starts with <run>-article-body) on the fixture server as source anthropic-news-mirror | - |
| `AC-28d` | AC-28d | the mirror fixture answers HTTP 503 | - |

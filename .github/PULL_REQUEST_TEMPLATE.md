<!-- Put the story or bug number in the title, for example: #12 feed shows newest first. -->
**Issue:** #<number> <!-- Required: the story, bug or epic. -->

## Plan
<!-- Required. The approved plan, limited to the final scope; explain every deviation. -->

- Observable goal:
- Agreed approach:
- Plan deviations and reasons:

## Changes
<!-- Required. Group by intent and explain why; do not repeat the diff's file list. -->

| Area / File Group | Change | Reason |
|---|---|---|
| | | |

- Out-of-scope decisions encountered:
- Work deliberately deferred and its tracking reference:

## Verification
<!-- Required. Fresh commands on this branch, where they ran, and the output summary. -->

| Command | Where It Ran | Result |
|---|---|---|
| `<build/test command>` | local / sandbox / test | <passed, failed, skipped counts; identify pre-existing skips> |
| `<scoped end-to-end command>` | sandbox / test | <scenario count and result> |
| `<lint/type check>` | local | <result> |

- Manual check: <action personally performed and environment>
- Unverified items: <gap and responsible verifier>

## Acceptance Evidence
<!-- Required for user-visible changes. -->

- **Tagged scenarios:** tags and count per tag.
- **New/changed scenarios:** acceptance criterion covered by each.
- **Browser or device QA pass:** ran / not applicable; findings, with each disposition.
- **Cross-vendor review:** actual providers and models, findings and dispositions: fixed, rejected with reason, or staged for a ticket. Single-vendor self-review is not a substitute; report when it is the only review available.

> Report red runs and name failing journeys. Never retry until green and report only the green run.

## AI Usage
<!-- Required. -->

- **Supervision level:** autonomous (sandbox) / interactive / hands-on.
- **Agents/models used:** implementation and review, including differences.
- **Autonomous work:** parts produced without per-edit approval.
- **Human-written/rewritten work:** <scope>
- **Marker:** apply `ai-assisted` whenever any part was agent-produced.

> Explain every line being shipped. An agent suggestion does not justify it.

## Observability
<!-- Required for behavior changes; pure refactors may omit with explanation. -->

- **Log events:** names, levels and fields added or changed.
- **Metrics:** names, types and the questions they answer.
- **Failure recognition:** one sentence describing how this feature failing would be recognized.

## Spec Delta
<!-- Required for changes to documented behavior. -->

- **Sister spec PR:** <reference in ai-news-team-context>
- Added/changed/removed behavior and its tagged scenario:
- Discovered specification drift and its proposed tracking reference:

## Security
<!-- Required. -->

- **Data classification:** Public / Internal / Confidential / Personal data / Restricted; identify the data.
- **High-impact actions:** external sending, access changes, destructive changes, deployment or financial commitments; name each independent human gate.
- **Secrets/SAST/SCA:** branch status, findings and dispositions.
- **Dependencies:** name, exact version, reason.
- **Untrusted input:** user, external-system and AI content parsed, rendered or executed, with validation controls.

## Checklist
<!-- Required. Each item is an accountable claim. -->

- [ ] I reviewed the entire diff, including agent-written work.
- [ ] I tested in the environment named under Verification.
- [ ] No test was weakened, skipped or deleted to obtain a pass; changed assertions follow a documented specification change.
- [ ] No placeholder completion: no skipped test, no `TODO` replacing required work, no unfinished branch presented as complete.
- [ ] CI, infrastructure and dependency diffs are listed and reviewed.
- [ ] Generated code passed review, secrets scanning and tests before this PR opened, not merely afterward.
- [ ] I can explain every changed line and its purpose.

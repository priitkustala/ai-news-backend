---
name: Story (agent-ready)
about: A story a person can agree to and an agent can build without guessing
title: "<Verb-first title stating the outcome>"
labels: story
---

**Parent epic:** #<epic number and title>

## What to Build

- <One observable behavior in product language>
- <Behavior>

### Invariants to Keep

- <Condition that must remain true>
- <Existing behavior or contract that must not change>

## Acceptance Criteria

One Given/When/Then per behavior. Name persona and surface in Given. Each criterion must be machine-checkable without clarification.

1. **Given** <persona, surface and starting state> **when** <action> **then** <checkable outcome>.
2. **Given** <state> **when** <action> **then** <outcome>.
3. **Given** <state> **when** <action> **then** <outcome>.

## Visuals and Design References

- <Artboard or design-handoff reference and covered surface>
- <Explicitly state when there is no visual change>

## Specification, Decision and Design References

- **Specification:** <path and section, with LOCKED stamp>
- **Decision:** <team memory decision id or title>
- **Design handoff:** <team-context folder>

## Build Order and Dependencies

- Specification build order: <step N of M>
- Blocked by: <prior stories and reasons>
- Blocks: <dependent stories>

## Code Touchpoints

Best-effort guidance; report discoveries that change the expected structure in the PR.

- `<repository>`, `<path/module>`: <change>

## Done When

Only executable checks belong here.

- [ ] <Passing test command and scope/tag>
- [ ] <Scenario changing from failing to passing>
- [ ] <Check that nothing else in the scoped run changed>

## Non-Goals and Scope Fence

- <Excluded work; stage any discovery as a separate backlog proposal for the owner's approval>

## Security Notes

- **Data classification:** <Public / Internal / Confidential / Personal data / Restricted; exact fields>
- **High-impact actions:** <none / external sending / deletion / access change / deployment / financial commitment; human gate for each>
- **Test data:** <seeded test data only; never production data>

# Task brief

The brief is the constraint. Fill every field before an agent starts; an empty
Constraints or Done when field means the task is not ready. Never paste secrets or
production data into a brief.

## General

**Goal:** <observable change when done>
**Main description:** <story or specification reference>
**Context:** <files, logs, errors and specifications to read first>
**Constraints:** <protected files, dependency restrictions and scope; when to stop and ask>
**Done when:** <executable checks with the expected result of each>

## Bugfix

Fix this bug.

**Goal:** <observed failure no longer occurs; required behavior holds>
**Main description:** <bug reference with reproduction steps personally verified before assignment. Where possible, write a test confirming the failure before fixing it and reuse it to verify the fix.>
**Context:** <files, logs, errors and specifications to read first>
**Constraints:** <protected files, dependency restrictions and scope>
**Done when:** <executable checks with the expected result of each>

## Completion checklist

- [ ] Goal states an observable outcome, not an activity.
- [ ] Main description references a complete existing story or bug.
- [ ] Context identifies first reads without repeating `AGENTS.md`.
- [ ] Constraints name protected files, dependency limits and scope, with an instruction to ask about unclear boundaries.
- [ ] Done when contains executable checks; human judgment is a separate review step.
- [ ] The brief asks how the change will be seen working, or failing, once released.
- [ ] No credential, secret, token or personal data appears in the brief.

# TOP open source hardening 3/15/17

> Compaction-safe implementation note captured before implementation.

**Goal:** Implement the selected TOP open-source improvements from the project review without changing repo visibility or pushing anything.

## Selected items

### 3. Split `src/extension.ts`

`src/extension.ts` is too large for contributor onboarding. Start with a safe, low-risk extraction that reduces central-file gravity without changing runtime behavior.

Acceptance:
- Extract at least one coherent production module out of `src/extension.ts`.
- Prefer pure/helper code first, not risky UI lifecycle code.
- Add/keep automated guards proving the module split exists and tests still pass.
- Do not do a giant architecture rewrite in one commit. That is how good projects become haunted houses.

Initial target:
- Move Git process/workspace repository helper logic into a dedicated module such as `src/gitService.ts`.

### 15. Destructive Git action contract tests

Add explicit automated contracts that every destructive path requires modal confirmation and that cancel paths do not perform the destructive operation.

Acceptance:
- Tests cover reset hard / reset to commit / discard file or hunk/line / stash drop / nuke working tree / force push with lease where present.
- Prefer source/contract tests now, real UI dogfood later if needed.
- Tests should fail if a destructive command is wired without `showWarningMessage(..., { modal: true }, ...)` or equivalent confirmation gate.

### 17. Clean test runner

Replace the giant `npm test` command chain with a repo-local runner.

Acceptance:
- Add `scripts/run-tests.js`.
- Runner discovers or lists `test/*.test.js` deterministically.
- Runner prints ordered progress and a concise failure summary.
- `npm test` becomes `npm run compile && node scripts/run-tests.js`.
- Add a contract test so future agents do not revert to a monstrous shell chain.

## Extra requested coverage

Also close the remaining coverage gaps from the previous mini-commit instead of pretending they do not exist:

- HUNK `j/k` wrap, not only one-way movement between changed areas.
- Guard that HUNK/LINE highlighting is scoped to changed lines, not whole-file visual mush.
- Deleted, renamed, and conflict UI/dogfood coverage, at least as targeted lanes if broad default would become too slow.
- Keep cramped/deep-tree coverage runnable and documented; decide whether they stay targeted or enter the broad matrix based on runtime.

## Verification plan

Use TDD where practical:
1. Add/adjust failing tests for runner, destructive contracts, module split, and the extra coverage gaps.
2. Run focused tests to prove RED.
3. Implement minimal code.
4. Run focused tests to prove GREEN.
5. Run full `npm test`.
6. Run packaging check because package scripts changed: `npm run package:dist`.
7. Run relevant dogfood lanes for UI coverage changes.
8. Inspect `git diff --stat` and final status.
9. Commit locally only if all checks pass. No push.

## Out of scope for this pass

- Full decomposition of all panels/webviews/state.
- New Marketplace release.
- Repo visibility changes.
- Turning every targeted dogfood lane into default if runtime gets stupid.

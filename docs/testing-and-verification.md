# Testing and verification

This document is the repo playbook for future agents. If you are fixing a bug or adding a feature, start here instead of rediscovering the test surface by vibes. Vibes are how keyboard UIs rot.

For the current coverage rollout checklist, see `docs/testing-coverage-implementation-plan.md`. Keep that file as the preserved plan when a long testing task spans context resets.

## Core rule

Every feature request and every bug fix should ship with tests, aiming for 100% coverage of the touched behavior where practical.

That means:

- Write the failing regression or feature test first when the behavior is testable.
- Run the focused test and verify it fails for the expected reason.
- Implement the minimal fix.
- Run the focused test again and verify it passes.
- Run the wider suite before commit.
- For UI/focus/keybinding/editor changes, run real VS Code dogfood too.

If a behavior cannot be fully automated, document the gap and add the nearest deterministic guard. Do not leave “manually checked” as the only proof unless there is genuinely no better hook.

## Test layers

### 1. Fast source and contract tests

Command:

```bash
npm test
```

This compiles TypeScript and runs the fast Node tests under `test/*.test.js`.

Use this layer for:

- lazygit config parsing and `LG_CONFIG_FILE` semantics
- upstream keybinding/menu parity
- hunk and line patch generation
- Git primitive behavior in temporary repositories
- staging and unstaging matrices
- Files panel renderer contracts
- package/activation/keybinding/context health checks
- virtual preview document regressions, especially no `Untitled-*`
- focus/keybinding static guards, especially no broad editor-text number bindings

Current `npm test` order is defined in `package.json`. If you add a new test file, add it to the script in the same commit. A test file sitting in `test/` but not wired into `npm test` is decorative trash.

### 2. Real Git temporary repository tests

Use temporary Git repositories for any Git behavior:

- stage all, unstage all
- whole hunk stage/unstage
- selected line stage/unstage
- discard vs unstage distinction
- tracked modifications
- added files
- deleted files
- untracked files
- dense replacements such as JSON/settings-style changes
- close hunks that need zero-context handling

Prefer real `git` state assertions over mocks:

```bash
git status --short
git diff --name-only
git diff --cached --name-only
git diff --cached --unified=0
```

If these tests pass but the product still fails, stop fiddling with Git commands. The bug is probably UI routing, selection, focus, refresh, or stale context state.

### 3. Static runtime health checks

`test/runtimeHealth.test.js` is the cheap tripwire for bad product hygiene.

It should catch things like:

- missing command registrations
- missing activation events
- broad keybindings that leak into real editors
- stale or noisy status/focus contexts
- generated preview regressions back to `Untitled-*`
- scattered timers or lifecycle leaks
- local/debug artifacts that should not ship

When adding a new command, context, keybinding, preview surface, timer, status mode, or lifecycle path, update runtime health if it can protect the invariant.

### 4. Real VS Code dogfood

Command:

```bash
npm run dogfood:ui
```

This launches a real VS Code Extension Development Host through `@vscode/test-electron`, Xvfb, and CDP. It drives keyboard input and checks deterministic Git/UI state. It writes screenshots only for failures by default; set `LGVS_DOGFOOD_SCREENSHOTS=all` when doing visual review.

Use dogfood for any change touching:

- SCM sidebar panels
- focus ownership
- numeric panel jumps
- keybindings
- Command Palette interaction
- QuickPick behavior
- editor HUNK/LINE mode
- VSCodeVim interaction
- previews/diffs
- gutter/status/selection visuals
- row layout, color, contrast, light-theme CSS

Do not call a UI/focus/keybinding fix done from `npm test` alone. Unit tests cannot see focus races or cursed CSS.

## Dogfood lanes

Full matrix:

```bash
npm run dogfood:ui
```

Individual lanes:

```bash
npm run dogfood:ui:no-vim
npm run dogfood:ui:vim
```

Targeted lanes:

```bash
npm run dogfood:ui:preview-tabs
npm run dogfood:ui:vim-escape
npm run dogfood:ui:reset-state
npm run dogfood:ui:command-palette
npm run dogfood:ui:hunk-escape
npm run dogfood:ui:deep-tree
npm run dogfood:ui:cramped
npm run dogfood:ui:edge-files
```

Cramped sidebar check (focused no-Vim lane; writes forced screenshots for `7` and `8` state evidence, but does not assert VS Code visually scrolled native deep headers):

```bash
npm run dogfood:ui:cramped
```

Dark theme spot-check when a visual bug is theme-sensitive:

```bash
LGVS_DOGFOOD_THEME='Default Dark Modern' npm run dogfood:ui
```

Default theme is `Default Light Modern` because light themes expose bad contrast and lazy CSS faster.

## Dogfood expected coverage

The broad harness should keep covering at least:

- VS Code opens with the right profile/settings and no right chat/auxiliary bar noise
- Command Palette can run `LazyGitVS: Focus SCM Sidebar`
- the LGVS SCM panel set is present
- panels `1..8` are reachable
- `4 Commits` + `Enter` opens the selected commit details
- `3 Branches` + `Enter` opens branch-scoped commits
- commit-file `Enter` opens read-only HUNK/LINE mode and `Esc` returns to commit files
- `?` opens contextual help and returns focus
- deep-tree and cramped-sidebar lanes exist
- deleted/renamed/conflict dogfood lane exists
- Files panel renders meaningful fixture data
- Files `Enter` opens a real editor and enters editor HUNK mode
- HUNK navigation works and wraps
- `a` toggles HUNK/LINE mode
- `Space` stages the selected hunk/line
- `Tab` switches staged/unstaged side
- `Space` unstages from the staged side
- `e` hands keyboard ownership to real EDIT/Vim/VS Code mode
- return from EDIT to HUNK works where the product owns that path
- `Esc` exits LGVS HUNK/LINE mode back to Files/sidebar
- normal editor/Vim text focus is not hijacked by LGVS number bindings
- generated previews are named virtual documents, not `Untitled-*`
- failure screenshots are written under `dogfood-output/screenshots/` automatically; passing runs stay text/JSON-only unless `LGVS_DOGFOOD_SCREENSHOTS=all` is set

If a bug came from VSCodeVim, run both no-vim and vim lanes. Fixing only the no-vim lane is usually fake progress.

## Choosing the right test for a change

Feature or bug type:

- Parser/config/keymap/menu behavior: add a fast Node test, then `npm test`.
- Git primitive behavior: add a real temp-repo test, then `npm test`.
- HUNK/LINE patch math: add focused patch tests plus real Git apply tests, then `npm test`.
- Package manifest, activation, contexts, keybindings: add or update runtime health/static tests, then `npm test`.
- Sidebar row rendering: add HTML/render contract tests, then dogfood if the visual output matters.
- Focus, keyboard ownership, Command Palette, QuickPick, VSCodeVim: add the nearest static guard, then dogfood. Static-only is not enough.
- Marketplace/package hygiene: run `npm test`, `npm run package:dist`, and inspect VSIX contents.
- Release/local VSIX delivery: run `npm test`, the relevant dogfood if UI changed, then `npm run package`.

## Coverage target

Aim for 100% coverage of the touched behavior, not meaningless global percentage theater.

For each change, ask:

- What exact behavior did the user request or report broken?
- What is the smallest failing automated test that proves it?
- What neighboring edge case would break the same way?
- Is there a VSCodeVim lane risk?
- Is there a light-theme visual risk?
- Is there a real Git state risk?
- Is there a package/runtime manifest risk?

A good bug fix usually has:

- one focused RED regression test for the reported failure
- one or two edge tests around the same failure mode
- a full `npm test` pass
- dogfood evidence if UI/focus/keybindings are involved

## RED/GREEN discipline

When practical, follow this exact loop:

```bash
# RED: focused test should fail for the expected reason
node test/<file>.test.js

# GREEN: after implementation, focused test should pass
node test/<file>.test.js

# Regression pass
npm test
```

For UI bugs, the RED step may be a dogfood assertion rather than a unit test. That is fine if the failure is actually visible and deterministic.

Avoid tests-after as your only proof. Tests that pass the first time prove almost nothing; they may just be documenting the bug.

## Manual checks

Manual checks are allowed only as evidence, not as the main oracle, when automation cannot reasonably assert the behavior.

If you must do manual or visual inspection:

- write down the exact command used
- keep screenshots under ignored `dogfood-output/`
- add whatever deterministic check is possible nearby
- mention the remaining automation gap in the final response or docs

For user-facing UI fixes, send at least one fresh dogfood screenshot as a real Telegram media attachment when reporting back.

## Packaging verification

For public/CI artifact checks:

```bash
npm run package:dist
unzip -l dist/*.vsix | less
```

For local dogfood delivery:

```bash
npm run package
```

Verify the VSIX exists and does not include junk:

- no `node_modules/` source dump
- no `.vscode-test/`
- no `dogfood-output/`
- no screenshots/logs
- no local env files
- no private absolute paths
- no secrets

## Commit checklist

Before committing:

```bash
git diff --staged --stat
git diff --staged
npm test
```

Also run when applicable:

```bash
npm run dogfood:ui
npm run package
npm run package:dist
```

Then check:

- staged files are only intended source/docs/test/config files
- every new test file is included in `npm test`
- docs mention new commands/keys/known limitations if user-visible
- parity docs are updated if lazygit behavior changed or was audited
- no generated artifacts are staged
- no local-only path or operator note leaked into public docs
- no release/version bump unless explicitly requested

## Future-agent failure triage

When a test fails:

1. Reproduce the specific failing command.
2. Read the failing assertion and the product invariant it protects.
3. If a Git primitive test fails, inspect `git status`, cached diff, and working diff inside the temp repo output if available.
4. If dogfood fails, inspect `dogfood-output/last-run*.json` and the screenshots around the failing step.
5. Do not delete a flaky-looking assertion until you understand what invariant it was guarding.
6. If the invariant is obsolete, update the test and docs in the same commit.

Flaky UI tests are annoying. Blindly removing them is worse.

## Useful output paths

```text
dogfood-output/last-run.json
dogfood-output/last-run-no-vim.json
dogfood-output/last-run-vim.json
dogfood-output/screenshots/no-vim/*.png
dogfood-output/screenshots/vim/*.png
../releases/LazyGitVS/lazygitvs-<commit>.vsix
dist/lazygitvs-<version>.vsix
```

`dogfood-output/`, `dist/`, `.vscode-test/`, `out/`, logs, screenshots, and VSIX files are artifacts. Keep them ignored and out of commits.

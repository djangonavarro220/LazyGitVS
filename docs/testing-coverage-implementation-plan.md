# LazyGitVS testing and coverage implementation plan

This file preserves the agreed testing/coverage plan so it survives Hermes context resets.

## Goal

Make LazyGitVS testing cover the real failure modes, not just happy-path parser code.

## 1. Fast tests, always in `npm test`

These must stay cheap enough to run before every commit.

- Parser/config coverage:
  - lazygit config parsing
  - keybinding loading and overrides
  - menu/action catalogs
  - hunk and line patch generation
- Git primitives with temporary real repos:
  - stage/unstage files
  - stage/unstage hunks
  - stage/unstage selected lines
  - discard/reset/clean guarded behavior
  - status matrix: modified, added, untracked, deleted, renamed, conflicts, mixed staged+unstaged
- Keybinding/package contracts:
  - all contributed commands exist
  - activation events cover commands/views used by keybindings
  - keybindings have tight `when` clauses
  - no broad editor text focus ownership leaks
- Runtime/static health contracts:
  - `LazyGitVS: Reset state` exists
  - context keys are narrow and cleared
  - numeric panel jumps never bind inside real editor/Vim text focus
  - timers/intervals are centralized and disposable
  - no generated preview uses `Untitled-*`
  - no LGVS status/mode label leaks outside owned surfaces
  - package hygiene excludes tests, dogfood output, maps, local files, VSIX artifacts

## 2. Integration tests with real Git repos

Use shared realistic fixtures under `test/helpers/` instead of toy one-file repos.

Required fixture shapes:

- `MM` file, staged and unstaged changes in the same file
- adjacent/nearby hunks that Git default context would merge
- untracked file
- deleted file
- renamed file
- conflict markers
- JSON/settings-style dense replacement blocks
- nested paths plus root files to catch sidebar row layout lies
- multiple repos/workspace folders for repo selector coverage

Assertions should prefer durable Git state over brittle UI text when possible:

- `git status --porcelain`
- `git diff --cached --unified=0`
- `git diff --unified=0`
- file contents for leakage sentinels

## 3. Real VS Code dogfood UI lanes

Dogfood is required for UI/focus/keybinding/sidebar/editor/HUNK/LINE/preview/status-bar work. Static tests alone are not enough. VS Code focus bugs laugh at static tests.

Keep these callable lanes:

- `npm run dogfood:ui:no-vim`
- `npm run dogfood:ui:vim`
- `npm run dogfood:ui` as the broad/default matrix
- targeted lanes for quick regression loops when fixing one issue

The broad dogfood path must cover:

- Extension Development Host starts cleanly
- right Chat/Auxiliary Bar stays closed in screenshots
- SCM sidebar opens and LGVS panels are visible/reachable
- panel jumps `1..8`, including deep-panel best-effort reveal evidence
- `1 Status` + `Enter` opens repository selector without row click
- normal-panel `Esc` on `3 Branches`, `4 Commits`, `5 Stash` stays on that panel
- `4 Commits` + `Enter` drills into commit files, then `Esc` returns to commit list
- Files panel preview remains plain, no HUNK markers in passive preview
- Files `Enter` opens real editor HUNK mode, without replacing Files with a fake hunk sidebar
- HUNK navigation wraps and highlights only changed lines
- HUNK/LINE toggle works
- `Space` stages/unstages selected hunk/line with Git-state assertion
- `Tab` switches staged/unstaged side
- `e` hands off to real EDIT/Vim mode and LGVS releases keyboard ownership
- return to LGVS through the public command path when EDIT mode no longer belongs to LGVS
- `Esc` exits HUNK/LINE back to Files/sidebar only under narrow HUNK/LINE context
- `?` contextual help does not steal permanent focus and excludes obvious navigation noise
- Command Palette remains usable and is not instantly closed by LGVS focus retries
- generated previews are named `lazygitvs-preview:` docs, not `Untitled-*`
- VSCodeVim lane proves `:6` keeps the digit in Vim and does not jump to panel 6
- modal/focus leakage probes check visible editor text and Git diff sentinels, not only saved file diff

Every dogfood run should emit meaningful screenshots under `dogfood-output/screenshots/...`. Final user updates for UI work should attach at least one fresh relevant screenshot.

## 4. Visual/regression evidence

Screenshots are evidence, not the oracle. The pass/fail oracle should be deterministic:

- Git state assertions
- command visibility / QuickInput visibility checks
- preview title/scheme checks
- DOM/text invariants only where stable
- screenshot existence plus targeted visual review for layout regressions

Use light theme by default because it exposes contrast and layout bugs that dark themes hide.

## 5. CI and packaging hygiene

Keep fast tests and heavy dogfood separated:

- `npm test`: fast/unit/integration/contract tests
- `npm run dogfood:ui`: heavy real VS Code matrix
- `npm run package`: local Syncthing VSIX output
- `npm run package:dist`: portable CI/Marketplace output

Package rules:

- no `node_modules/`, `out/**/*.map`, `dist/`, `.vscode-test/`, `dogfood-output/`, screenshots, logs, `test/**`, local env files, or VSIX artifacts in the VSIX
- public docs stay portable, no host-local paths
- no release/version bump unless explicitly requested
- no push/tag/publish/repo visibility changes unless explicitly requested

## 6. Implementation order

1. Preserve this plan in Git.
2. Inspect existing coverage and scripts.
3. Fill gaps in fast contract/runtime tests first.
4. Harden shared Git fixtures and integration matrix.
5. Harden dogfood lanes and broad assertions.
6. Run `npm test`.
7. Run the relevant dogfood lane(s), ideally `npm run dogfood:ui` for UI/focus changes.
8. Run packaging if deliverable/validation requires it.
9. Commit source/docs/tests only. No push.

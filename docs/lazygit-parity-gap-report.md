# LazyGitVS parity gap report

Tracked, committed parity status against upstream lazygit. Keep this file updated whenever a parity gap is closed or a new mismatch is found. Vibes are not a tracking system.

Canonical disputed claims were re-audited offline against the locally preserved exact revision `jesseduffield/lazygit@bea025f5b7abbefe306a252826f1ccb2482baa00` on 2026-07-11 and live in `docs/lazygit-parity-ledger.json`.

## Done / usable parity

### Core plumbing
- [x] Reads lazygit config from `LG_CONFIG_FILE` / default locations.
- [x] Merges lazygit keybindings over internal defaults read-only.
- [x] Uses real lazygit config key names for important keys such as `pushFiles`, `pullFiles`, `files.copyFileInfoToClipboard`.
- [x] Printable key matching is case-sensitive; bracket/chord keys normalize safely.
- [x] Typed QuickPick key execution.
- [x] Shared command registry for contextual help, QuickPick entries, and typed panel actions.
- [x] CSP + script nonce for webviews.
- [x] Global configured `universal.undo` / `universal.redo` reflog actions on upstream-equivalent LGVS sidebar surfaces, with lazygit markers, confirmations, operation-state guards, autostash behavior, bounded reflog reads, and selected-repository isolation. Conflicts and editor HUNK/LINE retain their own/non-reflog scope.

### Navigation / panels
- [x] LazyGit-style numbered panels: Status, Files, Branches, Commits, Stash, Conflicts, Tags, Remotes.
- [x] `j/k`, arrows, page movement, top/bottom movement.
- [x] `/` panel text search.
- [x] Circular block movement between panels with left/right, `h`/`l`, and Shift+Tab/Tab, including the Status ↔ Files webview boundary and first/last-panel wrap.
- [x] Status dashboard with workspace repository selector.
- [x] Multi-root/workspace repository switching.

### Files
- [x] Git short-status badges preserve original two-column porcelain letters.
- [x] File status filter menu.
- [x] Copy path / copy file info routing.
- [x] Ignore / exclude file menu.
- [x] Fetch key.
- [x] Stage/unstage selected file.
- [x] Stage/unstage all files.
- [x] Range select for file batch stage/unstage.
- [x] Commit / commit without hook / amend last commit / commit with editor body.
- [x] Stash all and stash options menu.
- [x] Discard file menu with lazygit order.
- [x] Reset/nuke working tree menu.
- [x] Real file tree rows with directory nodes.
- [x] `Enter` toggles directory collapse/expand.
- [x] `` ` `` toggles file tree mode.
- [x] `-` collapses all file-tree directories.
- [x] `=` expands all file-tree directories.
- [x] `gui.showFileTree`, `gui.fileTreeSortOrder`, `gui.fileTreeSortCaseSensitive` influence files display/sort.

### Main / hunk / line
- [x] Hunk mode.
- [x] Line mode basic.
- [x] Stage/unstage selected hunk.
- [x] Stage/unstage selected line.
- [x] Staged-line mode handles adjacent replacement pairs.
- [x] Zero-context patch fallback for nearby hunks.
- [x] Binary diffs avoid fake patch actions.
- [x] Renamed text-file hunks remain patchable.
- [x] Editor HUNK/LINE mode with scoped keyboard ownership.
- [x] `gui.wrapLinesInStagingView` and `gui.useHunkModeInStagingView` applied.

### Branches
- [x] Checkout selected branch.
- [x] Checkout by name.
- [x] Checkout previous branch.
- [x] New branch.
- [x] Delete branch.
- [x] Rename branch.
- [x] Merge selected into current.
- [x] Rebase current onto selected.
- [x] Force checkout.
- [x] Set upstream.
- [x] Fast-forward from upstream.
- [x] Create tag from branch context.
- [x] Branch sort menu.
- [x] Branches `<enter>` views commits for the selected branch; re-audited against lazygit keybinding docs/source extract.

### Commits
- [x] Show commit patch/stat preview.
- [x] `<enter>` drills into commit files.
- [x] Commit-file patch preview.
- [x] **Bounded partial Commit-files checkout slice**: after `Enter` opens exactly one inspected commit with no visual range, configured `keybinding.commitFiles.checkoutCommitFile` (default `c`) checks out the selected tree file or directory with captured-repository argv `git checkout <commit> -- <path>`. It verifies the commit, validates a non-empty relative literal path, inspects NUL-delimited selected-path porcelain status before and immediately before mutation, and refuses tracked staged/unstaged/conflict/deleted/renamed paths with a `local modifications` error. Unrelated changes are allowed. Because Git can silently overwrite an untracked path here, LGVS fails closed on source-tree collisions. Success refreshes while preserving Commit-files selection/preview; there is no confirmation.
- Enter with an active visual commit range refuses before setting Commit-files state, rather than silently choosing one endpoint. Full visual-range diff/to semantics remain open.
- [x] Commit-file `<enter>` enters a read-only VS Code HUNK/LINE view for per-file commit patches, with `Esc` returning to the commit-files subview; lazygit uses this surface for patch-builder line entry, while LGVS documents this as a VS Code-native read-only difference until patch-builder support lands.
- [x] **Bounded partial Commit-files discard slice**: inside one inspected Local Commits drilldown with no visual range, configured `universal.remove` (default `d`) presents lazygit's exact **Discard file changes** confirmation, revalidates the full clean repository, and changes only the captured commit's generated `pick` to typed `edit` through the private 0700 interactive-rebase editor. Each literal selected file (or only literal contained directory file) is restored from `HEAD^`, or removed/staged when new or root; `git commit --amend --no-edit --allow-empty --allow-empty-message` then `git rebase --continue` completes the slice. Success clears the stale drilldown and returns to top-level Commits at the previous clamped index.
- This intentionally accepts only an attached current local branch, one reachable ordinary non-merge commit, ordinary non-rename/non-symlink/non-submodule paths, and `commit.gpgSign` disabled. It rejects dirty staged/unstaged/untracked state, active merge/rebase/cherry-pick/revert, detached/branch-scoped/drifted views, path magic/traversal, and empty selections before mutation. If a descendant conflicts, the real rebase stays active for Status recovery and LGVS never auto-aborts; a failure with no active operation is surfaced exactly.
- [x] **Bounded Commit-files clipboard slice**: in exactly one inspected Commit-files drilldown, configured `keybinding.files.copyFileInfoToClipboard` (default `y`) opens upstream's **Copy to clipboard** choices `n/p/P/s/a/c`. The captured repo/hash/row/config drive plain no-external-diff parent-to-commit `git diff` argv for selected/all diffs and `git show <commit>:<path>` for content, so neither `HEAD` nor the top-level selected Commit leaks in. Literal pathspecs prevent Git glob expansion and root commits use the empty tree. The blob-only `c` option is omitted for a directory because VS Code QuickPick has no disabled item state.
- [x] Copy commit attribute menu.
- [x] Checkout commit detached.
- [x] New branch off commit.
- [x] **Bounded partial Reword slice**: configured `keybinding.commits.renameCommit` (default `r`) is routed only from attached top-level Local Commits and rewords exactly one selected reachable ordinary non-merge commit without a destructive confirmation. It captures full `%B` before native **Reword commit** summary input, preserves the remaining body, and revalidates repository/branch/HEAD/selected hash/message after input. `HEAD` uses exact `git commit --allow-empty --amend --only -m <summary>` plus body only when nonempty; a selected ancestor/root uses private 0700 typed `edit` rebase without `--keep-empty`, proves stopped HEAD, amends, then continues with `GIT_EDITOR=true`.
- Reword/amend selected non-HEAD commits is intentionally limited to clean attached-current-branch Local Commits with `commit.gpgSign=false`; visual ranges, branch views, merges, active operations, dirty-tree auto-stash, editor-based `R`, and generic rebase UI remain gaps. Cancellation and post-input drift are read-only. Conflicts remain active for Status recovery without auto-abort, while no-operation failures surface their exact Git error.
- [x] **Bounded partial Edit slice**: Edit/start interactive rebase `e` follows configured `keybinding.universal.edit` only from attached top-level Local Commits. For a selected ordinary commit or contiguous visible range it captures repository/branch/HEAD/full hashes/parents, starts one real native interactive rebase without a confirmation or terminal, changes exactly selected generated `pick` rows to `edit`, and deliberately leaves the rebase active at the oldest selected original full hash. LGVS reports `Rebase stopped for commit editing; amend changes, then continue or abort from Status.` while Status exposes the real rebase; normal continue stops naturally at each later selected range commit. Root, HEAD, middle, and intentional-empty commits are covered without `--keep-empty`; the private 0700 C-locale editor is deleted after Git accepts the todo.
- Edit rejects dirty staged/unstaged/untracked trees, active merge/rebase/cherry-pick/revert, detached or branch-scoped views, unreachable/noncontiguous/duplicate selections, and selected merge commits before the transient `Rebasing` state. It never auto-amends, continues, or aborts. If a post-spawn check fails while an operation remains active, LGVS preserves it for Status recovery; an error with no operation surfaces exactly. Commit-files, Files, and Hunks keep their established `e` routes and no new webview message type is used.
- [x] **Bounded partial Move down/up slice**: **Move commit down/up `<ctrl+j>` / `<ctrl+k>`** follows configured `keybinding.commits.moveDownCommit` / `keybinding.commits.moveUpCommit` only from attached top-level Local Commits. A selected ordinary commit or contiguous visible range moves exactly one rendered first-parent position: down swaps the oldest selected todo pick earlier across the adjacent older ordinary pick; up swaps it later across the adjacent newer ordinary pick. It captures repository/branch/HEAD/full selected hashes, parents, messages, trees, full first-parent order, and destination; repeats that full preflight immediately with no modal; then reports **Moving** and invokes exactly one `git rebase --interactive --autostash --keep-empty --no-autosquash --rebase-merges <base|--root>` through `execFile`, `GIT_EDITOR=true`, C locale, and a private 0700 dedicated sequence editor.
- Move rejects dirty staged/unstaged/untracked trees, active operations, detached or branch-scoped views, invalid/duplicate/unreachable selections, selected/destination merges, filtered/nonlinear visible prefixes, `commit.gpgSign=true`, and visible top/bottom bounds before **Moving**. The editor fails closed on missing/ambiguous picks and preserves comments/unrelated directives byte-for-byte. Success verifies the intended first-parent semantic order without claiming old hashes survive and returns the shifted numeric selection/range; conflicts stay active for Status recovery, exact no-operation errors surface, and private editor cleanup is unconditional. Active-todo movement, merge movement, dirty auto-stash, and broad interactive-rebase UI remain open.
- [x] Amend HEAD with staged changes.
- [x] **Bounded partial Create fixup commit slice**: configured `keybinding.commits.createFixupCommit` (default `F`) is routed only from attached top-level Local Commits and opens the exact native **Create fixup commit** menu in upstream `f` / `a` / `r` order: **fixup! commit**, **amend! commit with changes**, and **amend! commit without changes (pure reword)**. It captures the repository, attached branch, HEAD, selected full ordinary reachable non-merge hash, full message, staged/unstaged/untracked snapshot, conflict/operation state, and `commit.gpgSign` before the menu and revalidates after menu selection and each amend input or stage-all confirmation.
- `f` uses exact `git commit --fixup=<fullhash>` over staged files; `a` and `r` use exact `amend! <original subject>` plus `<summary + optional blankline/body>` message construction, with `r` adding `--only --allow-empty`. Native summary/body titles are **Create "amend!" commit** and **Commit description**. With changes but no staged files, `f`/`a` use the exact **No files staged** / **You have not staged any files. Commit all files?** confirmation and stage-all retry; with no files those entries are disabled with **No files staged**, while `r` remains enabled. Success verifies one new child, exact message, staged/tree contract, and returns target selection +1. Cancellation/drift are read-only; failed Git state is surfaced without a rollback claim. Commit-files, Files, and HUNK/LINE retain their own routes.
- [x] Bounded Fixup menu for ordinary commit/range selections.
- [x] **Bounded partial C/V/reset cherry-pick slice**: Commits `v` provides a sticky visual range; Shift+Up/Down creates a non-sticky range; `C` copies/toggles the current single/range buffer in visible newest-first order; `V` confirms then invokes one oldest-first `git cherry-pick` argv; and configured `resetCherryPick` (default `<ctrl+r>`) clears only copied state. Source repository/list context is recorded, repository switches clear the buffer, successful paste keeps it reusable but hides copied-row highlighting, and the selected target hash is restored after refresh.
- This bounded slice deliberately rejects a dirty target worktree and merge commits before mutation. Cancellation and Git conflicts retain the buffer and let the existing Status operation flow expose recovery. Auto-stash, merge `-m 1`, Git-version empty-commit flags, and universal/cross-panel range refactoring remain in the open gap below.
- [x] **Bounded partial Drop slice**: configured `universal.remove` (default `d`) is routed only from top-level Commits and drops the current ordinary commit or visible selection range through `git rebase --interactive --autostash --keep-empty --no-autosquash --rebase-merges`. It uses a per-run 0700 sequence-editor executable and fails closed unless every selected hash appears exactly once as a `pick` line in Git's generated todo.
- The Drop preflight and post-confirmation revalidation require a clean attached checked-out local branch matching any branch-scoped Commits view; every selected commit must still be reachable, ordinary/non-merge, and not the sole root. A root with descendants is handled with `--root`. Cancellation and every blocked preflight are read-only. If replay conflicts, LGVS leaves rebase active, refreshes, and lets Status `m` / `c` / `a` / `s` recover; a non-operation failure is surfaced without a rollback claim.
- [x] **Bounded partial Squash-down slice**: configured `keybinding.commits.squashDown` (default `s`) is routed only from top-level Commits and squashes the current ordinary commit or visible selection range into the first visible unselected commit below through `git rebase --interactive --autostash --keep-empty --no-autosquash --rebase-merges`. The shared per-run 0700 sequence-editor executable changes exactly one generated `pick` line for each selected hash to `squash`, preserves all other todo directives byte-for-byte, and accepts Git's default combined message through `GIT_EDITOR=true`.
- The Squash-down preflight and post-confirmation revalidation require a clean attached checked-out local branch matching any branch-scoped Commits view; every selected commit and the target must remain reachable, selected commits must be ordinary/non-merge and contiguous, and a commit below must exist. A root target is handled with `--root`; a selected root/range reaching root is rejected. Conflicts leave rebase active for Status `m` / `c` / `a` / `s`; non-operation failures are surfaced without a rollback claim. Active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, and broader rebase UI remain open.
- [x] **Bounded partial Fixup slice**: configured `keybinding.commits.markCommitAsFixup` (default `f`) is routed only from top-level Commits and opens the exact `Fixup` menu after initial read-only preflight. Menu `f` changes each selected generated `pick` row to `fixup`; menu `c` changes it to `fixup -C`. It uses the same `git rebase --interactive --autostash --keep-empty --no-autosquash --rebase-merges` argv and shared per-run 0700 sequence editor as Drop/Squash, preserving comments and every unselected todo directive byte-for-byte.
- The Fixup post-menu revalidation again requires a clean attached checked-out local branch matching any branch-scoped Commits view; selected commits and the target must remain reachable, selected commits must be ordinary/non-merge and contiguous, and a commit below must exist. A root target uses `--root`; a selected root/range reaching root reports `There's no commit below to squash into`; a merge target remains permitted only when Git's `--rebase-merges` todo can handle it. Cancellation, preflight rejection, and drift are read-only. Conflicts remain active for Status recovery; non-operation failures are surfaced without a rollback claim. Active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, and broader rebase UI remain open; bounded autosquash `S` is documented separately.
- [x] **Bounded partial Apply fixup commits slice**: configured `keybinding.commits.squashAboveCommits` (default `S`) exists only in attached top-level Local Commits. It rejects a visual range and filtered/nonlinear history before the native **Apply fixup commits** menu; that picker exposes only upstream-supported `a` **Above the selected commit**, never a fake `b`. It accepts one clean, reachable ordinary non-merge selection on an attached branch with no active merge/rebase/cherry-pick/revert and `commit.gpgSign=false`, then repeats full branch/HEAD/hash/parent/message/first-parent-order revalidation after menu selection and only then reports **Squashing**.
- The action calls exact native argv `git rebase --interactive --rebase-merges --autostash --autosquash <selected^|--root>` through `execFile` with `GIT_SEQUENCE_EDITOR=true`, `GIT_EDITOR=true`, and C locale; it does not reuse the selected-todo runner. Git owns `fixup!`/`squash!` semantics and unrelated fixup-looking picks. Success captures real before/after first-parent histories and returns the numeric offset needed to select above deleted autosquash rows without reusing an old hash. Cancellation/drift are read-only; conflicts remain active for existing Status recovery, while no-operation errors surface without auto-abort. Full branch/current-status `b`, merge/range selections, dirty auto-stash, active-todo editing, and broad rebase UI remain gaps.
- [x] Revert commit.
- [x] Tag commit.
- [x] Reset options.
- [x] Open commit in browser.
- [x] Commit log patch view.

### Stash
- [x] Apply stash.
- [x] Pop stash.
- [x] Drop stash.
- [x] Rename stash.
- [x] New branch from stash.
- [x] View stash files.
- [x] Stash-file patch preview.

### Tags
- [x] Tags panel.
- [x] Create tag at HEAD.
- [x] Checkout tag detached.
- [x] New branch from tag.
- [x] Push tag.
- [x] Delete tag.

### Remotes
- [x] Remotes panel.
- [x] Add remote.
- [x] Fetch selected remote.
- [x] Edit remote URL.
- [x] Add fork remote.
- [x] Remove remote.

### Conflicts
- [x] Conflicts panel.
- [x] Open merge editor.
- [x] Choose ours.
- [x] Choose theirs.
- [x] Keep both / manual merge path.
- [x] Mark resolved.

### Diffing / preview
- [x] `W` / `<ctrl-e>` diffing menu.
- [x] Toggle whitespace in diff view.
- [x] Increase/decrease diff context size with `}` / `{`.
- [x] Increase/decrease rename similarity threshold with `)` / `(`.
- [x] `git.diffContextSize`, `git.ignoreWhitespaceInDiffView`, `git.renameSimilarityThreshold` applied to relevant Git calls.

### Accessibility / performance
- [x] Webview list container uses `role="listbox"`.
- [x] Rows use `role="option"` and `aria-selected`.
- [x] Basic virtualization for large lists.

## Needs upstream re-audit / suspected mismatches

These are behaviours that currently work in LGVS but are not trusted enough to call lazygit parity. Re-check against upstream lazygit before polishing or documenting them as done.

- No active Story 5 Enter-path suspects remain. Branches/Commits/commit-files Enter were re-audited on 2026-07-11; commit-file Enter is explicitly tracked as the VS Code-native read-only HUNK/LINE difference above and patch-builder parity remains in Commit files gaps.

## Remaining gaps

### Global workflows
- [ ] `@` command log options and command log focus.
- [ ] `:` execute shell command prompt.
- [ ] `<ctrl+p>` custom patch options.
- [ ] `m` merge/rebase options menu: continue / abort / skip.
- [ ] `+`, `_`, `|` screen/pager modes.
- [ ] `<ctrl+r>` should eventually match lazygit recent repos history, not just VS Code workspace repo picker.
- [ ] `<ctrl+z>` suspend app is intentionally not meaningful in VS Code; document/ignore as VS Code-native exception.

### Operation state machine
- [x] Model merge/rebase/cherry-pick in-progress states in a tested Git detector with safe action metadata.
- [x] Show merge/rebase/cherry-pick state in Status as `(operation) repo → branch`.
- [x] Open operation options with `m`: `c` continue, `a` abort, and `s` skip where applicable.
- [x] Detect revert operation status and expose `c` continue, `a` abort, and `s` skip options.
- [x] Commits `viewBisectOptions` (default `b`) opens the upstream `Bisect` menu for the selected commit: before start it preserves `b/g/t`; while started it exposes only state-valid `b/g/s/S/r` actions, confirms reset, executes Git argv against the active repository, and refreshes while preserving the commit selection/preview. Bisect remains intentionally outside Status.
- [ ] Conflict follow-up prompts matching lazygit.

### Files gaps
- [x] Upstream reset options on Files `g`: `keybinding.commits.viewResetOptions` opens the exact `Reset to @{upstream}` mixed/soft/hard menu, executes argv against the repository captured when the menu opens, confirms every reset through the central destructive contract, warns hard reset about index/worktree loss, and leaves no-upstream/cancel paths unchanged.
- [ ] Find base commit for fixup `<ctrl+f>`.
- [ ] External difftool `<ctrl+t>`.
- [ ] Merge conflict options from Files `M` exact lazygit flow.
- [ ] Submodule-specific discard/reset menus.
- [ ] Binary/rename/submodule row-specific actions beyond safe preview/stage guards.

### Main / hunk / patch gaps
- [ ] Edit hunk `E` exact lazygit workflow.
- [ ] Range select inside hunk/line mode.
- [ ] Commit flows from hunk mode: `c`, `w`, `C`, `<ctrl+f>`.
- [ ] Patch-building mode.
- [ ] Better recovery UX when `git apply` fails.

### Branch gaps
- [ ] PR actions: create PR `o`, PR options `O`, open PR `G`, copy PR URL `<ctrl+y>`.
- [ ] Git-flow options `i`.
- [ ] Move commits to new branch `N`.
- [ ] Worktree options `w`.
- [ ] Branch reset options `g`.
- [ ] Remote branch checkout modes: new local branch vs detached HEAD prompt.
- [ ] Merge/rebase option menus instead of simplified direct commands.

### Commit gaps
- [ ] Full upstream cherry-pick parity remains open beyond the bounded C/V/reset slice: no auto-stash, merge commits are not supported (`-m 1` is intentionally absent), no Git-version-specific empty-commit flags, and no universal range-selection refactor outside Commits.
- [ ] full merge/active-rebase/dirty auto-stash Drop parity remains open beyond the bounded slice: merge commits/ranges, invocation while an operation is already active, and dirty working trees are rejected rather than automated. Detached/non-current branches and richer rebase workflows remain out of scope.
- [ ] Full Squash-down parity remains open beyond the bounded slice: active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, history-wide/current-branch autosquash behavior, and broader rebase UI (reword/edit/move) are intentionally absent.
- [ ] Full Fixup parity remains open beyond the bounded f/c slice: active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, and broader rebase UI (reword/edit/move) are intentionally absent; bounded Apply fixup commits `S` is tracked separately.
- [ ] Full Autosquash/apply fixups `S` remains open beyond the bounded `S` → `a` selected-commit slice: the current-branch/main-status-dependent `b` action, merge/range selections, dirty auto-stash, active-todo editing, and broader rebase UI are intentionally absent.
- [ ] Full Edit parity remains open beyond the bounded partial Edit slice: active-rebase todo editing, merge commits/ranges, dirty-tree auto-stash, generic interactive rebase `i`, reword-with-editor, release/version/push/tag flows, and richer rebase UI are intentionally absent.
- [ ] Start interactive rebase `i`.
- [ ] Pick commit during rebase `p`.

- [ ] Mark base for rebase `B`.
- [ ] Amend commit attribute `a`.
- [ ] Open pull request in browser `G`.
- [ ] Move commits to new branch `N`.

- [ ] Select commits of current branch `*`.
- [ ] Worktree options `w`.
- [ ] External difftool `<ctrl+t>`.
### Commit files gaps
- [ ] Full visual commit-range drilldown/diff-to semantics; Enter currently refuses a range before opening the bounded single-commit surface.
- [ ] Submodule and symlink checkout edge cases.
- [ ] Full Commit-files discard parity remains open beyond the bounded `d` slice: visual-range/diff-to selection, active-rebase todo editing, dirty-tree auto-stash, merge commits, GPG-signed amend flow, symlink/submodule/rename semantics, generic rebase UI, and reloading a rewritten commit by an unsafe subject/hash guess are intentionally absent.
- [ ] Commit-file custom patch include/exclude.
- [x] Commit-file tree collapse/expand parity: `Enter` toggles directory rows independently from the Files panel, preserving the selected file for preview/HUNK entry.
- [ ] External difftool.

### Stash gaps
- [ ] Worktree options `w`.
- [ ] Batch/range stash operations.
- [ ] Exact `git stash branch` behavior/error handling.
- [ ] Hunk-level stash file view closer to lazygit.

### Tags gaps
- [ ] Tag reset options `g`.
- [ ] `<enter>` view commits for selected tag.
- [ ] Delete local vs remote tag options.
- [ ] More exact checkout/new branch menus.

### Remotes gaps
- [ ] `<enter>` view remote branches.
- [ ] Rename remote distinct from edit URL.
- [ ] Remote branch nested flow.

### Missing panels / surfaces
- [ ] Reflog panel.
- [ ] Submodules panel.
- [ ] Worktrees panel.
- [ ] Commit files as fuller first-class panel, not just commit drill-down.
- [ ] Sub-commits / secondary panels.

### Config / customization gaps
- [ ] `customCommands` execution and prompts.
- [ ] `customPagers`.
- [ ] `gui.splitDiff`.
- [ ] `gui.mainPanelSplitMode`.
- [ ] `gui.sidePanelWidth`.
- [ ] `gui.scrollOffMargin` / `gui.scrollOffBehavior`.
- [ ] `gui.theme.*` beyond VS Code theme defaults.
- [ ] `git.skipHookPrefix`.
- [ ] `git.commitPrefix`.
- [ ] `git.branchPrefix`.
- [ ] `git.autoFetch`.
- [ ] `git.overrideGpg`.
- [ ] `git.allBranchesLogCmds`.
- [ ] `os.openCommand`.
- [ ] `os.openLinkCommand`.
- [ ] `os.editPreset`.

### Text / i18n gaps
- [ ] Replace remaining approximate English labels with a local map derived from lazygit i18n/options map.
- [ ] Generate bottom-line/help labels from the same registry everywhere.
- [ ] Disabled reasons/radio/check state in menus where lazygit shows them.

### VS Code-native command surface
- [ ] Contribute more internal actions as VS Code commands so VSpaceCode/keybinding users can bind them outside the webview.
- [ ] Scope commands by panel/mode without stealing Vim/editor keys.

### Accessibility / performance gaps
- [x] Active-row accessibility: the focused webview exposes the panel as a listbox, every rendered selectable row has a stable index-derived id, and `aria-activedescendant` follows the selected row only while that panel owns focus.
- [ ] Keyboard focus announcement polish.
- [ ] Virtualization should eventually preserve scroll position and not just trim HTML around active row.
- [ ] Large-repo profiling and refresh throttling beyond current basic refresh guards.

## Recommended next order

1. Bisect options in Commits.
2. Commit workflows: squash, full Drop parity, edit/rebase/move/autosquash.
3. Files missing keys: `<ctrl+f>`, `<ctrl+t>`, `M`.
4. Worktrees/Reflog/Submodules panels.
5. Custom commands/custom pagers, late and sandboxed. This is useful but sharp.
6. i18n/options-map label cleanup.
7. VS Code command surface expansion.

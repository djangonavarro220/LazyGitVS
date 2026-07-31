# LazyGit keybinding parity audit

Source: upstream lazygit `docs/keybindings/Keybindings_en.md` from `jesseduffield/lazygit` at `bea025f5b7abbefe306a252826f1ccb2482baa00`, audited offline from the archive recorded in the canonical ledger.

This is the behavior spec for LazyGitVS. If LGVS differs, it needs an explicit VS Code-native reason; otherwise it is a bug.

## Global keys

- `P`: Push directly. Not a push-options menu.
- `p`: Pull directly. Not a pull/fetch menu.
- `R`: Refresh git state. Does not fetch.
- `?`: Open keybindings menu.
- `q`: Quit.
- `<esc>`: Cancel/return according to current context.
- `0`: Focus main view.

## Files

- `<space>`: Toggle staged for selected file.
- `<c-o>`: Copy path.
- `y`: Copy file info to clipboard.
- `c`: Commit.
- `w`: Commit without pre-commit hook.
- `A`: Amend last commit.
- `C`: Commit using git editor.
- `e`: Edit in external editor.
- `o`: Open file.
- `i`: Ignore/exclude file.
- `r`: Refresh files.
- `s`: Stash all changes directly.
- `S`: View stash options.
- `a`: Stage all / unstage all.
- `<enter>`: Stage lines / collapse directory.
- `d`: Discard options for selected file.
- `g`: Upstream reset options.
- `D`: Working-tree reset options.
- `M`: Merge conflict options.
- `f`: Fetch directly.
- `-`: Collapse all files.
- `=`: Expand all files.
- `/`: Filter current view.

## Local branches

- `<space>`: Checkout selected branch.
- `<enter>`: View commits for selected branch.
- `c`: Checkout by name.
- `-`: Checkout previous branch.
- `F`: Force checkout.
- `d`: Delete options.
- `r`: Rebase current branch onto selected.
- `M`: Merge selected into current.
- `f`: Fast-forward selected branch from upstream.
- `T`: New tag.
- `s`: Sort order.
- `g`: Reset options.
- `R`: Rename branch.
- `u`: Upstream options.
- `n`: New branch.
- `N`: Move commits to new branch.
- `w`: Worktree options.

## Commits

- `<enter>`: View files.
- `<space>`: Checkout selected commit detached.
- `y`: Copy commit attribute.
- `o`: Open commit in browser.
- `n`: New branch off commit.
- `g`: Reset options.
- `v`: Start/clear sticky commit range selection; normal movement extends it.
- `Shift+↑/↓`: Create/extend a non-sticky commit range; normal movement clears it.
- `C`: Copy/toggle the selected commit range for cherry-pick. It is not immediate cherry-pick.
- `V`: Confirm and paste copied commits oldest-first on the active clean repository.
- `<ctrl+r>`: Clear copied cherry-pick commits without a Git mutation.
- `p`: Pick only when mid-rebase.
- `s` (configured `keybinding.commits.squashDown`): **partial Squash-down parity** for the selected ordinary single commit or visible range in the top-level Commits list. It confirms, revalidates, changes only matching generated `pick` rows to `squash`, and combines them into the first visible unselected commit below. It rejects dirty trees, active operations, detached/mismatched branch views, unreachable or selected merge commits, and a range reaching the oldest/root commit; a root target uses `--root`.
- `f` (configured `keybinding.commits.markCommitAsFixup`): **partial Fixup parity** for the selected ordinary single commit or visible range in the top-level Commits list. It opens `Fixup`: `f` changes matching generated `pick` rows to `fixup`, discarding selected messages; `c` changes them to `fixup -C`, using the final selected message. The explicit menu choice is the action, then LGVS revalidates before starting the shared private rebase editor. It rejects dirty trees, active operations, detached/mismatched branch views, unreachable or selected merge commits, and a range reaching the oldest/root commit; a root or merge target is left to the safe `--root` / `--rebase-merges` Git todo path.
- `c`: Set fixup message.
- `r` (configured `keybinding.commits.renameCommit`, default `r`): **partial Reword parity** for one selected ordinary commit in the attached top-level Local Commits list. LGVS reads full `%B` before one native `Reword commit` summary InputBox and preserves the unedited remaining body. `HEAD` uses exact `git commit --allow-empty --amend --only -m <summary>` plus `-m <preserved body>` only when nonempty; a selected ancestor/root uses one private 0700 typed-`edit` interactive rebase without `--keep-empty`, proves the stopped HEAD remains the captured selected hash, amends, and continues with `GIT_EDITOR=true`. It rejects ranges, dirty trees, active operations, detached or branch-scoped views, unreachable/merge commits, `commit.gpgSign=true`, and input-time drift before mutation; replay conflicts remain active for Status recovery and LGVS never auto-aborts. The configured action needs no destructive confirmation. This bounded behavior was re-audited against `jesseduffield/lazygit@bea025f5b7abbefe306a252826f1ccb2482baa00`: `pkg/gui/controllers/local_commits_controller.go:94-103,424-449,478-493`, `pkg/commands/git_commands/rebase.go:37-55`, and `pkg/commands/git_commands/commit.go:119-126`.
- `e` (configured `universal.edit`, the `keybinding.universal.edit` setting, default `e`): **partial Edit parity** for one selected ordinary commit or contiguous visible range in the attached top-level Local Commits list. It starts immediately without a modal or terminal, captures repository/branch/HEAD/full hashes/parents, uses the private 0700 C-locale interactive-rebase sequence editor to change exactly selected `pick` rows to `edit`, and intentionally leaves the real rebase active at the oldest selected original hash. LGVS reports `Rebase stopped for commit editing; amend changes, then continue or abort from Status.` while Status exposes the real rebase; normal continue reaches the next selected range stop. Root, HEAD, middle, and intentional empty commits work without `--keep-empty`; no auto-amend, auto-continue, or auto-abort occurs. It rejects dirty trees, active merge/rebase/cherry-pick/revert, detached or branch-scoped views, unreachable/noncontiguous/duplicate selections, and selected merge commits before `Rebasing`; any failure that leaves an operation preserves Status recovery. This is limited to top-level Commits, so Commit-files and Files retain their existing `e` paths.
- `R`: upstream's editor-based Reword-with-editor variant remains intentionally unsupported; this bounded slice edits only the summary in the native InputBox.
- `d` (configured `universal.remove`): **partial Drop parity** for the selected ordinary single commit or visible range in the top-level Commits list. It confirms, revalidates, and uses a private interactive-rebase sequence editor; it rejects dirty trees, active operations, detached/mismatched branch views, merge commits, unreachable commits, and a sole root rather than approximating full upstream Drop.

- `i`: Start interactive rebase.
- `F`: Create fixup commit.
- `S` (configured `keybinding.commits.squashAboveCommits`, default `S`): **partial Apply fixup commits parity** for exactly one ordinary reachable non-merge selection in attached top-level Local Commits. It rejects visual ranges and filtered/nonlinear history before the native **Apply fixup commits** menu, whose only choice is `a` **Above the selected commit**; there is no unsupported `b`. It requires a clean staged/unstaged/untracked tree, no active merge/rebase/cherry-pick/revert, attached HEAD, and `commit.gpgSign=false`, then revalidates branch/HEAD/full hash/parent/message/first-parent order before setting **Squashing**. The action uses exact native argv `git rebase --interactive --rebase-merges --autostash --autosquash <selected^|--root>` with skipped C-locale editors, lets Git process `fixup!` and `squash!`, and derives before/after first-parent history to shift selection above actual removed autosquash rows rather than retaining stale hashes. Cancellation/drift are read-only; conflicts stay active for Status recovery; Git failures without an operation surface exactly and are never auto-aborted. This is deliberately a bounded slice, not full autosquash/current-branch parity.
- `A`: Amend.
- `a`: Amend commit attribute.
- `t`: Revert.
- `T`: Tag commit.
- `<c-l>`: View log options.

## Commit files

- `y` (configured `keybinding.files.copyFileInfoToClipboard`, default `y`): **bounded Commit-files clipboard parity**. In a single inspected Commit-files drilldown it opens the upstream-named **Copy to clipboard** menu: `n` file name, `p` relative path, `P` absolute path, `s` selected diff, `a` all-files diff, and `c` selected file content. The shared `files` key is routed only while Commit-files is active, so it cannot copy the top-level Commit summary.
- Menu callbacks capture the repository, inspected commit hash, selected row, and Git settings. `s`/`a` use the captured commit's parent-to-tree patch with plain `git diff --submodule --no-ext-diff`, configured context and rename threshold, and literal pathspecs. Root commits diff against Git's empty tree. `c` uses `git show <commit>:<path>`. These are read-only; directories offer `n/p/P/s/a` but omit blob-only `c` because VS Code QuickPick has no disabled-item API.
- `c` (configured `keybinding.commitFiles.checkoutCommitFile`, default `c`): **bounded partial Commit-files checkout parity**. Once `Enter` has opened exactly one inspected commit with no visual commit range, checkout the selected file or directory from that captured commit with exact argv `git checkout <commit> -- <path>` through the VS Code extension process; no terminal and no confirmation.
- The selected repository path, commit hash, and tree-row path are captured at action time. The path must be a non-empty relative literal repository path; absolute, traversal, NUL, and Git-pathspec-magic values are refused. The commit is verified and NUL-delimited selected-path porcelain status is rechecked immediately before checkout.
- Tracked staged, unstaged, conflicted, deleted, or renamed local changes at/in the selected path fail with `local modifications`; unrelated working-tree changes remain allowed. Git can silently overwrite an untracked path in this workflow, so LGVS adds a fail-closed source-tree collision check before checkout.
- This `c` is scoped only to Commit-files; top-level Commits retains its configured `c` Fixup-menu meaning, Files retains its configured `c` Commit meaning, and HUNK/LINE retains its own action map.
- `d` (configured `universal.remove`, default `d`): **bounded partial Commit-files discard parity**. Only after `Enter` has opened one inspected Local Commits entry with no visual range, a mandatory **Discard file changes** confirmation starts a private `git rebase --interactive --autostash --no-autosquash --rebase-merges`; the captured selected `pick` becomes `edit`, selected ordinary files are restored from `HEAD^` or removed/staged when new, the commit is amended with `--allow-empty --allow-empty-message`, and Git continues with `GIT_EDITOR=true`. As upstream requests `keepCommitsThatBecomeEmpty=false`, descendants made empty by the rewrite are dropped.
- This scope was checked offline against the pinned archive source `pkg/gui/controllers/commits_files_controller.go:331-396` and `pkg/commands/git_commands/rebase.go:423-451,519-555` at `bea025f5b7abbefe306a252826f1ccb2482baa00`. The full tree—including untracked files—must be clean; HEAD must be attached to the current branch; the commit must stay reachable, ordinary/non-merge, and stable through the confirmation; active merge/rebase/cherry-pick/revert, `commit.gpgSign=true`, path magic/traversal, symlinks, submodules, and renames are refused.
- A directory expands only to captured Commit-files under its literal `dir/` prefix. Rebase conflicts remain active for Status recovery; LGVS never auto-aborts. Success clears the stale Commit-files preview and returns to top-level Commits at the previous clamped index rather than claiming the old hash remains previewable.
- This `d` is scoped only to Commit-files; top-level Commits retains configured `universal.remove` Drop, while Files and HUNK/LINE retain their existing discard behavior. Visual-range commit-files, active-rebase todo editing, dirty-tree auto-stash, generic rebase UI, patch mode, and external diff remain gaps.

## Stash

- `<space>`: Apply.
- `g`: Pop.
- `d`: Drop.
- `n`: New branch.
- `r`: Rename stash.
- `<enter>`: View files.

## Tags

- `<space>`: Checkout tag detached.
- `n`: New tag from current commit.
- `d`: Delete options.
- `P`: Push tag.
- `g`: Reset options.
- `<enter>`: View commits.

## Remotes

- `<enter>`: View branches.
- `n`: New remote.
- `d`: Remove.
- `e`: Edit name or URL.
- `f`: Fetch selected remote directly.
- `F`: Add fork remote.

## Known LGVS parity gaps to close

- Canonical audited claims live in `docs/lazygit-parity-ledger.json`; CI rejects duplicate, stale, and contradictory rows.
- Branch `<enter>` now matches upstream: it views commits for the selected branch.
- Commits has **partial C/V/reset cherry-pick parity**: range copy/toggle, source-repository isolation, cancellation retention, and configured reset are covered for clean working trees and non-merge commits. Auto-stash, merge `-m 1`, Git-version empty-commit flags, and broad range parity remain gaps; this must not be read as full upstream cherry-pick parity.
- Commits has **partial Drop parity** through configured `universal.remove`: it covers only clean attached-current-branch ordinary commit/range removal with a private interactive-rebase todo editor and leaves conflicts for Status recovery. Full merge Drop, Drop during an active rebase, and dirty-worktree auto-stash remain gaps; this must not be read as full upstream Drop parity.
- Commits has **partial Squash-down parity** through configured `keybinding.commits.squashDown`: it covers only clean attached-current-branch ordinary commit/range squashing into the commit immediately below through the same private todo editor, leaving conflicts for Status recovery. Active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, and broader rebase UI remain gaps; this must not be read as full upstream Squash parity.
- Commits has **partial Fixup parity** through configured `keybinding.commits.markCommitAsFixup`: it covers only clean attached-current-branch ordinary commit/range fixup into the commit below through the exact `Fixup` f/c menu and shared private todo editor, leaving conflicts for Status recovery. Active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, and broader rebase UI remain gaps; bounded autosquash `S` is documented separately. This must not be read as full upstream Fixup parity.
- Commits has **partial Edit parity** through configured `universal.edit`: it starts a real interactive rebase immediately for the current ordinary commit or contiguous visible range and deliberately leaves the selected `edit` stop(s) active for normal Files/amend plus Status continue/abort recovery. Active-todo editing, merges, dirty-tree auto-stash, generic `i`, move, and full rebase UI remain gaps; this must not be read as full upstream Edit parity.
- Several branch/commit/tag options are implemented as simplified direct Git commands rather than lazygit option menus.
- File tree `-`/`=` collapse/expand and some filter/sort/worktree flows are incomplete.

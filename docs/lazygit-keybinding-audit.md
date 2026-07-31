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
- `r`: Reword.
- `R`: Reword with editor.
- `d` (configured `universal.remove`): **partial Drop parity** for the selected ordinary single commit or visible range in the top-level Commits list. It confirms, revalidates, and uses a private interactive-rebase sequence editor; it rejects dirty trees, active operations, detached/mismatched branch views, merge commits, unreachable commits, and a sole root rather than approximating full upstream Drop.
- `e`: Edit/start interactive rebase.
- `i`: Start interactive rebase.
- `F`: Create fixup commit.
- `S`: Apply fixup commits.
- `A`: Amend.
- `a`: Amend commit attribute.
- `t`: Revert.
- `T`: Tag commit.
- `<c-l>`: View log options.

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
- Commits has **partial Fixup parity** through configured `keybinding.commits.markCommitAsFixup`: it covers only clean attached-current-branch ordinary commit/range fixup into the commit immediately below through the exact `Fixup` f/c menu and shared private todo editor, leaving conflicts for Status recovery. Active-rebase todo edits, selected merge handling, dirty-worktree auto-stash, autosquash `S`, and broader rebase UI remain gaps; this must not be read as full upstream Fixup parity.
- Several branch/commit/tag options are implemented as simplified direct Git commands rather than lazygit option menus.
- File tree `-`/`=` collapse/expand and some filter/sort/worktree flows are incomplete.

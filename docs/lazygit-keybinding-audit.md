# LazyGit keybinding parity audit

Source: upstream lazygit `docs/keybindings/Keybindings_en.md` from `jesseduffield/lazygit` at `608c90a`.

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
- `C`: Copy for cherry-pick. It is not immediate cherry-pick.
- `V`: Paste/cherry-pick copied commits.
- `p`: Pick only when mid-rebase.
- `s`: Squash.
- `f`: Fixup.
- `c`: Set fixup message.
- `r`: Reword.
- `R`: Reword with editor.
- `d`: Drop.
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

- Branch `<enter>` is still not true lazygit parity: upstream views commits for the selected branch.
- Commit `C` should mark/copy for later paste; LGVS currently cherry-picks directly.
- Several branch/commit/tag options are implemented as simplified direct Git commands rather than lazygit option menus.
- File tree `-`/`=` collapse/expand and some filter/sort/worktree flows are incomplete.

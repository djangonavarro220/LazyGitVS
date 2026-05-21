# LazyGitVS parity gap report

Generated from current `src/extension.ts` versus `docs/lazygit-parity-audit.md`.

## Current parity that is already usable
- Config read LG_CONFIG_FILE/defaults
- Typed QuickPick key execution
- Files status filter
- Panel text search
- Hunk mode
- Line mode basic
- Conflicts ours/theirs/mark resolved
- Branch checkout/new/delete/rename/merge/rebase/upstream
- Commit show/reword/amend/fixup/cherry-pick/reset
- Stash apply/pop/drop/rename

## Main remaining gaps

### Global
- Status: Not implemented
- Gap: Recent repos, command log, diffing menu, patch menu, merge/rebase menu, undo/redo, rename similarity/diff context toggles

### Status
- Status: Mostly missing
- Gap: Open/edit config file, update check, all-branch log graph, focus main view

### Files
- Status: Partial
- Gap: Copy path/info, ignore/exclude, fetch key, tree view/collapse/expand, external difftool, upstream reset on g, commit without hook/editor/fixup finder

### Main/Hunk
- Status: Partial
- Gap: True robust line patch editing, range select, edit hunk, commit flows from hunk mode

### Branches
- Status: Partial
- Gap: PR actions, git-flow, fast-forward, tags, sort order, worktrees, checkout by name, force checkout, remote checkout modes

### Commits
- Status: Partial
- Gap: Squash/drop/edit interactive rebase, move commits, autosquash, tag, revert, copy attrs, open browser, new branch off commit, log options, paste copied commits

### Stash
- Status: Partial
- Gap: New branch from stash, worktree options, view files flow

### Missing panels
- Status: Not implemented
- Gap: Tags, remotes, reflog, submodules, worktrees, commit files/sub-commits, secondary panels

### Config
- Status: Partial
- Gap: Most gui/git/customCommands/theme fields are not applied yet; only keybindings are used

### Text/i18n
- Status: Partial
- Gap: Labels approximate English, not resolved from lazygit i18n constants

## Recommended implementation order

1. Create a real command registry/catalog so help, QuickPick entries, and handlers all come from one source.
2. Replace remaining hand-written help strings with generated lazygit-style options map.
3. Implement Files quick wins: copy path/info, ignore/exclude, fetch, tree-ish visual grouping, commit-without-hook/editor.
4. Implement Status actions: open/edit config and all-branch log graph.
5. Implement Commit panel safe actions: revert, tag, new branch off commit, checkout commit, copy attrs.
6. Implement Branch safe actions: checkout by name, previous branch, force checkout, fast-forward, sort order.
7. Add missing panels only after core panels feel right: tags, remotes, reflog, submodules, worktrees.
8. Resolve lazygit i18n labels into a small local translation map instead of inventing labels.
9. Add config support beyond keybindings: gui.showFileTree, gui.showPanelJumps, gui.showBottomLine, git.diffContextSize, git.ignoreWhitespaceInDiffView.
10. Dogfood in VS Code and fix visual/focus/status-bar issues.

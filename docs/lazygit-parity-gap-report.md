# LazyGitVS parity gap report

Tracked, committed parity status against upstream lazygit. Keep this file updated whenever a parity gap is closed or a new mismatch is found. Vibes are not a tracking system.

Last reviewed after commit `e432187 feat: close next lazygit parity gaps`.

## Done / usable parity

### Core plumbing
- [x] Reads lazygit config from `LG_CONFIG_FILE` / default locations.
- [x] Merges lazygit keybindings over internal defaults read-only.
- [x] Uses real lazygit config key names for important keys such as `pushFiles`, `pullFiles`, `files.copyFileInfoToClipboard`.
- [x] Printable key matching is case-sensitive; bracket/chord keys normalize safely.
- [x] Typed QuickPick key execution.
- [x] Shared command registry for contextual help, QuickPick entries, and typed panel actions.
- [x] CSP + script nonce for webviews.

### Navigation / panels
- [x] LazyGit-style numbered panels: Status, Files, Branches, Commits, Stash, Conflicts, Tags, Remotes.
- [x] `j/k`, arrows, page movement, top/bottom movement.
- [x] `/` panel text search.
- [x] `<tab>` / block movement between panels.
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
- [x] Branch `<enter>` views commits for selected branch.

### Commits
- [x] Show commit patch/stat preview.
- [x] `<enter>` drills into commit files.
- [x] Commit-file patch preview.
- [x] Copy commit attribute menu.
- [x] Checkout commit detached.
- [x] New branch off commit.
- [x] Reword HEAD commit.
- [x] Amend HEAD with staged changes.
- [x] Create fixup commit.
- [x] Mark fixup target.
- [x] `C` copies commit for later cherry-pick.
- [x] `V` pastes/cherry-picks copied commits.
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

## Remaining gaps

### Global workflows
- [ ] `z` / `Z` undo/redo via reflog.
- [ ] `@` command log options and command log focus.
- [ ] `:` execute shell command prompt.
- [ ] `<ctrl+p>` custom patch options.
- [ ] `m` merge/rebase options menu: continue / abort / skip.
- [ ] `+`, `_`, `|` screen/pager modes.
- [ ] `<ctrl+r>` should eventually match lazygit recent repos history, not just VS Code workspace repo picker.
- [ ] `<ctrl+z>` suspend app is intentionally not meaningful in VS Code; document/ignore as VS Code-native exception.

### Operation state machine
- [ ] Model merge/rebase/cherry-pick/bisect in-progress states.
- [ ] Show state-specific rows/actions.
- [ ] Continue / abort / skip workflows.
- [ ] Conflict follow-up prompts matching lazygit.

### Files gaps
- [ ] Upstream reset options on Files `g`.
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
- [ ] Squash down `s`.
- [ ] Autosquash/apply fixups `S`.
- [ ] Drop commit `d`.
- [ ] Edit/start interactive rebase `e`.
- [ ] Start interactive rebase `i`.
- [ ] Pick commit during rebase `p`.
- [ ] Move commit down/up `<ctrl+j>` / `<ctrl+k>`.
- [ ] Mark base for rebase `B`.
- [ ] Amend commit attribute `a`.
- [ ] Open pull request in browser `G`.
- [ ] Move commits to new branch `N`.
- [ ] Reset copied cherry-pick selection `<ctrl+r>`.
- [ ] Select commits of current branch `*`.
- [ ] Worktree options `w`.
- [ ] External difftool `<ctrl+t>`.
- [ ] Reword/amend selected non-HEAD commit via rebase; current implementation is mostly HEAD-safe only.

### Commit files gaps
- [ ] Checkout file from commit `c`.
- [ ] Discard this commit's changes to file `d` via interactive rebase flow.
- [ ] Copy path / copy file info exact menu.
- [ ] Commit-file custom patch include/exclude.
- [ ] Commit-file tree collapse/expand parity.
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
- [ ] Add `aria-activedescendant` and stable row ids.
- [ ] Keyboard focus announcement polish.
- [ ] Virtualization should eventually preserve scroll position and not just trim HTML around active row.
- [ ] Large-repo profiling and refresh throttling beyond current basic refresh guards.

## Recommended next order

1. Operation state machine for merge/rebase/cherry-pick/bisect.
2. Undo/redo via reflog.
3. Commit workflows: squash/drop/edit/rebase/move/autosquash.
4. Files missing keys: `g`, `<ctrl+f>`, `<ctrl+t>`, `M`.
5. Worktrees/Reflog/Submodules panels.
6. Custom commands/custom pagers, late and sandboxed. This is useful but sharp.
7. i18n/options-map label cleanup.
8. VS Code command surface expansion.

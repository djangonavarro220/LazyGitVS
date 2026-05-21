# LazyGitVS deep missing-parity research

Scope: upstream lazygit docs/source in `_research/lazygit` versus current LGVS 0.1.9. This goes beyond points 14, 15 and 16 (dogfooding, release polish, Marketplace) and lists what still separates LGVS from “lazygit adapted properly to VS Code”.

## Upstream surface area

Lazygit is much wider than the LGVS core spine. Upstream keybinding docs expose these sections:

- Global keybindings: 27
- List panel navigation: 12
- Status: 7
- Files: 28
- Main panel normal/staging/merging/patch building: 44 total
- Local branches: 26
- Remote branches: 14
- Commits: 37
- Commit files / sub-commits / commit summary: 32 total
- Stash: 9
- Remotes: 7
- Reflog: 15
- Submodules: 9
- Tags: 11
- Worktrees: 5
- Menu / confirmation / input / secondary: 10

LGVS currently covers the core spine only: Status, Files, Hunk/Main, Branches, Commits, Stash, Conflicts.

## Missing or weak areas found

### 1. Command catalog / options map
- Status: Missing architecturally.
- LGVS still has many actions scattered through webview messages and hand-built menus.
- Lazygit has an options map model: key, description, context, handler.
- This should become one LGVS command registry that generates help, QuickPick labels, handlers and VS Code command IDs.

### 2. Config beyond keybindings
- Status: Mostly missing.
- Currently LGVS reads lazygit keybindings, but not most behavior config.
- Important missing config:
  - `gui.showFileTree`
  - `gui.showPanelJumps`
  - `gui.showBottomLine`
  - `gui.splitDiff`
  - `gui.mainPanelSplitMode`
  - `gui.sidePanelWidth`
  - `gui.scrollOffMargin`
  - `gui.scrollOffBehavior`
  - `git.diffContextSize`
  - `git.ignoreWhitespaceInDiffView`
  - `git.renameSimilarityThreshold`
  - `git.skipHookPrefix`
  - `git.commitPrefix`
  - `git.branchPrefix`
  - `git.autoFetch`
  - `git.overrideGpg`
  - `git.allBranchesLogCmds`
  - `os.openCommand`
  - `os.openLinkCommand`
  - `os.editPreset`
  - `customCommands`
  - `customPagers`

### 3. Recent repositories / repository picker
- Status: Missing.
- Lazygit can switch recent repos.
- LGVS assumes first VS Code workspace folder.
- For VS Code this should become a repo/workspace picker, including multi-root support.

### 4. Command log panel
- Status: Missing.
- Lazygit has command log options.
- LGVS hides Git CLI execution; good UX, but no command history/debug surface.
- Need an optional output/log panel, not spammy debug files. Debug logs in repo were rightly killed; this should be clean.

### 5. Diffing menu
- Status: Missing/very partial.
- Lazygit supports diff against selected ref, manual ref, reverse direction, whitespace toggles, context size and custom pagers.
- LGVS mostly opens HEAD vs working tree or simple commit diff.

### 6. Custom patch builder
- Status: Missing.
- Lazygit has patch building and patch explorer modes.
- LGVS has hunk/line staging, but not “build patch across commits/files/hunks”.
- Do after hunk/line mode is robust, not before.

### 7. Range select and multi-select
- Status: Missing.
- Lazygit list panels support range select.
- LGVS selects one row only.
- Needed for batch branch/stash/commit/file operations.

### 8. Operation state machine
- Status: Missing/partial.
- Lazygit models merge, rebase, cherry-pick, bisect and patch-building states.
- LGVS has conflict actions, but not a full state machine with continue, abort, skip and status rows.

### 9. Undo/redo via reflog
- Status: Missing.
- Lazygit supports undo/redo for git commands via reflog.
- LGVS has destructive confirmations, but no undo flow.
- This is a major “feels like lazygit” gap.

### 10. Missing panels
- Status: Missing.
- Not implemented as first-class panels:
  - Tags
  - Remotes
  - Reflog
  - Submodules
  - Worktrees
  - Commit files
  - Sub-commits
  - Secondary panel concepts

### 11. Branch workflows
- Status: Partial.
- LGVS has checkout/new/delete/rename/merge/rebase/upstream basics.
- Missing or weak:
  - sort order
  - remote branch checkout modes
  - checkout by name polish
  - force checkout safety UX
  - fast-forward exact flow
  - PR create/open/copy URL
  - git-flow options
  - worktree options
  - tags from branch context

### 12. Commit workflows
- Status: Partial.
- LGVS has show/reword/amend/fixup/cherry-pick/reset/revert/tag/new branch basics.
- Missing or weak:
  - squash down
  - drop via interactive rebase
  - edit commit via interactive rebase
  - autosquash/apply fixups
  - move commit up/down
  - copy/paste cherry-pick selection
  - copy commit attributes menu
  - open commit/PR in browser
  - log options
  - commit files drill-down

### 13. Stash workflows
- Status: Partial.
- LGVS has apply/pop/drop/rename/new branch basics.
- Missing or weak:
  - view stash files like lazygit
  - worktree options
  - exact stash branch behavior/error handling
  - range/batch actions

### 14. Files workflow
- Status: Partial.
- LGVS has stage, stage all, discard, stash, filter, ignore/exclude basics.
- Missing or weak:
  - file tree mode, collapse and expand
  - copy path vs copy file info menu
  - external difftool
  - commit without hook
  - commit with editor
  - find base commit for fixup
  - upstream reset key `g` exact behavior
  - submodule-specific discard menus
  - binary/rename/submodule rows

### 15. Hunk and line mode robustness
- Status: Basic.
- LGVS has hunk and simple line staging.
- Missing or risky:
  - complex hunks can fail
  - no range selection
  - edit hunk
  - no binary/submodule handling
  - no no-context diff support
  - no clear recovery if `git apply` fails

### 16. Search and filtering
- Status: Basic.
- LGVS has text search and files status filter.
- Missing:
  - search navigation next/prev
  - search in diff body
  - commit log filtering menu
  - filter persistence/radio state exactly like lazygit

### 17. Custom commands and prompts
- Status: Missing.
- Lazygit supports user-defined commands, prompts, loading files as env vars, output behavior, stream output, subprocesses.
- Powerful, but security-sensitive. Implement late and sandbox carefully.

### 18. External tools
- Status: Missing.
- Lazygit honors difftool, mergetool, open command and edit preset.
- LGVS should adapt this to VS Code defaults first, then optionally invoke configured external tools.

### 19. Internationalization / text parity
- Status: Missing.
- LGVS labels are hand-written.
- Lazygit labels come from i18n strings.
- We need a local translation map for copied menus, otherwise text parity rots.

### 20. VS Code-native command surface
- Status: Weak.
- Many actions only exist inside the webview.
- For VS Code/VSpaceCode users, important actions should be contributed commands with scoped keybindings possible.

### 21. Accessibility
- Status: Weak.
- Current webview rows are visual `div`s.
- Need ARIA listbox/options, active descendant, clearer focus state, and better screen-reader labels.

### 22. Large repo performance
- Status: Unknown/risky.
- No virtualization.
- Periodic refresh can be expensive.
- Git log/status calls are simple but may hurt on big repos or monorepos.

### 23. Multi-root and bare/no-repo states
- Status: Weak.
- Current `workspaceRoot()` takes first folder.
- Need repo picker, no-repo state, nested repo detection and multi-root support.

### 24. Tests still missing
- Status: Partial.
- We have config/menu/git primitive tests.
- Missing tests:
  - hunk/line patch edge cases
  - binary/rename/submodule files
  - merge/rebase/cherry-pick state flows
  - multi-root repo selection
  - config reload and parse errors
  - UI message/keymap dispatch
  - packaged VSIX smoke test

## Recommended order after points 14, 15 and 16

1. Command catalog/options map.
2. Apply more config: `gui.*`, `git.*`, `os.*` basics.
3. Operation state machine: merge/rebase/cherry-pick/bisect continue/abort/skip.
4. Range select and multi-select.
5. Missing panels one by one: Tags, Remotes, Reflog, Submodules, Worktrees.
6. Commit workflow depth: squash, drop, autosquash, move commits, copy/paste cherry-pick.
7. Diffing menu and custom patch builder.
8. Custom commands and custom pagers.
9. Accessibility and large-repo performance pass.
10. Dogfood on Mac, then Marketplace.

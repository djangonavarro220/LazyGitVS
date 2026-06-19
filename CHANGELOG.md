# Changelog

All notable changes to LazyGitVS will be documented here.

## 0.1.101 - Repository pending-change counts

- `1 Status` repository rows now show each repository's pending file/change count, making dirty repos visible before switching.
- The repository picker also shows the same dirty/clean count so keyboard switching has the same signal.
- Dogfood now verifies the Status repo list shows `1 change`/`3 changes` counts across root, sibling, and scan-depth nested repos.

## 0.1.100 - SCM repository scan depth

- `1 Status` repository switching now uses VS Code Git's repository model first, matching the native SCM view when multiple repositories are open.
- Fallback nested repository discovery now honors VS Code Git's `git.repositoryScanMaxDepth` and `git.repositoryScanIgnoredFolders` settings instead of scanning every nested `.git` directory.
- Dogfood now covers selecting a nested repository found through the native scan-depth setting and verifies `2 Files` switches to that repository.

## 0.1.99 - Compact commit rows and parity doubts

- Commits panel rows now stay compact on one line without visible ref chips eating the subject in narrow SCM sidebars.
- Commit refs remain available in row metadata/tooltips instead of stealing layout width.
- Tracks uncertain lazygit parity for Branches `Enter` and commit-file `Enter` flows so they get re-audited before being treated as done.

## 0.1.98 - Folder staging and HUNK escape polish

- Files tree directory rows now support `Space` to stage/unstage all changed files under the selected folder.
- Folder staging is scoped to the selected directory path; it does not fall back to repo-wide `git add -A`.
- `Esc` from editor HUNK/LINE mode restores the visual selection in `2 Files` to the opened file instead of leaving a ghost focus state.

## 0.1.97 - README screenshot and default panel layout

- `1 Status` now defaults collapsed while the main LGVS panels open visibly in the SCM sidebar.
- Opens on `2 Files` by default so the sidebar shows the useful workflow immediately.
- Updates the README/Marketplace hero screenshot with the full VS Code window and editor HUNK mode.
- Files panel short-status letters are back in compact colored square badges so staged/unstaged colors remain visible on selected rows.
- File path text stays normal foreground; only the status boxes carry Git color.

## 0.1.96 - Release editor keys outside HUNK/LINE

- Removed broad LGVS numeric editor keybindings so normal VS Code/VSCodeVim editing owns the editor outside HUNK/LINE mode.
- Panel number jumps still work from LGVS viewer focus and editor HUNK/LINE mode, but no longer steal keys in normal editor EDIT mode.

## 0.1.95 - Compact file status letters

- Files panel short-status letters now render as a compact `MM`-style text block instead of spaced-out floating columns.
- Selected rows let the status text use the selection foreground for readability; staged/unstaged meaning remains visible via the row rail and unselected Git colors.

## 0.1.94 - Flat file status letters

- Files panel short-status letters now render flat like VS Code SCM text, without pill/circular badge backgrounds.
- Selected file rows keep staged/index green and unstaged/worktree red on the original `M`, `A`, `?`, etc. letters.

## 0.1.93 - Lazygit file status badges

- Files panel badges now render lazygit's original two-column Git short status letters (`M`, `A`, `?`, etc.) instead of LGVS-specific `S`/`U` labels.
- Keeps index/staged and worktree/unstaged columns fixed and colored separately for quick scanning.

## 0.1.91 - High-contrast generated logo

- Uses the selected generated logo option 2 as the project logo source (`resources/logo.png`).
- Replaces the VS Code extension icon with a resized 128x128 high-contrast icon.
- Optimizes the icon for Marketplace cards and VS Code extension-list visibility.

## 0.1.90 - Final logo

- Uses selected logo candidate 1 as the project logo source (`resources/logo.png`).
- Replaces the VS Code extension icon with the resized 128x128 Marketplace/VSIX icon.
- Keeps the full-size source out of the VSIX; only the runtime icon ships.

## 0.1.89 - Avoid original SCM focus flash on panel jumps

- Panel jumps no longer refocus the whole SCM container when an LGVS view is already visible.
- This avoids the remaining flash where VS Code briefly selected its built-in Source Control view before landing on `1 Status`.

## 0.1.88 - Stop panel-jump Quick Open flicker

- Removes the `workbench.action.openView` call from LGVS panel jumps; VS Code was briefly flashing the Open View / command-palette picker while switching panels.
- Keeps the safer native path: SCM sidebar + contributed WebviewView show/focus.

## 0.1.87 - Status workspace repository switcher

- `1 Status` now mirrors lazygit original repo switching: `Enter` opens a `Recent repositories` picker.
- Discovers Git repositories from VS Code workspace roots and nested `.git/HEAD` repos, then switches LGVS Git commands to the selected repo.
- Shows the active repo in Status so the target is not mystery meat.

## 0.1.86 - Release documentation and native scroll bug note

- Updates release docs to match the actual package scripts, current version, and Syncthing/local build flow.
- Documents the native VS Code SCM sidebar scroll limitation as a known bug: numeric jumps can select `7 Tags` / `8 Remotes`, but cramped sidebars may not visibly scroll those collapsed native views into sight.
- Keeps `0.1.85` marked as a rejected owned-scroll experiment, not the release path.

## 0.1.85 - Rejected owned-scroll experiment

- Tried replacing the separate native SCM views with one owned-scroll LGVS webview to control deep-panel scrolling.
- Rejected and rolled back: it regressed the accepted native-panel UX and made the sidebar feel less like VS Code.
- Do not ship this path without a fresh explicit UX decision.

## 0.1.84 - Revert fake deep-panel reveal hacks

- Restores the real multi-panel SCM layout: all LGVS panels stay contributed instead of hiding everything except the active panel.
- Removes the bad “make room” path that focused/collapsed/scrolled unrelated Source Control UI and even resized views. That was garbage.
- Keeps numeric panel selection state, but native sidebar scroll-to-view is still constrained by VS Code’s public API.

## 0.1.83 - Deep-panel reveal attempt

- Attempted to reveal `7 Tags` / `8 Remotes` from numeric jumps in cramped SCM sidebars.
- This approach was rejected: it made screenshots misleading and did not use VS Code’s native focus/Tab behavior correctly.

## 0.1.82 - Native Tab-style panel scroll

- Panel jumps now remember the previous native panel and invoke VS Code's `nextSideBarView` / `previousSideBarView` path before refocusing LGVS.
- This applies to every numeric panel jump `1–8`; no special casing for deep panels.

## 0.1.81 - Syncthing build output and all-panel native reveal

- `npm run package` now writes VSIX builds to `../releases/LazyGitVS` through `LGVS_VSIX_OUT_DIR`.
- Added `npm run build` as compile + package, so the normal build leaves the installer in Syncthing releases.
- Native reveal/focus path is the shared panel-jump path for all panels, not just `7 Tags` / `8 Remotes`.

## 0.1.80 - Native reveal attempt for deep panels

- Numeric jumps to `7 Tags` / `8 Remotes` now run VS Code's native view reveal/focus path after rendering.
- Temporarily suppresses LGVS webview autofocus so VS Code has a chance to keep focus on the native panel/header instead of stealing it back into the webview.
- Adds a regression guard for this native-panel focus path.

## 0.1.79 - Split nearby hunk blocks

- HUNK navigation now uses zero-context diffs so nearby edit blocks stay separate.
- Staging/unstaging a selected hunk only applies that block, not every nearby block Git merged into one default diff hunk.
- Dogfood now covers the two-close-hunks case with visual evidence.

## 0.1.78 - Clear Files selection when viewer owns focus

- When focus moves to the hunk/main viewer, panel 2 keeps context but drops the active file selection.
- Repaints the sidebar immediately on `0`, open-diff, and edit transitions so the blue row only means “LG panel owns focus”.

## 0.1.77 - Remove noisy focus footer

- Removes the `Focus: LG panel` footer from sidebar panels.
- Keeps focus tracking internally/status-bar only; the SCM panel no longer wastes vertical space on obvious debug-ish text.

## 0.1.76 - Clean Files status badges

- Files rows now show explicit `S`/`U` lane badges instead of ambiguous `M M` porcelain.
- Removes the clipped `staged + unstaged` / `unstaged` meta text from the narrow SCM row.
- Keeps staged/unstaged detail in the tooltip, not smeared over the filename like a bad sticker.

## 0.1.75 - Hide panel selection when editor owns focus

- Only paints the active sidebar row while the LGVS panel actually owns focus.
- When focus moves to preview/HUNK/EDIT, the panel keeps context but drops the fake selection highlight.

## 0.1.74 - Dogfood HUNK/LINE with and without Vim

- Runs the UI dogfood HUNK/LINE flow twice by default: no Vim extension and VSCodeVim installed.
- Keeps separate per-variant reports and screenshots under `dogfood-output/`.
- Covers the focus/keybinding fight where VSCodeVim eats editor keys. Because of course that is where bugs breed.

## 0.1.73 - Fix panel number jumps and focus marker

- Adds registered `1`-`8` panel focus commands so number jumps work from LG panels, file previews, and editor HUNK mode.
- Tracks LG panel vs file viewer/editor focus in VS Code context keys.
- Shows the current focus lane in the LGVS status line/footer instead of making users guess. Novel concept.

## 0.1.72 - Prepare public CI and light-theme dogfood

- Removes host-specific build paths from public docs/agent instructions.
- Adds portable VSIX packaging to `dist/` with environment overrides for private local builds.
- Adds GitHub Actions CI for install, tests, dogfood, package, and VSIX artifact upload.
- Makes UI dogfood run in a light theme by default and broadens the fixture with branch/tag/remote/stash coverage.

## 0.1.71 - Dogfood-gated virtual previews

- Preview text now uses a readonly `lazygitvs-preview:` `TextDocumentContentProvider` instead of `Untitled-*` buffers.
- Adds a static regression test for virtual previews.
- Extends the UI dogfood harness to fail if preview tabs regress to `Untitled-*`.
- Documents that LGVS UI/focus changes must run dogfood before release.

## 0.1.70 - Add real UI dogfood harness

- Adds `npm run dogfood:ui`, a CDP-driven VS Code Extension Host dogfood run with screenshots and Git-state assertions.
- Documents UI dogfooding in `docs/dogfooding-ui.md`.
- Strips ANSI escape sequences from preview text so Branches no longer renders colored `git log` garbage in VS Code.

## 0.1.69 - Force robust LINE apply

- LINE-mode line patches now always use `--unidiff-zero`, for both `U → S` and `S → U`.
- Adds a regression proving both directions work on `settings.json`-style adjacent replacements.

## 0.1.68 - Fix staged LINE unstage on adjacent replacements

- LINE mode now pairs grouped `-old`/`+new` replacement blocks by ordinal, not only adjacent rows.
- Staged `S → U` line patches from zero-context/dense JSON hunks now apply with the right `--unidiff-zero` fallback.
- Adds a regression for adjacent replacements in `settings.json`-style files.

## 0.1.67 - Tighten Branches/Commits main-pane parity

- `3 Branches` keeps lazygit semantics: moving previews the branch log, `Space` checks out, and `Enter` no longer pretends to drill into commits.
- Adds lazygit `0` main-view focus for the right/log/patch preview.
- Returning from commit-file view restores the selected commit patch preview; Backspace handles sidebar back without stealing Escape from editor/Vim modes.

## 0.1.66 - Prevent staged overlays on unstaged lines

- Staged editor decorations now exclude lines that still have unstaged working-tree changes.
- This prevents the same visible editor lines from being marked `S` and `U` when toggling sides with `Tab`.

## 0.1.65 - Color staged vs unstaged editor hunks

- Editor HUNK/LINE decorations now use green for staged/index side and amber for unstaged/worktree side.
- This makes `Tab` side switches explicit when the same file has overlapping staged and unstaged hunks.

## 0.1.64 - Fix LINE mode selection after staging changes

- LINE mode now treats `-old`/`+new` replacement pairs as one selectable editor line instead of two diff rows.
- After staging/unstaging a line, LGVS reselects the nearest remaining editor line so the selector does not drift downward/stale.

## 0.1.63 - Fix HUNK line staging patches and line selection

- Removes the bogus trailing blank diff line LGVS added to parsed hunk patches; this fixed `patch does not apply` when staging/unstaging nearby staged + unstaged edits.
- In LINE mode, only the selected changed editor line gets the active selection; the whole hunk no longer looks selected.

## 0.1.62 - Stop VSCodeVim Tab stealing in HUNK mode

- While LGVS owns editor HUNK/LINE mode, it now suppresses VSCodeVim key capture so `Tab` reaches LGVS.
- Restores Vim capture when leaving HUNK mode / entering EDIT mode.
- Adds a small `extension.vim_tab` shim only when VSCodeVim is absent, covering stale VS Code keybinding state after uninstall.

## 0.1.61 - Mirror VSCodeVim Tab binding exactly

- Changes the LGVS editor `Tab` binding to mirror VSCodeVim's own `extension.vim_tab` context, plus `lazygitvs.editorHunkMode`.
- Does the same for `Ctrl+I` against VSCodeVim's `extension.vim_ctrl+i` context.
- Keeps the plain non-Vim `Tab` binding for normal VS Code.

## 0.1.60 - Make editor Tab survive VSCodeVim

- Adds explicit VSCodeVim Normal/Visual `Tab` bindings for editor HUNK/LINE side toggle.
- Adds `Ctrl+I` as the same side toggle because some paths deliver Tab as `^I`.
- Adds missing activation events for editor HUNK side/mode/discard commands.

## 0.1.59 - Make Tab staged/unstaged visible

- Confirms `Tab` is the right lazygit key for toggling staged/unstaged in HUNK/LINE mode.
- Repaints sidebar/footer after editor `Tab`, so the side change is visible immediately.
- Shows `Staged changes: none` / `Unstaged changes: none` when the target side has no hunks.

## 0.1.58 - Fix LINE space on zero-context hunks

- Fixes `space` in editor HUNK/LINE mode for pure add/delete hunks generated with zero diff context.
- Preserves `,0` hunk ranges instead of lying with `,1`, because Git is not amused by fake ranges.
- Adds `--unidiff-zero` only when the patch actually needs it.

## 0.1.57 - Match lazygit Branches/Commits preview flow

- `3 Branches` now previews the selected branch log in the editor/main pane using lazygit's `git.branchLogCmd` shape.
- `4 Commits` now previews the selected commit patch while moving, and `Enter` opens the commit-file list with the first file patch previewed.
- Branch `Enter` no longer opens a fake action menu; keyed actions stay on lazygit keys / `?` help.

## 0.1.56 - Fix editor HUNK help keybinding

- Maps editor HUNK/LINE help to valid VS Code chords for `?` (`shift+/` and Spanish-layout `shift+'`).
- Reverts the accidental preview-hunk setting change; Files preview stays plain unless real HUNK/LINE mode is active.

## 0.1.55 - HUNK help and preview highlights default on

- `?` now opens contextual HUNK/LINE commands while editor HUNK mode owns focus.
- `a` remains the lazygit toggle for HUNK ⇄ LINE mode.
- Restores `lazygitvs.showPreviewHunkDecorations` and defaults it to `true`; S/U gutter markers stay scoped to real HUNK/LINE mode.

## 0.1.54 - Match original lazygit preview/staging split

- Normal Files preview is just a diff preview, like lazygit's normal main panel.
- LGVS hunk selection/decorations now exist only in HUNK/LINE mode, matching lazygit's staging view.
- Removes the non-original `showPreviewHunkDecorations` setting added in 0.1.53.

## 0.1.53 - Hide hunk preview decorations outside HUNK mode

- Files preview no longer paints LGVS hunk selection or S/U gutter markers by default.
- Adds `lazygitvs.showPreviewHunkDecorations` for people who want preview hunk highlights outside HUNK/LINE mode.
- Keeps S/U gutter markers scoped to real LGVS HUNK/LINE mode.

## 0.1.52 - Scope Escape to LGVS HUNK/LINE

- `Esc` exits LGVS editor HUNK/LINE mode back to the LGVS Files panel.
- The sidebar/webview no longer steals `Esc`; normal VS Code/Vim behavior owns it outside LGVS HUNK/LINE.
- Adds a regression test for Escape keybinding scope.

## 0.1.51 - Stop breaking VSCodeVim typing

- Removes the global `type` command override; VSCodeVim normal mode can own typing again.
- Adds an explicit `e` keybinding/command for entering LGVS editor EDIT mode from HUNK mode.
- HUNK mode now reveals the active changed line, not the diff context/header line.

## 0.1.50 - Fix EDIT cursor and native panel reveal

- `e` from editor HUNK mode now places the cursor on the active changed line, not the hunk context header.
- Numeric panel jumps now use VS Code's generated `<viewId>.open` / `<viewId>.focus` commands with focus options instead of the generic `workbench.action.openView` attempt.

## 0.1.49 - Keep editor focus when leaving HUNK mode

- Prevents the Files webview from auto-focusing itself while editor HUNK/EDIT mode owns the workflow.
- Sets HUNK mode before rerendering the sidebar on `Enter`, so queued webview focus cannot steal focus back from the editor.
- Retries editor focus after `e` to survive VSCodeVim's delayed focus/mode handling.

## 0.1.48 - Compact sidebar panel jumps

- Keeps only `2 Files` expanded by default; noisy auxiliary panels default collapsed so the SCM sidebar is not a tower of LGVS panes.
- Numeric jumps now explicitly reveal/open the target SCM view before focusing it, so jumping to `8 Remotes` should scroll the sidebar there.

## 0.1.47 - Fix editor hunk command activation

- Activates LazyGitVS on VS Code startup so editor HUNK keybindings cannot hit unregistered commands.
- Moves the `U`/`S` gutter marker onto the active changed line instead of the diff-context header line.

## 0.1.46 - Tighten editor hunk highlight

- Files preview now paints the selected hunk/change in the opened editor instead of only opening the file.
- Editor HUNK mode highlights only changed lines, not the whole diff-context block.

## 0.1.45 - Fix returning from editor to Files preview

- Moving/selecting inside `2 Files` now forces list-preview mode if an editor HUNK/EDIT session was still active.
- This clears the stale editor-mode guard that blocked the right-side diff from changing after opening a file and returning to Files.

## 0.1.44 - Fix Files preview updates

- Restores the normal `vscode.diff` preview path so moving through `2 Files` changes the file on the right again.
- Reveals the first hunk after the diff editor opens, without passing fragile selection options into `vscode.diff`.

## 0.1.43 - Reveal first hunk in Files preview

- Moving through `2 Files` now opens the diff preview already scrolled to the first hunk of the selected file.
- Resets the internal hunk selection to the first hunk when changing file selection.

## 0.1.42 - Harden Hunk/Line mode

- Extracts hunk patch parsing/building into a tested pure module.
- Makes line staging preserve surrounding unselected changes as context, avoiding broken partial patches in dense hunks.
- Treats binary diffs as non-hunkable instead of exposing fake line actions.
- Adds hunk/line tests for multi-file diffs, dense line staging, binary diffs, and renamed text hunks.

## 0.1.41 - Add Remotes panel

- Adds a dedicated `8 Remotes` panel, appended without shifting existing lazygit-style jumps.
- Lists Git remotes with fetch/push URLs.
- Adds remote actions: fetch, add, edit URL, add fork remote, remove.

## 0.1.40 - 3. Start original panel parity

- Splits Tags out of the mixed Branches list into its own lazygit-style panel.
- Adds tag actions from original lazygit branch/tag semantics: checkout tag, create tag, branch from tag, push tag, delete tag.
- Keeps core lazygit jumps unchanged and appends Tags as `7 Tags` instead of shifting existing panels.

## 0.1.39 - Apply more original lazygit config

- Reads and applies `gui.fileTreeSortOrder` and `gui.fileTreeSortCaseSensitive` to Files ordering.
- Reads and applies `gui.wrapLinesInStagingView` and `gui.useHunkModeInStagingView` to Hunk/Line staging behavior.
- Reads and applies `git.renameSimilarityThreshold` to porcelain rename detection.
- Shows the active original-lazygit config values in Status.

## 0.1.38 - Finish command catalog pass

- Adds panel command catalogs for Status, Hunk, Branch, Stash, and Conflicts.
- Makes `?`, panel QuickPicks, and direct panel keys use the same catalog source.
- Fixes more panel-key leakage: Branch/Stash/Conflict keys now run their panel action before generic handlers.

## 0.1.37 - 3. Commits panel closer to lazygit

- Expands the lazygit commit key defaults from the upstream config audit.
- Commits `?` now uses a real command catalog instead of a grouped workaround menu.
- Commit panel direct keys now run commit actions first, so `<space>`, `y`, `g`, `t`, `T`, `n`, `o`, `F`, `C`, `A` behave like commit-panel commands instead of leaking Files actions.

## 0.1.36 - 2. Apply more lazygit git config

- Reads lazygit `git.diffContextSize` with default `3` and applies it to hunk/patch text generation.
- Reads `git.ignoreWhitespaceInDiffView` and applies it to textual commit/stash/diff views.
- Shows active git diff config in Status.

## 0.1.35 - 1. Files command catalog

- Starts the lazygit-style command catalog migration with Files panel contextual commands.
- Files `?` now gets its actions from one catalog instead of inline duplicated menu wiring.
- Keeps behavior and keys unchanged; this is plumbing for original-lazygit parity.

## 0.1.34 - Trim refresh races and package noise

- Guards preview refreshes so stale async Git updates cannot reopen previews after the user moved panel/file or entered editor mode.
- Extracts duplicated Status config/log menu items into one helper.
- Excludes sourcemaps and `tsconfig.json` from the VSIX.

## 0.1.33 - Stabilize editor and Files focus

- Pressing `e` from editor HUNK mode now keeps focus in the real file editor instead of letting the LGVS sidebar steal it back.
- Background refreshes no longer restore an older Files selection if the user has already moved to another file.
- The selected Files row scrolls into view after sidebar rerenders, avoiding jumpy top/previous-row focus.

## 0.1.32 - Restore lazygit index/worktree columns

- Keeps Files badges as two fixed lazygit-style columns: left = index/staged, right = worktree/unstaged.
- Empty sides reserve space but render invisible, so alignment stays correct without the ugly ghost badge.
- Keeps the compact no-`S`/`U` status letters from `0.1.31`.

## 0.1.31 - Simplify Files badges

- Removes the extra `S`/`U` letters from Files badges; the colored status letter carries the state.
- Removes the faint transparent empty badge for clean index/worktree sides.
- Tightens the Files status column again.

## 0.1.30 - Keep EDIT cursor on selected hunk

- Entering EDIT mode with `e` now leaves the cursor on the first line of the selected hunk.
- The hunk highlight still clears, so normal editing is clean but starts in the right place.

## 0.1.29 - Make selected Files badges readable

- Files badges now show explicit `S` and `U` prefixes instead of two ambiguous status letters.
- Selected rows keep green/red/yellow badge colors instead of washing everything to white.
- Widens the Files status column so staged/unstaged is visible in the SCM sidebar.

## 0.1.28 - Use one editor for HUNK and EDIT

- HUNK mode and normal EDIT mode now share the same file editor instead of leaving stale hunk highlights on another editor.
- Entering EDIT mode clears hunk decorations from all visible editors.
- While HUNK/EDIT mode is active, Files refresh/navigation no longer reopens the diff preview over the file.
- `e` enters normal EDIT typing; `Ctrl+Enter` returns to HUNK mode on the same file.

## 0.1.27 - Make Files staging state obvious

- Files panel now shows separate lazygit-style index/worktree badges: left = staged/index, right = unstaged/worktree.
- Uses VS Code Git colors: green staged, red unstaged, yellow untracked, blue mixed.
- Adds row color rails, tinted paths and compact state labels so staged vs unstaged is readable at a glance.

## 0.1.26 - Move HUNK marker to editor gutter

- Moves the active `S`/`U` staged/unstaged marker out of the text body and into the editor gutter beside breakpoints.
- Keeps hunk/line highlighting in the editor, but stops injecting marker text inside the code.

## 0.1.25 - Polish editor HUNK focus and edit mode

- HUNK/LINE navigation now wraps from bottom to top and top to bottom.
- Unknown printable keys are ignored in HUNK mode instead of editing the file.
- Adds explicit `e` edit mode to return to normal editor typing.
- Forces editor focus after entering HUNK mode from LGVS Files, including delayed refocus after VS Code steals focus.

## 0.1.24 - Fix editor HUNK typing capture

- Captures typed `j/k/space/a/d/q` while LGVS editor HUNK mode is active, so plain editor typing does not swallow navigation.
- Strengthens active hunk/line editor decorations so the selected hunk is visibly marked.
- Adds a compact Files status hint when editor HUNK mode starts.

## 0.1.23 - Commit/Stash files, richer branches, config parity

- Commit Enter now opens a navigable file list for the commit; Enter on a file shows its patch.
- Stash Enter now opens a navigable file list for the stash; Enter on a file shows its patch.
- Branches now include local, remote, tags and worktree refs with L/R/T/W markers.
- Lazygit config reader now also reads `git.*`, `customCommands`, `CONFIG_DIR`, and fails on missing `LG_CONFIG_FILE` paths like lazygit.

## 0.1.22 - Editor HUNK and LINE mode

- Adds real editor HUNK/LINE mode over the opened file.
- Adds editor decorations for active hunk, active line and staged/unstaged marker.
- Adds `a` for HUNK/LINE toggle, `tab` for staged/unstaged side, and `d` for discard/unstage.
- Makes `space` operate on hunk or line depending on the current editor mode.

## 0.1.21 - LazyGit navigation and file commit parity

- Adds lazygit-style page/top/bottom navigation: `,`, `.`, `<`, `>`, Home and End.
- Adds Files range selection with `v` and Shift+Up/Down; space stages/unstages the selected range.
- Wires Files `w`, `A`, and `C` to commit without hook, amend, and commit-with-body flows.
- Starts using loaded lazygit keybindings inside Branch, Commit and Stash action menus instead of fixed keys.

## 0.1.20 - Quit key and parity audit

- Makes `q` invoke LazyGitVS close from LGVS webviews and editor HUNK mode, not just when the webview JS happens to own focus.
- Close now exits LGVS editor HUNK mode before closing the sidebar.

## 0.1.19 - Open file instead of sidebar hunks

- Enter on Files keeps the SCM Files panel visible and opens the real file editor.
- LGVS still enables editor HUNK mode internally, but no longer swaps the Files panel into the sidebar hunk list.

## 0.1.18 - Branch and commit readability

- Shows branch origin explicitly as local/remote in the Branches panel.
- Uses tighter Branches/Commits-specific columns so commit messages stop getting crushed by refs.
- Compacts commit refs before rendering, instead of dumping long `HEAD -> ...` text into the sidebar.

## 0.1.17 - Contextual command help

- Removes obvious navigation from `?`: arrows, Enter, Esc, help itself, panel numbers, refresh/search and global basics.
- Keeps `?` focused on extra commands specific to the active panel.

## 0.1.16 - Compact sidebar rows

- Tightens row padding, cursor, status and metadata columns so narrow SCM panels waste less horizontal space.
- Reduces commit/branch/status truncation caused by oversized fixed columns.

## 0.1.15 - Editor HUNK mode

- Enter on Files opens the real file editor directly, not the staged/unstaged sidebar hunk list.
- Activates LGVS editor HUNK mode with j/k, arrows, space and Esc while the editor is focused.
- Shows `-- HUNK --` while editor HUNK mode is active. VSCodeVim does not expose a clean public API to replace its internal NORMAL label, so LGVS uses its own scoped mode/keybindings instead of patching Vim.

## 0.1.14 - LazyGit parity corrections

- Adds arrow-key navigation alongside j/k, matching lazygit list movement.
- Corrects Enter on commits: it now opens the selected commit details/files instead of the generic action menu.
- Esc clears the active filter first, like leaving lazygit filter/search, before backing out.
- Returns focus to LGVS after cancelling `?`/action QuickPicks.
- Uses VS Code native collapsed view state for Status and Branches by default instead of fake hidden rows. Runtime long-press-native-collapse is not exposed cleanly by VS Code, so that part is not faked.

## 0.1.13 - Focus and command help

- Fixes webview focus stealing between panels; only the active LGVS panel takes keyboard focus after render.
- Removes the bulky bottom keybinding footer.
- Adds `?` command help as a lazygit-style QuickPick: type a command key inside the picker to execute it.
- Improves selected-row contrast and row layout so status labels, branch names, commits and staged `M` remain readable.
- Tightens Files staging refresh so space can stage and unstage the currently selected file more predictably.
- Keeps focus in LGVS Hunk mode after Enter on a file instead of dumping you into Vim Normal mode.
- Adds collapsible/pinnable panels via long-press on panel numbers; Status and Branches start hidden.

## 0.1.12 - Navigation and click polish

- Restores the last LGVS panel and selection state across VS Code restarts.
- Adds mouse click selection and double-click/Enter-style action for rows.
- Fixes selection clamping against filtered lists so navigation does not point at invisible/missing items.
- Tightens row layout with fixed status/meta columns and better spacing for light themes.

## 0.1.11 - Status bar de-dupe

- Hide the LGVS VS Code status-bar mode by default to avoid duplicate `-- STATUS --` / `-- NORMAL --` labels with Vim/Neovim.
- Keep lazygit-style bottom help inside the sidebar driven by the original lazygit `gui.showBottomLine` setting.
- Add an opt-in `lazygitvs.showStatusBarMode` setting for users who do not run a Vim mode indicator.

## 0.1.10 - Lazygit GUI config

- Reads lazygit `gui.showBottomLine`, `gui.showPanelJumps`, and `gui.showFileTree` from the original lazygit config.
- Applies bottom help visibility, jump help visibility, and tree-ish file path display without creating duplicate LGVS settings.
- Added config tests for these GUI fields.

## 0.1.9 - Parity gap pass

- Added a lazygit parity gap report against the saved audit docs.
- Added safe parity quick wins: status config/log menu, Files copy/ignore/fetch, Branch checkout extras, Commit revert/tag/new-branch/checkout/copy, and Stash branch.

## 0.1.8 - Conflicts search and Git probes

- Added conflict actions: merge editor, ours, theirs, keep both/manual, mark resolved.
- Added panel search and Files status filtering.
- Added Git primitive tests for stage, stash, reset/nuke, and conflict resolution.
- Fixed unstaging newly-added files before the first commit.

## 0.1.7 - Core parity pass

- Tightened discard, reset, Files, Hunk, and basic Line mode behavior.
- Added upstream reset and cleaner status-bar ownership.
- Expanded Branch, Commit, and Stash action menus with lazygit-style keys.
- Help/footer continues to follow the loaded lazygit keymap.

## 0.1.6 - QuickPick key execution

- QuickPick menus can now execute an option by typing its lazygit key.
- Added tests for menu key resolution and key-prefixed labels.
- Kept keyboard matching case-sensitive for `s` versus `S`.

## 0.1.5 - Config module tests

- Extracted lazygit config/keymap loading into its own module.
- Added tests for YAML keybinding parsing and `LG_CONFIG_FILE` merge behavior.
- Kept tests out of the packaged VSIX.

## 0.1.4 - Lazygit menu keys

- Split lazygit stash behavior: `s` stashes all changes, `S` opens stash options.
- Added lazygit-style keys and Cancel row to core QuickPick menus.
- Aligned stash/discard/reset menu labels closer to lazygit.

## 0.1.3 - Lazygit config keymap

- Read lazygit `config.yml` / `LG_CONFIG_FILE` read-only and merge `keybinding.*` over lazygit defaults.
- Drive dashboard keys/help from that keymap instead of hardcoded LGVS controls.
- Align default push/pull keys with lazygit: `P` push, `p` pull.

## 0.1.2 - Mode and enter fix

- Reused the Vim status-bar slot for LGVS modes to avoid double mode labels.
- Fixed Enter from Files so it actually enters Hunk mode instead of bouncing back to Files.

## 0.1.1 - Visual polish

- Tightened SCM sidebar focus: only the active panel shows selection/help.
- Packaged as a new VSIX version instead of overwriting 0.1.0.

## 0.1.0 - Preview MVP

### Added

- SCM-sidebar LazyGitVS dashboard.
- Keyboard-first dashboard navigation.
- Numbered panels:
  - `1` Status
  - `2` Files
  - `3` Branches
  - `4` Commits
  - `5` Stash
  - `6` Conflicts
- Changed-files panel with stage/unstage.
- Hunk staging and unstaging.
- Native VS Code diff/editor preview.
- QuickPick menus for push, pull/fetch, stash, discard, reset, and nuke.
- Branch actions: checkout, create, delete.
- Commit actions: show, diff against parent, reset soft/hard.
- Stash actions: create, show, apply, pop, drop.
- Conflict list that opens files/diffs for VS Code-native resolution.
- `💣 Nuke working tree` action with explosion animation.

### Notes

- Preview release. Useful for dogfooding, not yet a polished marketplace-grade Git client.
- Destructive actions require confirmation.

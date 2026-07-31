# LazyGitVS

<p align="center">
  <img src="resources/icon.png" alt="LazyGitVS logo" width="128" />
</p>

<p align="center">
  <strong>lazygit muscle memory, inside the VS Code Source Control sidebar.</strong>
</p>

<p align="center">
  <a href="https://github.com/djangonavarro220/LazyGitVS/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/djangonavarro220/LazyGitVS/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=lazygitvs.lazygitvs"><img alt="VS Marketplace version" src="https://vsmarketplacebadges.dev/version-short/lazygitvs.lazygitvs.svg" /></a>
  <a href="https://github.com/djangonavarro220/LazyGitVS/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/djangonavarro220/LazyGitVS?include_prereleases" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

LazyGitVS is a keyboard-first Git workflow for VS Code, inspired by [lazygit](https://github.com/jesseduffield/lazygit).

It is **not** a terminal wrapper. It uses VS Code-native surfaces where they are better: SCM sidebar views, QuickPick menus, input boxes, native diffs, and real editors for hunk/line work.

<p align="center">
  <img src="docs/assets/readme-hunk-mode.png" alt="LazyGitVS showing compact SCM sidebar panels and editor HUNK mode in a full VS Code window" />
</p>

Current preview: **0.1.103**

## Why this exists

VS Code's built-in Git UI is solid, but it is mouse-heavy and fragmented when you live on the keyboard. Lazygit is fast, coherent, and memorable — but it lives outside the editor.

LazyGitVS brings the good part into VS Code:

- one Git cockpit in the SCM sidebar
- lazygit-style panel jumps and command keys
- native VS Code diffs/editors instead of a fake terminal pane
- hunk and line staging without leaving the file you are editing

Still preview software. Useful, dogfooded, improving fast. Not pretending to be a mature Git client yet — that would be cheap cosplay.

## Install

Marketplace:

[Install LazyGitVS](https://marketplace.visualstudio.com/items?itemName=lazygitvs.lazygitvs)

Or from VS Code:

```text
Extensions: Install Extensions
Search: LazyGitVS
```

From a downloaded VSIX:

```bash
code --install-extension lazygitvs-<version>.vsix --force
```

## Requirements

- VS Code `^1.90.0`
- Git on `PATH`
- A Git repository opened as the current workspace

## Open it

```text
Ctrl+Alt+G
```

That focuses LazyGitVS in the Source Control sidebar.

## Core workflow

### Panels

LazyGitVS keeps lazygit's numbered navigation, adapted to VS Code's SCM sidebar:

```text
1  Status
2  Files
3  Branches
4  Commits
5  Stash
6  Conflicts
7  Tags
8  Remotes
```

### Everyday keys

```text
1..8        Jump panels
j/k         Move selection
↑/↓         Move selection
Space       Toggle/action selected item
Enter       Main action
?           Contextual command menu
/           Search/filter
r           Refresh
z / Z       Undo / redo commit and branch actions via reflog
Esc         Clear filter / back
q           Close sidebar
```

### Files panel

```text
Space       Stage/unstage file
Enter       Open the real file and enter editor HUNK mode
v           Start/clear range selection
Shift+↑/↓   Extend range selection
F           File status filter
c           Commit
w           Commit without hook
A           Amend last commit
C           Commit with body
P           Push menu
p           Pull/fetch menu
s           Stash all
S           Stash options
d           Discard menu
g           Reset to @{upstream} (mixed / soft / hard)
D           Reset/nuke menu
```

`g` follows lazygit's `keybinding.commits.viewResetOptions` setting (default `g`) in Files. It opens `Reset to @{upstream}` with mixed, soft, and hard reset choices; every history reset asks for confirmation, and hard reset explicitly warns that index and working-tree changes are discarded.

### Commits panel

```text
b           View bisect options for the selected commit
v           Start/clear a sticky visual commit range
Shift+↑/↓   Create/extend a non-sticky visual commit range
d           Drop the selected ordinary commit/range after confirmation
C           Copy/toggle the selected commit range for cherry-pick
V           Confirm and paste copied commits oldest-first
Ctrl+R      Clear copied commits without changing Git
```

The key follows lazygit's `keybinding.commits.viewBisectOptions` setting (default `b`). The native `Bisect` picker offers only actions valid for the current Git bisect state and asks before resetting a bisect. Drop follows lazygit's configured `keybinding.universal.remove` (default `d`) only in the top-level Commits list; Files and HUNK/LINE keep their own `d` discard paths.

LazyGitVS has **partial Commits cherry-pick range parity**: `C` consumes the current selected range (or one commit), toggles a fully copied range off, and keeps de-duplicated hashes in the visible newest-first order. `V` asks `Are you sure you want to cherry-pick the N copied commit(s) onto this branch?`, then sends Git the same buffer oldest-first. `<ctrl+r>` follows `keybinding.commits.resetCherryPick` (default `<ctrl+r>`) and only clears the copied buffer; it does not invoke Git. Copy state records its source repository and list context, is cleared when switching repositories, and is rejected before any cross-repository paste.

LazyGitVS also has **partial Commits Drop parity**: the configured `universal.remove` key selects the current visible commit or visible range and asks `Are you sure you want to drop the selected commit(s)?` under **Drop commit**. It supports only ordinary, reachable non-merge commits on the clean attached checked-out branch, and does a second preflight after the modal before starting an interactive rebase. A root commit can be dropped only when descendants remain. Each run uses a private temporary sequence editor to mark exactly the selected `pick` rows as `drop`; it is deleted afterward. On a replay conflict LGVS leaves the rebase active, refreshes, and lets Status `m` / `c` / `a` / `s` own recovery.

This is deliberately bounded rather than full lazygit parity: a dirty target worktree (including staged, unstaged, or untracked changes), an active merge/rebase/cherry-pick/revert, detached HEAD, a different branch-scoped Commits view, merge commits, and the sole root commit are rejected before mutation. Full merge Drop, Drop while already rebasing, and dirty-worktree auto-stash remain open. Cancellation, preflight rejection, and confirmation-time repository drift are read-only; a Git failure without an active rebase is surfaced rather than described as a rollback. The existing cherry-pick limits also remain: merge-mainline (`-m 1`) handling, Git-version-specific empty-commit flags, and broader cross-panel range behavior are deferred. After a successful Drop, the selection returns to the start of the former visible range (clamped after refresh).

Files use explicit staged/worktree badges instead of raw porcelain soup:

- `S` lane: staged/index state
- `U` lane: unstaged/worktree state
- green: staged
- red: unstaged
- yellow: untracked
- blue/error: mixed/conflict states

## Editor HUNK and LINE mode

`Enter` on a changed file opens the actual file editor and enters LazyGitVS HUNK mode. No duplicate fake editor, no terminal textarea, no weird side quest.

```text
j/k, ↑/↓    Move hunk/line selection, wrapping at edges
Space       Stage/unstage selected hunk or line
a           Toggle HUNK/LINE mode
Tab         Toggle unstaged/staged side
d           Discard/unstage selected hunk or line
?           Contextual HUNK/LINE command menu
e           Switch to normal EDIT mode
Esc         Exit HUNK mode back to Files
q           Close LGVS/sidebar
```

EDIT mode is normal VS Code editing:

```text
normal typing   Edit the file normally
Ctrl+Enter      Return to LGVS HUNK mode on the same file
```

Hunk/line selection is shown in the editor with highlights and gutter markers. Staged/unstaged visual state is kept separate so you do not get the classic “everything is selected, good luck” diff mush.

## What it can do today

- SCM sidebar Git cockpit with lazygit-style panels
- real file previews and VS Code diff/editor integration
- file stage/unstage, stage all, unstage all
- range selection in Files, plus bounded partial cherry-pick ranges in Commits
- hunk and line stage/unstage
- branch, commit, stash, conflict, tag, and remote panels
- push, pull/fetch, stash, discard, reset, branch, commit, conflict, and selected-commit bisect QuickPick menus
- confirmed `z` / `Z` undo/redo for commit and branch actions via Git reflog
- lazygit config/keybinding reading where implemented
- `LazyGitVS: Reset state`, `LazyGitVS: Dump health`, and `LazyGitVS: Enter current file HUNK mode` recovery/debug commands
- UI dogfood tests in GitHub Actions
- VSIX packaging as CI artifacts and GitHub Releases

## Dangerous actions

LazyGitVS exposes destructive Git operations because hiding them would make it a toy.

These actions require confirmation:

- force push with lease
- discard file / hunk / line
- reset hard
- reset to commit
- reflog undo/redo resets and checkouts
- drop stash
- `💣 Nuke working tree`

`Nuke working tree` runs:

```bash
git reset --hard HEAD
git clean -fd
```

That discards staged, unstaged, and untracked changes. LazyGitVS cannot undo it. Git is sharp; don't lick the blade.

## Known limitations

- Single-root workspace assumption for now.
- Git operations use the Git CLI directly.
- Lazygit config/keybinding parity is partial and incremental.
- HUNK/LINE mode is VS Code-adapted; it is not a literal terminal UI.
- Conflict resolution uses VS Code-native files/merge editor; no custom conflict resolver panel yet.
- Native SCM sidebar scrolling is limited by VS Code public APIs. Numeric jumps update LGVS selection/focus, but in a cramped sidebar VS Code may not visibly scroll collapsed deep panels like `7 Tags` / `8 Remotes` into view. See [`docs/known-bugs.md`](docs/known-bugs.md).

## Development

Full testing policy and future-agent checklist: [`docs/testing-and-verification.md`](docs/testing-and-verification.md).

```bash
npm ci
npm run compile
npm test
npm run dogfood:ui
npm run package:dist
```

Useful scripts:

```text
npm test              Compile + unit/integration tests
npm run dogfood:ui    Headless VS Code UI dogfood smoke test
npm run package       Local dogfood VSIX build
npm run package:dist  Portable repo-local VSIX in dist/
```

Default local dogfood builds write to:

```text
../releases/LazyGitVS/lazygitvs-<commit>.vsix
```

Portable CI/release builds write to:

```text
dist/lazygitvs-<version>.vsix
```

## CI and releases

GitHub Actions runs on pushes and pull requests:

- `npm ci`
- `npm test`
- `npm run package:dist`
- `npm run dogfood:ui`
- upload VSIX artifact

Version tags publish release artifacts:

```bash
git tag v<version>
git push origin v<version>
```

The tag workflow creates a GitHub Release with the VSIX and publishes the same VSIX to the Visual Studio Marketplace. `VSCE_PAT` must be configured as a repository secret or the publish job fails loudly instead of pretending success.

## License

MIT

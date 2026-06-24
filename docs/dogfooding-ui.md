# LazyGitVS UI dogfooding

`npm run dogfood:ui` runs a real VS Code Extension Development Host under CDP. It is not a fake unit test with a helmet.

## What it covers

The harness creates a temporary Git repository with:

- tracked modifications
- a branch
- a tag
- a remote
- a stash entry
- a second workspace repository
- a nested repository discovered through VS Code Git scan depth

Then it launches VS Code stable with LazyGitVS loaded through `--extensionDevelopmentPath`, using a light theme by default.

It drives the real workbench with keyboard input and captures screenshots for evidence:

- Command Palette → `LazyGitVS: Focus SCM Sidebar`
- verifies the full native LazyGitVS SCM panel set is present
- panel jumps `1..8`, including `7 Tags` / `8 Remotes` reachability checks
- Files `Enter` → editor HUNK mode
- `a` → LINE mode
- `Space` → stage selected line
- `Tab` → staged side
- `Space` → unstage selected line
- `e` → EDIT mode
- `Ctrl+Enter` → return to HUNK mode
- `Esc` → back to Files/sidebar
- Command Palette → close sidebar

It verifies Git state with `git status`, `git diff --cached --name-only`, and `git diff --name-only`.

It fails if generated previews regress to `Untitled-*` buffers instead of named virtual docs.

## Theme

Default theme:

```text
Default Light Modern
```

Override when needed:

```bash
LGVS_DOGFOOD_THEME='Default Dark Modern' npm run dogfood:ui
```

Light theme is the default because it catches lazy CSS mistakes that dark themes hide. Dark-theme-only dogfood is how ugly extensions happen.

## How to run

```bash
npm run dogfood:ui
```

By default this runs a two-lane matrix: no Vim extension, then VSCodeVim installed/enabled.

For cramped-sidebar scroll/reveal checks, force a small window:

```bash
LGVS_DOGFOOD_WINDOW_SIZE=900,260 npm run dogfood:ui
```

Output:

```text
dogfood-output/
  last-run.json
  last-run-no-vim.json
  last-run-vim.json
  screenshots/no-vim/*.png
  screenshots/vim/*.png
```

`dogfood-output/` is intentionally ignored by Git and excluded from the VSIX.

## Rule

For LGVS changes, run the dogfood harness before calling a release good. Unit tests alone are not enough for UI/focus work.

Full testing policy and future-agent checklist: `docs/testing-and-verification.md`. Every feature request and bug fix should add automated coverage for the touched behavior, aiming for 100% where practical.

If a change touches sidebar navigation, previews, editor HUNK/LINE mode, keybindings, status bar, or visual state, run:

```bash
npm test
npm run dogfood:ui
npm run package
```

CI should use `npm run package:dist` so the workflow artifact is created under `dist/`. Local dogfood releases use `npm run package`, which writes to `../releases/LazyGitVS`.

## Known limits

- It runs headless Linux VS Code, not every end-user setup.
- It installs VSCodeVim for the `vim` lane, but vscode-neovim still needs a separate/manual check.
- It drives keyboard through CDP. Mouse click/double-click coverage can be added.
- Visual assertions are screenshots plus deterministic state checks. Pixel-perfect checks would be overkill sludge right now.
- Native VS Code SCM container scrolling is best-effort: a jump can set LGVS state correctly while VS Code refuses to visually scroll a collapsed deep native view into sight. Treat that as a known upstream/API limitation unless a screenshot proves otherwise.

## Why this exists

Unit tests catch parser and patch math. They do not catch focus, status bar, gutter, color contrast, or “this looks cursed” UI issues. This harness gives LGVS actual eyes.

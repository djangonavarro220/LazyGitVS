# AGENTS.md — LazyGitVS

This repo builds **LazyGitVS / LGVS**, a VS Code extension that adapts real lazygit behavior into the VS Code SCM sidebar.

## Product direction

- Upstream lazygit is the product spec. Prefer lazygit semantics, config names, keybindings, menus, and wording before inventing LGVS-only behavior.
- LGVS is a VS Code-native adaptation, not a terminal-in-a-webview cosplay.
- Core UX: keyboard-first, SCM sidebar, real VS Code editors/diffs/previews, no visible terminal.
- Do not shift lazygit muscle-memory numbers:
  - `1` Status
  - `2` Files
  - `3` Branches
  - `4` Commits
  - `5` Stash
  - `6+` VS Code/LGVS extras only.
- Never bind broad/global keys casually. Scope keybindings tightly with `when` clauses.
- Avoid duplicate mode labels with Vim/Neovim. If in doubt, hide LGVS status bar outside LGVS-owned modes.

## Repository layout

- Main extension code: `src/extension.ts`
- Pure lazygit config parsing: `src/lazygitConfig.ts`
- Menu/key helpers: `src/lazygitMenu.ts`
- Hunk/line patch logic: `src/hunkPatch.ts`
- Tests: `test/*.test.js`
- UI dogfood harness: `scripts/dogfood-ui.js`
- VSIX packaging helper: `scripts/package-vsix.js`
- CI workflow: `.github/workflows/ci.yml`

## Hard rules

1. **Test every feature and bug fix.** For any user-requested feature or reported bug, add automated coverage for the touched behavior with a 100% target where practical. Use `docs/testing-and-verification.md` as the playbook. If full automation is not practical, document the gap and add the nearest deterministic guard.
2. **Do not overwrite release versions.** If a release/versioned VSIX is explicitly requested, bump `package.json`/`package-lock.json` and create a new VSIX version; otherwise normal source/test commits do not imply a release bump.
3. **Do not commit generated artifacts.** Keep `node_modules/`, `out/`, `dist/`, `.vscode-test/`, `dogfood-output/`, screenshots, logs, and VSIX files out of Git.
4. **Do not ship local/debug artifacts.** No debug logs, no local absolute debug paths, no test output in the VSIX.
5. **Never store secrets.** Tokens/PATs/API keys/passwords/connection strings must be `[REDACTED]` if ever referenced.
6. **Prefer Git arg arrays.** Use `execFile`/argument arrays, not shell-interpolated Git commands.
7. **Confirm destructive Git actions.** Reset/clean/discard/rebase-abort style operations need explicit confirmation.
8. **Commit discipline:** local commits are OK when requested as part of the work; amend/rewrite existing commits only when explicitly asked, and never push rewritten history without a fresh explicit ask.
9. **Release discipline:** no release, tag, Marketplace publish, version bump, or public/private repo visibility change unless the human explicitly asks for that release/visibility action. Published extension != permission to make the repo public. GitHub release flow is: bump version + changelog, validate, create source commit, then tag/publish only on explicit request.
10. **Keep host-specific workflow notes out of this repo.** Public docs must be portable; local delivery paths and operator notes belong in ignored local files, not in Git.

## Pre-commit dependency checks

Before every commit, inspect the staged diff and update all coupled files in the same commit. Do not leave bookkeeping for “later”; later is how stale docs become lies.

Run/check:

```bash
git diff --staged --stat
git diff --staged
npm test
```

For UI/focus/keybinding/sidebar/editor/HUNK/LINE/preview/status-bar changes, also run `npm run dogfood:ui` before committing. If packaging/release files changed, run the relevant package command too.

Update these files when their trigger applies:

1. **Version/release metadata**
   - If and only if the human explicitly asked for a release/versioned VSIX/Marketplace publish: bump `package.json` and `package-lock.json` together.
   - Update `CHANGELOG.md` for release/version bumps.
   - Never bump versions for ordinary source/test/doc commits.

2. **Lazygit parity tracker**
   - If a lazygit parity item is added, fixed, partially implemented, newly discovered, or intentionally deferred: update `docs/lazygit-parity-gap-report.md` in the same commit.
   - Move items between `[ ]` and `[x]`; do not duplicate stale entries.
   - If upstream lazygit behavior/source changed or was re-audited, update the relevant audit docs under `docs/lazygit-*`.

3. **Tests**
   - Any behavior change needs a test change or a very clear reason in the final response.
   - Any new test file must be added to the `npm test` script in `package.json`.
   - Keybinding/menu/parity changes need source-level parity tests plus real Git-state tests when Git behavior is touched.

4. **VS Code extension manifest**
   - If adding/removing commands, views, activation events, settings, keybindings, menus, or contributed UI: update `package.json` contributions/activationEvents.
   - If dependencies change: update `package.json` and `package-lock.json`; do not hand-edit only one.

5. **User-facing docs**
   - If commands, keys, install flow, packaging, Marketplace behavior, or visible UX changes: update `README.md`, `BUILDING.md`, `MARKETPLACE.md`, or other relevant docs.
   - Public docs must be portable: no local absolute paths, private delivery notes, tokens, or operator-only shortcuts.

6. **Generated/artifact hygiene**
   - Before commit, verify `git status --short` contains only intended source/docs/test/config files.
   - Never commit `node_modules/`, `out/`, `dist/`, `.vscode-test/`, `dogfood-output/`, screenshots, logs, VSIX files, or local env files.

7. **Final pre-commit sanity**
   - Re-read the final staged diff.
   - Confirm no debug prints, absolute local paths, secrets, stale version strings, stale parity checklist items, or untracked required files.
   - Commit only after validation passes.

## Mandatory validation

For any functional change:

```bash
npm test
npm run package
```

For any UI/focus/keybinding/sidebar/editor/HUNK/LINE/preview/status-bar change:

```bash
npm test
npm run dogfood:ui
npm run package
```

`npm run dogfood:ui` launches a real VS Code Extension Development Host via `@vscode/test-electron`, Xvfb/CDP, keyboard input, screenshots, and Git-state assertions. It uses a light theme by default because light themes expose cheap CSS sins that dark themes politely hide.

After every UI/focus/keybinding bug fix, send the user at least one fresh dogfood screenshot that demonstrates the fixed path. Do not just say “dogfood passed”; attach the relevant `dogfood-output/screenshots/.../*.png` evidence in the final update.

Dogfood should cover the extension broadly, not only the last bug being fixed. Keep at least:

- opening/focusing the SCM sidebar
- visibility/reachability of all LGVS panels
- numeric panel jumps `1..8`
- Files `Enter` → editor HUNK mode
- HUNK/LINE toggle
- stage and unstage paths with Git-state assertions
- staged/unstaged side switch
- EDIT mode and return to HUNK
- exit back to Files/sidebar
- generated previews must not regress to `Untitled-*` buffers

## Build outputs

Default public/local build:

```bash
npm run package
```

This writes to `../releases/LazyGitVS/lazygitvs-<version>.vsix` for local dogfood delivery. Use `npm run package:dist` for portable `dist/` output.

For other private local delivery paths, set `LGVS_VSIX_OUT_DIR` or `LGVS_VSIX_OUT_FILE` in an ignored local shell/env file and run:

```bash
npm run package:local
```

Do not commit those local files.

## Preview/document rule

Generated preview text must use readonly virtual documents, not Untitled buffers.

- Use `TextDocumentContentProvider` with scheme `lazygitvs-preview:`.
- Keep preview titles stable and named.
- Strip ANSI escape sequences before showing Git log/patch text.
- Do not reintroduce `openTextDocument({ content: ... })` for branch/commit/stash preview text unless there is a very deliberate reason and a dogfood test for it.

## HUNK/LINE rules

- Files `Enter` opens a real editor and enters LGVS editor HUNK mode. Do not swap the sidebar into a fake hunk-only workflow as the primary path.
- HUNK/LINE mode is editor-scoped with tight `when` clauses.
- `Space` toggles selected hunk/line staging.
- `Tab` switches staged/unstaged side; support VSCodeVim interception cases.
- `a` toggles HUNK/LINE mode.
- `e` enters real EDIT mode.
- `Ctrl+Enter` returns from EDIT to HUNK mode.
- `Esc` exits LGVS editor HUNK/LINE mode back to Files/sidebar, but only under narrow editor contexts.
- LINE patches must be applied with `git apply --unidiff-zero` in both directions where needed.
- Dense replacement hunks must treat `-old/+new` pairs as one selectable editor line.

## Files panel UX

- Staged vs unstaged must be obvious. Preserve fixed index/worktree badge columns.
- Do not let selected row styling wash away S/U color semantics.
- Clamp selection against filtered/rendered lists, not raw backing arrays.
- Mouse click should update keyboard selection; double-click should behave like Enter.
- Refresh must not resurrect stale hidden selections.

## LazyGit config/keymap rule

- Read lazygit config read-only.
- Respect `LG_CONFIG_FILE` semantics.
- Respect original `keybinding.*` values where implemented.
- Defaults should come from lazygit behavior unless VS Code forces an explicit adaptation.
- Do not add LGVS-only settings as a reflex. If upstream lazygit has a behavior, implement that first.

## Native SCM scroll limitation

- Keep separate native SCM views as the accepted default. The one-owned-webview scroll experiment was rejected.
- VS Code does not expose reliable public API control for scrolling collapsed deep SCM views into sight. Numeric jumps should update LGVS focus/selection and best-effort reveal the target, but do not claim `7 Tags` / `8 Remotes` visual reveal is fixed without screenshot proof in a cramped sidebar.
- Do not reintroduce fake fixes like resizing views, blind list scrolling, hiding all other SCM views, or `focusSideBar` hacks. They make the UI lie and steal keys.

## Release checklist

1. Bump version; never reuse a VSIX version.
2. Update `CHANGELOG.md`.
3. Run required validation:
   - non-UI: `npm test && npm run package`
   - UI: `npm test && npm run dogfood:ui && npm run package`
4. Verify VSIX exists in the configured output directory.
5. Verify dogfood/test/local artifacts are not packaged.
6. Commit source/docs/tests only.
7. Final user update should be short: what changed, validation, deployed version. No hashes unless asked.

## Marketplace

Do not publish Marketplace unless explicitly asked. Publisher/login/PAT require human account steps.

# LazyGitVS LazyGit Parity Implementation Plan

> **For Yang:** Use the subagent-driven-development workflow to implement this plan task-by-task.

**Goal:** Move LGVS from "lazygit-inspired" to lazygit-compatible for config, keybindings, menus, and editor hunk/line behavior.

**Architecture:** Keep VS Code-native UI and Git CLI backend, but make upstream lazygit the source of truth. `src/lazygitConfig.ts` owns read-only config/keymap loading, `src/lazygitMenu.ts` owns menu labels/key dispatch, `src/extension.ts` only consumes resolved behavior.

**Tech Stack:** VS Code extension API, TypeScript, Node `fs/path/os`, Git CLI via arg arrays, Node test runner, `@vscode/test-electron` dogfood.

---

## Acceptance criteria

- Reads lazygit config read-only and respects `LG_CONFIG_FILE` comma semantics.
- Implemented shortcuts use resolved `keybinding.*`, not hardcoded defaults.
- QuickPick menus show lazygit-style key prefixes, cancel entry, labels, and destructive confirmations.
- HUNK/LINE behavior follows lazygit muscle memory where VS Code allows it.
- `npm test`, `npm run dogfood:ui`, and `npm run package` pass before release.
- Every deploy bumps version; no generated artifacts committed.

---

### Task 1: Lock current config parser behavior with tests

**Objective:** Protect `LG_CONFIG_FILE`, XDG/default paths, merge order, and missing-env-file behavior before touching implementation.

**Files:**
- Modify: `test/lazygitConfig.test.js`
- Read: `src/lazygitConfig.ts`

**Steps:**
1. Add tests for comma-separated `LG_CONFIG_FILE` with two temp config files.
2. Add test that missing file from `LG_CONFIG_FILE` throws.
3. Add test that non-env missing candidates are ignored.
4. Run: `npm test`.
5. Commit: `test: cover lazygit config loading semantics`.

---

### Task 2: Replace fragile YAML parsing edge cases

**Objective:** Make config loading robust enough for real lazygit user configs without shipping a giant dependency unless needed.

**Files:**
- Modify: `src/lazygitConfig.ts`
- Modify: `test/lazygitConfig.test.js`
- Maybe modify: `package.json`, `package-lock.json` if adding `yaml`

**Steps:**
1. Add failing tests for quoted `#`, arrays, nested keybindings, booleans, and `customCommands` list handling.
2. If `parseSimpleYaml` becomes ugly, replace it with small `yaml` package. Don’t cosplay a YAML parser; that’s how bugs breed.
3. Keep read-only behavior: never write or migrate user config.
4. Run: `npm test`.
5. Commit: `fix: parse real lazygit config safely`.

---

### Task 3: Centralize resolved keybindings

**Objective:** Stop scattering hardcoded keys across `extension.ts`.

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/lazygitConfig.ts`
- Modify: `test/*.test.js`

**Steps:**
1. Add a small resolver API: `getKey(scope, action)` and `matchesKey(scope, action, typed)`.
2. Normalize lazygit forms like `<esc>`, `<enter>`, `<space>`, `<c-o>`, `<ctrl+j>`.
3. Update panel keyboard handlers to use resolver for implemented actions.
4. Keep VS Code keybindings in `package.json` tightly scoped with `when` clauses.
5. Run: `npm test`.
6. Commit: `refactor: resolve lazygit keybindings centrally`.

---

### Task 4: Apply config to visible UI switches

**Objective:** Make obvious GUI config fields actually change LGVS behavior.

**Files:**
- Modify: `src/extension.ts`
- Modify: `test/*.test.js`
- Modify: `scripts/dogfood-ui.js`

**Steps:**
1. Wire `gui.showBottomLine` to sidebar footer/mode hint visibility.
2. Wire `gui.showPanelJumps` to numeric jump hint visibility.
3. Wire `gui.useHunkModeInStagingView` to Files `Enter` default: HUNK mode vs file open adaptation.
4. Add dogfood fixture with temp lazygit config.
5. Run: `npm test && npm run dogfood:ui`.
6. Commit: `feat: honor lazygit gui config in LGVS`.

---

### Task 5: Convert QuickPick menus to lazygit menu model

**Objective:** Make dangerous/options menus look and behave like lazygit, not random VS Code popups.

**Files:**
- Modify: `src/lazygitMenu.ts`
- Modify: `src/extension.ts`
- Modify: `test/lazygitMenu.test.js`

**Steps:**
1. Expand menu item type: `key`, `label`, `description`, `disabledReason`, `dangerous`.
2. Use `decorateMenuItems()` for cancel and key-prefixed labels everywhere.
3. Implement key dispatch from typed QuickPick input where feasible.
4. Keep destructive actions double-confirmed.
5. Run: `npm test`.
6. Commit: `feat: model QuickPick menus after lazygit`.

---

### Task 6: Finish HUNK/LINE parity pass

**Objective:** Make editor HUNK/LINE mode predictable, testable, and closer to lazygit staging UX.

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/hunkPatch.ts`
- Modify: `test/hunkPatch.test.js`
- Modify: `scripts/dogfood-ui.js`

**Steps:**
1. Ensure `a` toggles HUNK/LINE via resolved keymap.
2. Ensure `Space` stages/unstages selected hunk/line.
3. Ensure `Tab` switches staged/unstaged side, including VSCodeVim interception fallback.
4. Ensure dense replacement hunks treat old/new pairs as one selectable line.
5. Add Git-state assertions to dogfood, not just screenshots. Screenshots lie politely.
6. Run: `npm test && npm run dogfood:ui`.
7. Commit: `fix: tighten editor hunk and line parity`.

---

### Task 7: Update docs and release

**Objective:** Ship the parity tranche cleanly without polluting Git or VSIX.

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Verify: `.vscodeignore`

**Steps:**
1. Document supported lazygit config/keybinding fields.
2. Bump version; never reuse an existing VSIX version.
3. Run: `npm test && npm run dogfood:ui && npm run package`.
4. Verify VSIX exists in `dist/` or configured local output.
5. Verify no docs/internal artifacts accidentally packaged.
6. Commit: `chore: release lazygit parity tranche`.

---

## Recommended execution order

1. Config tests/parser first.
2. Key resolver second.
3. UI config + menu model third.
4. HUNK/LINE parity last, because it is the bug magnet.
5. Release only after dogfood passes end-to-end.

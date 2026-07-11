# Lazygit undo/redo upstream audit

Audited from a clean upstream lazygit checkout at `e59c1d1cb7c4fde83918e72a92897ce76d185c9f` (`Make model<->view index conversions independent of rendering (#5785)`). Upstream source is the product specification for this implementation.

## Binding, labels, and scope

- `pkg/config/user_config.go:536-541,1056-1062` defines universal `undo` / `redo` and defaults them to `z` / `Z`.
- `pkg/gui/controllers/undo_controller.go:53-74` contributes `Undo` and `Redo` through a controller with no panel-specific context, making them global bindings.
- `pkg/i18n/english.go:1358-1362` supplies the exact `Undo` / `Redo` labels and reflog tooltips.
- `docs/keybindings/Keybindings_en.md:33-36` describes both as reflog operations over commits rather than working-tree changes.
- `docs/keybindings/Keybindings_en.md:211-214` separately assigns `z` in merge-conflict resolution to undo the last conflict resolution. LGVS therefore does not route reflog undo from its Conflicts surface.

LGVS exposes these actions on its top-level sidebar panels and their commit/stash drill-down views through one runtime keymap router, including Status, so custom lazygit keys behave consistently. It deliberately keeps them out of editor HUNK/LINE mode and the Conflicts panel, where LGVS does not provide upstream's reflog-global context or where upstream gives `z` another meaning.

## Reflog algorithm and mutations

- `pkg/gui/controllers/undo_controller.go:12-20` documents the persisted counter algorithm: lazygit records its own undo/redo markers in reflog and skips already-undone user actions.
- `pkg/gui/controllers/undo_controller.go:76-137` uses `GIT_REFLOG_ACTION=[lazygit undo]`; commit undo is a soft reset, completed rebase undo is a hard reset with autostash, and checkout undo returns to the source ref.
- `pkg/gui/controllers/undo_controller.go:140-191` uses `GIT_REFLOG_ACTION=[lazygit redo]`; commit/rebase redo is a hard reset with autostash and checkout redo returns to the destination ref.
- `pkg/gui/controllers/undo_controller.go:194-245` classifies checkout, commit/reset/pull, completed rebase, and current-rebase entries while maintaining the undo/redo counter.
- `pkg/gui/controllers/undo_controller.go:248-281` stashes tracked working-tree changes around hard reset and pops them afterward.
- `pkg/commands/git_commands/reflog_commit_loader.go:25-34` loads the complete HEAD reflog with `git log -g`, not an arbitrary UI-sized limit.

LGVS follows that parser and marker format, refuses root-boundary actions without a valid target, and scopes every command to the currently selected workspace repository. The extension caps each read at 10,000 newest entries and a 4 MiB process buffer so pathological reflogs cannot stall or exhaust the extension host; this is an intentional VS Code responsiveness adaptation around the same newest-first parser semantics.

## Guards and exact prompts

- `pkg/commands/models/working_tree_state.go:5-17` defines the blocked in-progress states as rebase, merge, cherry-pick, and revert.
- `pkg/gui/controllers/undo_controller.go:80-82,144-146` blocks undo/redo before parsing or prompting while one of those operations is active.
- `pkg/i18n/english.go:1795-1796` provides `Can't undo while rebasing` / `Can't redo while rebasing`.
- `pkg/i18n/english.go:1981-1983` provides the exact soft-reset, hard-reset-with-autostash, and checkout-with-autostash confirmation text.

All LGVS reflog mutations require the matching modal confirmation. Cancellation returns before any Git mutation.

## Verification coverage

`test/undoRedoReflog.test.js` uses real temporary Git repositories for commit undo/redo, branch checkout undo/redo, marker persistence, cancellation with index/worktree/untracked/stash/reflog snapshots, root and redo limits, tracked autostash restoration, operation-state guards, destructive hard reset, and multi-repository isolation.

`test/undoRedoParity.test.js` protects key, command, help/menu text, scope, manifest, and confirmation contracts. `npm run dogfood:ui:undo-redo` opens Undo through a real VS Code Extension Development Host, cancels its native modal, and verifies that HEAD, reflog, and the non-selected repository do not change. Confirmed undo/redo mutations stay in deterministic real-Git tests because CDP cannot accept Electron's native modal reliably.

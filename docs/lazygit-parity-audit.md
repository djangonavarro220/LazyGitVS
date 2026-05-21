# LazyGitVS — lazygit parity audit

Objetivo: LazyGitVS no debe ser “inspirado en lazygit”; debe copiar lazygit donde VS Code lo permita. Si hay conflicto, manda lazygit salvo limitación técnica clara de VS Code.

## Fuentes auditadas

- Código lazygit: upstream lazygit checkout used for parity research
- Keybindings generados: `docs/keybindings/Keybindings_en.md`
- Config/schema: `pkg/config/user_config.go`, `pkg/config/app_config.go`, `docs/Config.md`
- Menús: `pkg/gui/controllers/*`, `pkg/gui/menu_panel.go`, `pkg/gui/options_map.go`
- i18n/textos: `pkg/i18n/english.go`
- Extracto machine-readable: `docs/lazygit-parity-extract.json`

## Regla de producto para LGVS

1. Leer el mismo `config.yml` de lazygit.
2. Respetar `LG_CONFIG_FILE` si existe.
3. Resolver rutas igual que lazygit:
   - `CONFIG_DIR/config.yml` si `CONFIG_DIR` existe.
   - legacy `jesseduffield/lazygit/config.yml` vía XDG.
   - `lazygit/config.yml` vía XDG.
   - fallback `$XDG_CONFIG_HOME/lazygit/config.yml`.
4. No migrar ni sobrescribir config en LGVS al principio. Leer-only. Que lazygit sea dueño de migraciones; no queremos un clon con complejo de dueño.
5. Keybindings en LGVS deben salir de `keybinding.*` del YAML, con defaults lazygit si falta algo.
6. Textos visibles de menús/QuickPick deben usar los strings de lazygit inglés como base. Nada de “Reset Options” inventado si lazygit dice otra cosa.
7. QuickPick debe comportarse como menú lazygit:
   - título igual
   - item labels iguales
   - keys visibles iguales
   - `Cancel` al final salvo menús con `HideCancel`
   - filtro `/` donde aplique
   - radios/checks para opciones actuales
   - disabled reason visible como lazygit

## Prioridad de implementación

### Fase 1 — paridad imprescindible

- Config reader lazygit: parser YAML + defaults internos lazygit.
- Reemplazar keymap hardcoded de LGVS por `keybinding.*`.
- Files panel exacto: `<space>`, `<enter>`, `a`, `c`, `d`, `D`, `S`, `s`, `r`, `e`, `o`, `i`, `` ` ``, `-`, `=`, `/`.
- Main panel staging exacto: `<left>/<right>` hunks, `a` toggle hunk/line mode, `<space>` stage/unstage, `d`, `<tab>`, `<esc>`, `E`, `c/w/C`.
- Menús MVP exactos: stash options, discard changes, reset/nuke, status filter, branch delete/upstream, commit reset/log/fixup.

### Fase 2 — panels que LGVS aún simplifica demasiado

- Branches separadas: local branches, remote branches, remotes, tags, worktrees.
- Commits: reset, rebase, fixup, squash, cherry-pick, bisect, log options.
- Stash: apply/pop/drop/new branch/rename/view files.
- Status: config open/edit, recent repos, all branch logs.

## Config: lo que LGVS debe leer

### Rutas exactas

Fuente: `pkg/config/app_config.go`.

- Env `LG_CONFIG_FILE`: lista separada por comas; cada path obligatorio.
- Si no hay `LG_CONFIG_FILE`:
  - `CONFIG_DIR/config.yml` si `CONFIG_DIR` existe.
  - `jesseduffield/lazygit/config.yml` en XDG config dirs.
  - `lazygit/config.yml` en XDG config dirs.
  - fallback `$XDG_CONFIG_HOME/lazygit/config.yml`.

### Claves de config relevantes para UI/paridad

- `gui.showBottomLine`: si false, ocultar línea de ayuda excepto loader.
- `gui.showPanelJumps`: títulos con jump keys.
- `gui.showFileTree`, `gui.fileTreeSortOrder`, `gui.fileTreeSortCaseSensitive`.
- `gui.wrapLinesInStagingView`, `gui.useHunkModeInStagingView`.
- `gui.splitDiff`, `gui.mainPanelSplitMode`.
- `gui.theme.optionsTextColor`, `selectedLineBgColor`, `inactiveViewSelectedLineBgColor`, `unstagedChangesColor`.
- `git.ignoreWhitespaceInDiffView`, `git.diffContextSize`, `git.renameSimilarityThreshold`.
- `git.paging.*` para main diff rendering si LGVS replica pager behavior.
- `customCommands`: debe convertirse a comandos/QuickPick en el contexto correcto.
- `keybinding.*`: fuente de verdad para controles.

## Defaults lazygit de keybindings

```go
		Keybinding: KeybindingConfig{
			Universal: KeybindingUniversalConfig{
				Quit:                              "q",
				QuitAlt1:                          "<ctrl+c>",
				SuspendApp:                        "<ctrl+z>",
				Return:                            "<esc>",
				QuitWithoutChangingDirectory:      "Q",
				TogglePanel:                       "<tab>",
				PrevItem:                          "<up>",
				NextItem:                          "<down>",
				PrevItemAlt:                       "k",
				NextItemAlt:                       "j",
				PrevPage:                          ",",
				NextPage:                          ".",
				ScrollLeft:                        "H",
				ScrollRight:                       "L",
				GotoTop:                           "<",
				GotoBottom:                        ">",
				GotoTopAlt:                        "<home>",
				GotoBottomAlt:                     "<end>",
				ToggleRangeSelect:                 "v",
				RangeSelectDown:                   "<shift+down>",
				RangeSelectUp:                     "<shift+up>",
				PrevBlock:                         "<left>",
				NextBlock:                         "<right>",
				PrevBlockAlt:                      "h",
				NextBlockAlt:                      "l",
				PrevBlockAlt2:                     "<backtab>",
				NextBlockAlt2:                     "<tab>",
				JumpToBlock:                       []string{"1", "2", "3", "4", "5"},
				FocusMainView:                     "0",
				NextMatch:                         "n",
				PrevMatch:                         "N",
				StartSearch:                       "/",
				MoveWordLeft:                      platformKeyBinding(platform, map[string]string{"darwin": "<alt+left>"}, "<ctrl+left>"),
				MoveWordRight:                     platformKeyBinding(platform, map[string]string{"darwin": "<alt+right>"}, "<ctrl+right>"),
				BackspaceWord:                     platformKeyBinding(platform, map[string]string{"darwin": "<alt+backspace>"}, "<ctrl+backspace>"),
				ForwardDeleteWord:                 platformKeyBinding(platform, map[string]string{"darwin": "<alt+delete>"}, "<ctrl+delete>"),
				OptionMenu:                        "<disabled>",
				OptionMenuAlt1:                    "?",
				Select:                            "<space>",
				GoInto:                            "<enter>",
				Confirm:                           "<enter>",
				ConfirmMenu:                       "<enter>",
				ConfirmSuggestion:                 "<enter>",
				ConfirmInEditor:                   platformKeyBinding(platform, map[string]string{"darwin": "<meta+enter>"}, "<ctrl+enter>"),
				ConfirmInEditorAlt:                "<ctrl+s>",
				Remove:                            "d",
				New:                               "n",
				Edit:                              "e",
				OpenFile:                          "o",
				OpenRecentRepos:                   "<ctrl+r>",
				ScrollUpMain:                      "<pgup>",
				ScrollDownMain:                    "<pgdown>",
				ScrollUpMainAlt1:                  "K",
				ScrollDownMainAlt1:                "J",
				ScrollUpMainAlt2:                  "<ctrl+u>",
				ScrollDownMainAlt2:                "<ctrl+d>",
				ExecuteShellCommand:               ":",
				CreateRebaseOptionsMenu:           "m",
				Push:                              "P",
				Pull:                              "p",
				Refresh:                           "R",
				CreatePatchOptionsMenu:            "<ctrl+p>",
				NextTab:                           "]",
				PrevTab:                           "[",
				NextScreenMode:                    "+",
				PrevScreenMode:                    "_",
				CyclePagers:                       "|",
				Undo:                              "z",
				Redo:                              "Z",
				FilteringMenu:                     "<ctrl+s>",
				DiffingMenu:                       "W",
				DiffingMenuAlt:                    "<ctrl+e>",
				CopyToClipboard:                   "<ctrl+o>",
				SubmitEditorText:                  "<enter>",
				ExtrasMenu:                        "@",
				ToggleWhitespaceInDiffView:        "<ctrl+w>",
				IncreaseContextInDiffView:         "}",
				DecreaseContextInDiffView:         "{",
				IncreaseRenameSimilarityThreshold: ")",
				DecreaseRenameSimilarityThreshold: "(",
				OpenDiffTool:                      "<ctrl+t>",
			},
			Status: KeybindingStatusConfig{
				CheckForUpdate:             "u",
				RecentRepos:                "<enter>",
				AllBranchesLogGraph:        "a",
				AllBranchesLogGraphReverse: "A",
			},
			Files: KeybindingFilesConfig{
				CommitChanges:            "c",
				CommitChangesWithoutHook: "w",
				AmendLastCommit:          "A",
				CommitChangesWithEditor:  "C",
				FindBaseCommitForFixup:   "<ctrl+f>",
				IgnoreFile:               "i",
				RefreshFiles:             "r",
				StashAllChanges:          "s",
				ViewStashOptions:         "S",
				ToggleStagedAll:          "a",
				ViewResetOptions:         "D",
				Fetch:                    "f",
				ToggleTreeView:           "`",
				OpenMergeOptions:         "M",
				OpenStatusFilter:         "<ctrl+b>",
				ConfirmDiscard:           "x",
				CopyFileInfoToClipboard:  "y",
				CollapseAll:              "-",
				ExpandAll:                "=",
			},
			Branches: KeybindingBranchesConfig{
				CopyPullRequestURL:       "<ctrl+y>",
				CreatePullRequest:        "o",
				ViewPullRequestOptions:   "O",
				OpenPullRequestInBrowser: "G",
				CheckoutBranchByName:     "c",
				ForceCheckoutBranch:      "F",
				CheckoutPreviousBranch:   "-",
				RebaseBranch:             "r",
				RenameBranch:             "R",
				MergeIntoCurrentBranch:   "M",
				MoveCommitsToNewBranch:   "N",
				ViewGitFlowOptions:       "i",
				FastForward:              "f",
				CreateTag:                "T",
				PushTag:                  "P",
				SetUpstream:              "u",
				FetchRemote:              "f",
				AddForkRemote:            "F",
				SortOrder:                "s",
			},
			Worktrees: KeybindingWorktreesConfig{
				ViewWorktreeOptions: "w",
			},
			Commits: KeybindingCommitsConfig{
				SquashDown:                     "s",
				RenameCommit:                   "r",
				RenameCommitWithEditor:         "R",
				ViewResetOptions:               "g",
				MarkCommitAsFixup:              "f",
				SetFixupMessage:                "c",
				CreateFixupCommit:              "F",
				SquashAboveCommits:             "S",
				MoveDownCommit:                 "<ctrl+j>",
				MoveUpCommit:                   "<ctrl+k>",
				AmendToCommit:                  "A",
				ResetCommitAuthor:              "a",
				PickCommit:                     "p",
				RevertCommit:                   "t",
				CherryPickCopy:                 "C",
				PasteCommits:                   "V",
				MarkCommitAsBaseForRebase:      "B",
				CreateTag:                      "T",
				CheckoutCommit:                 "<space>",
				ResetCherryPick:                "<ctrl+r>",
				CopyCommitAttributeToClipboard: "y",
				OpenLogMenu:                    "<ctrl+l>",
				OpenInBrowser:                  "o",
				OpenPullRequestInBrowser:       "G",
				ViewBisectOptions:              "b",
				StartInteractiveRebase:         "i",
				SelectCommitsOfCurrentBranch:   "*",
			},
			AmendAttribute: KeybindingAmendAttributeConfig{
				ResetAuthor: "a",
				SetAuthor:   "A",
				AddCoAuthor: "c",
			},
			Stash: KeybindingStashConfig{
				PopStash:    "g",
				RenameStash: "r",
			},
			CommitFiles: KeybindingCommitFilesConfig{
				CheckoutCommitFile: "c",
			},
			Main: KeybindingMainConfig{
				ToggleSelectHunk: "a",
				PickBothHunks:    "b",
				EditSelectHunk:   "E",
			},
			Submodules: KeybindingSubmodulesConfig{
				Init:     "i",
				Update:   "u",
				BulkMenu: "b",
			},
			CommitMessage: KeybindingCommitMessageConfig{
				CommitMenu: "<ctrl+o>",
			},
		},

```

## Keybindings que LGVS debe copiar primero

### Global keybindings
- `<c-r>`: **Switch to a recent repo**
- `<pgup> (fn+up/shift+k)`: **Scroll up main window**
- `<pgdown> (fn+down/shift+j)`: **Scroll down main window**
- `@`: **View command log options** — View options for the command log e.g. show/hide the command log and focus the command log.
- `P`: **Push** — Push the current branch to its upstream branch. If no upstream is configured, you will be prompted to configure an upstream branch.
- `p`: **Pull** — Pull changes from the remote for the current branch. If no upstream is configured, you will be prompted to configure an upstream branch.
- `)`: **Increase rename similarity threshold** — Increase the similarity threshold for a deletion and addition pair to be treated as a rename. The default can be changed in the config file with the key 'git.renameSimilarityThreshold'.
- `(`: **Decrease rename similarity threshold** — Decrease the similarity threshold for a deletion and addition pair to be treated as a rename. The default can be changed in the config file with the key 'git.renameSimilarityThreshold'.
- `}`: **Increase diff context size** — Increase the amount of the context shown around changes in the diff view. The default can be changed in the config file with the key 'git.diffContextSize'.
- `{`: **Decrease diff context size** — Decrease the amount of the context shown around changes in the diff view. The default can be changed in the config file with the key 'git.diffContextSize'.
- `:`: **Execute shell command** — Bring up a prompt where you can enter a shell command to execute.
- `<c-p>`: **View custom patch options**
- `m`: **View merge/rebase options** — View options to abort/continue/skip the current merge/rebase.
- `R`: **Refresh** — Refresh the git state (i.e. run `git status`, `git branch`, etc in background to update the contents of panels). This does not run `git fetch`.
- `+`: **Next screen mode (normal/half/fullscreen)**
- `_`: **Prev screen mode**
- `\|`: **Cycle pagers** — Choose the next pager in the list of configured pagers
- `<esc>`: **Cancel**
- `?`: **Open keybindings menu**
- `<c-s>`: **View filter options** — View options for filtering the commit log, so that only commits matching the filter are shown.
- `W`: **View diffing options** — View options relating to diffing two refs e.g. diffing against selected ref, entering ref to diff against, and reversing the diff direction.
- `<c-e>`: **View diffing options** — View options relating to diffing two refs e.g. diffing against selected ref, entering ref to diff against, and reversing the diff direction.
- `q`: **Quit**
- `<c-z>`: **Suspend the application**
- `<c-w>`: **Toggle whitespace** — Toggle whether or not whitespace changes are shown in the diff view. The default can be changed in the config file with the key 'git.ignoreWhitespaceInDiffView'.
- `z`: **Undo** — The reflog will be used to determine what git command to run to undo the last git command. This does not include changes to the working tree; only commits are taken into consideration.
- `Z`: **Redo** — The reflog will be used to determine what git command to run to redo the last git command. This does not include changes to the working tree; only commits are taken into consideration.

### List panel navigation
- `,`: **Previous page**
- `.`: **Next page**
- `< (<home>)`: **Scroll to top**
- `> (<end>)`: **Scroll to bottom**
- `v`: **Toggle range select**
- `<s-down>`: **Range select down**
- `<s-up>`: **Range select up**
- `/`: **Search the current view by text**
- `H`: **Scroll left**
- `L`: **Scroll right**
- `]`: **Next tab**
- `[`: **Previous tab**

### Status
- `o`: **Open config file** — Open file in default application.
- `e`: **Edit config file** — Open file in external editor.
- `u`: **Check for update**
- `<enter>`: **Switch to a recent repo**
- `a`: **Show/cycle all branch logs**
- `A`: **Show/cycle all branch logs (reverse)**
- `0`: **Focus main view**

### Files
- `<c-o>`: **Copy path to clipboard**
- `<space>`: **Stage** — Toggle staged for selected file.
- `<c-b>`: **Filter files by status**
- `y`: **Copy to clipboard**
- `c`: **Commit** — Commit staged changes.
- `w`: **Commit changes without pre-commit hook**
- `A`: **Amend last commit**
- `C`: **Commit changes using git editor**
- `<c-f>`: **Find base commit for fixup** — Find the commit that your current changes are building upon, for the sake of amending/fixing up the commit. This spares you from having to look through your branch's commits one-by-one to see which commit should be amended/fixed up. See docs: <https://github.com/jesseduffield/lazygit/tree/master/docs/Fixup_Commits.md>
- `e`: **Edit** — Open file in external editor.
- `o`: **Open file** — Open file in default application.
- `i`: **Ignore or exclude file**
- `r`: **Refresh files**
- `s`: **Stash** — Stash all changes. For other variations of stashing, use the view stash options keybinding.
- `S`: **View stash options** — View stash options (e.g. stash all, stash staged, stash unstaged).
- `a`: **Stage all** — Toggle staged/unstaged for all files in working tree.
- `<enter>`: **Stage lines / Collapse directory** — If the selected item is a file, focus the staging view so you can stage individual hunks/lines. If the selected item is a directory, collapse/expand it.
- `d`: **Discard** — View options for discarding changes to the selected file.
- `g`: **View upstream reset options**
- `D`: **Reset** — View reset options for working tree (e.g. nuking the working tree).
- ```: **Toggle file tree view** — Toggle file view between flat and tree layout. Flat layout shows all file paths in a single list, tree layout groups files by directory. The default can be changed in the config file with the key 'gui.showFileTree'.
- `<c-t>`: **Open external diff tool (git difftool)**
- `M`: **View merge conflict options** — View options for resolving merge conflicts.
- `f`: **Fetch** — Fetch changes from remote.
- `-`: **Collapse all files** — Collapse all directories in the files tree
- `=`: **Expand all files** — Expand all directories in the file tree
- `0`: **Focus main view**
- `/`: **Filter the current view by text**

### Main panel (normal)
- `mouse wheel down (fn+up)`: **Scroll down**
- `mouse wheel up (fn+down)`: **Scroll up**
- `<tab>`: **Switch view** — Switch to other view (staged/unstaged changes).
- `<esc>`: **Exit back to side panel**
- `/`: **Search the current view by text**

### Main panel (staging)
- `<left>`: **Go to previous hunk**
- `<right>`: **Go to next hunk**
- `v`: **Toggle range select**
- `a`: **Toggle hunk selection** — Toggle line-by-line vs. hunk selection mode.
- `<c-o>`: **Copy selected text to clipboard**
- `<space>`: **Stage** — Toggle selection staged / unstaged.
- `d`: **Discard** — When unstaged change is selected, discard the change using `git reset`. When staged change is selected, unstage the change.
- `o`: **Open file** — Open file in default application.
- `e`: **Edit file** — Open file in external editor.
- `<esc>`: **Return to files panel**
- `<tab>`: **Switch view** — Switch to other view (staged/unstaged changes).
- `E`: **Edit hunk** — Edit selected hunk in external editor.
- `c`: **Commit** — Commit staged changes.
- `w`: **Commit changes without pre-commit hook**
- `C`: **Commit changes using git editor**
- `<c-f>`: **Find base commit for fixup** — Find the commit that your current changes are building upon, for the sake of amending/fixing up the commit. This spares you from having to look through your branch's commits one-by-one to see which commit should be amended/fixed up. See docs: <https://github.com/jesseduffield/lazygit/tree/master/docs/Fixup_Commits.md>
- `/`: **Search the current view by text**

### Local branches
- `<c-o>`: **Copy branch name to clipboard**
- `i`: **Show git-flow options**
- `<space>`: **Checkout** — Checkout selected item.
- `n`: **New branch**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `o`: **Create pull request**
- `O`: **View create pull request options**
- `G`: **Open pull request in browser**
- `<c-y>`: **Copy pull request URL to clipboard**
- `c`: **Checkout by name** — Checkout by name. In the input box you can enter '-' to switch to the previous branch.
- `-`: **Checkout previous branch**
- `F`: **Force checkout** — Force checkout selected branch. This will discard all local changes in your working directory before checking out the selected branch.
- `d`: **Delete** — View delete options for local/remote branch.
- `r`: **Rebase** — Rebase the checked-out branch onto the selected branch.
- `M`: **Merge** — View options for merging the selected item into the current branch (regular merge, squash merge)
- `f`: **Fast-forward** — Fast-forward selected branch from its upstream.
- `T`: **New tag**
- `s`: **Sort order**
- `g`: **Reset**
- `R`: **Rename branch**
- `u`: **View upstream options** — View options relating to the branch's upstream e.g. setting/unsetting the upstream and resetting to the upstream.
- `<c-t>`: **Open external diff tool (git difftool)**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Remote branches
- `<c-o>`: **Copy branch name to clipboard**
- `<space>`: **Checkout** — Checkout a new local branch based on the selected remote branch, or the remote branch as a detached head.
- `n`: **New branch**
- `M`: **Merge** — View options for merging the selected item into the current branch (regular merge, squash merge)
- `r`: **Rebase** — Rebase the checked-out branch onto the selected branch.
- `d`: **Delete** — Delete the remote branch from the remote.
- `u`: **Set as upstream** — Set the selected remote branch as the upstream of the checked-out branch.
- `s`: **Sort order**
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `<c-t>`: **Open external diff tool (git difftool)**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Commits
- `<c-o>`: **Copy abbreviated commit hash to clipboard**
- `<c-r>`: **Reset copied (cherry-picked) commits selection**
- `b`: **View bisect options**
- `s`: **Squash** — Squash the selected commit into the commit below it. The selected commit's message will be appended to the commit below it.
- `f`: **Fixup** — Meld the selected commit into the commit below it. Similar to squash, but the selected commit's message will be discarded.
- `c`: **Set fixup message** — Set the message option for the fixup commit. The -C option means to use this commit's message instead of the target commit's message.
- `r`: **Reword** — Reword the selected commit's message.
- `R`: **Reword with editor**
- `d`: **Drop** — Drop the selected commit. This will remove the commit from the branch via a rebase. If the commit makes changes that later commits depend on, you may need to resolve merge conflicts.
- `e`: **Edit (start interactive rebase)** — Edit the selected commit. Use this to start an interactive rebase from the selected commit. When already mid-rebase, this will mark the selected commit for editing, which means that upon continuing the rebase, the rebase will pause at the selected commit to allow you to make changes.
- `i`: **Start interactive rebase** — Start an interactive rebase for the commits on your branch. This will include all commits from the HEAD commit down to the first merge commit or main branch commit.<br>If you would instead like to start an interactive rebase from the selected commit, press `e`.
- `p`: **Pick** — Mark the selected commit to be picked (when mid-rebase). This means that the commit will be retained upon continuing the rebase.
- `F`: **Create fixup commit** — Create 'fixup!' commit for the selected commit. Later on, you can press `S` on this same commit to apply all above fixup commits.
- `S`: **Apply fixup commits** — Squash all 'fixup!' commits, either above the selected commit, or all in current branch (autosquash).
- `<c-j>`: **Move commit down one**
- `<c-k>`: **Move commit up one**
- `V`: **Paste (cherry-pick)**
- `B`: **Mark as base commit for rebase** — Select a base commit for the next rebase. When you rebase onto a branch, only commits above the base commit will be brought across. This uses the `git rebase --onto` command.
- `A`: **Amend** — Amend commit with staged changes. If the selected commit is the HEAD commit, this will perform `git commit --amend`. Otherwise the commit will be amended via a rebase.
- `a`: **Amend commit attribute** — Set/Reset commit author or set co-author.
- `t`: **Revert** — Create a revert commit for the selected commit, which applies the selected commit's changes in reverse.
- `T`: **Tag commit** — Create a new tag pointing at the selected commit. You'll be prompted to enter a tag name and optional description.
- `<c-l>`: **View log options** — View options for commit log e.g. changing sort order, hiding the git graph, showing the whole git graph.
- `G`: **Open pull request in browser**
- `<space>`: **Checkout** — Checkout the selected commit as a detached HEAD.
- `y`: **Copy commit attribute to clipboard** — Copy commit attribute to clipboard (e.g. hash, URL, diff, message, author).
- `o`: **Open commit in browser**
- `n`: **Create new branch off of commit**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `C`: **Copy (cherry-pick)** — Mark commit as copied. Then, within the local commits view, you can press `V` to paste (cherry-pick) the copied commit(s) into your checked out branch. At any time you can press `<esc>` to cancel the selection.
- `<c-t>`: **Open external diff tool (git difftool)**
- `*`: **Select commits of current branch**
- `0`: **Focus main view**
- `<enter>`: **View files**
- `w`: **View worktree options**
- `/`: **Search the current view by text**

### Stash
- `<space>`: **Apply** — Apply the stash entry to your working directory.
- `g`: **Pop** — Apply the stash entry to your working directory and remove the stash entry.
- `d`: **Drop** — Remove the stash entry from the stash list.
- `n`: **New branch** — Create a new branch from the selected stash entry. This works by git checking out the commit that the stash entry was created from, creating a new branch from that commit, then applying the stash entry to the new branch as an additional commit.
- `r`: **Rename stash**
- `0`: **Focus main view**
- `<enter>`: **View files**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Menu
- `<enter>`: **Execute**
- `<esc>`: **Close/Cancel**
- `/`: **Filter the current view by text**

### Confirmation panel
- `<enter>`: **Confirm**
- `<esc>`: **Close/Cancel**
- `<c-o>`: **Copy to clipboard**

## Índice completo de keybindings lazygit auditados

- Global keybindings: 27 bindings
- List panel navigation: 12 bindings
- Commit files: 15 bindings
- Commit summary: 2 bindings
- Commits: 37 bindings
- Confirmation panel: 3 bindings
- Files: 28 bindings
- Input prompt: 2 bindings
- Local branches: 26 bindings
- Main panel (merging): 11 bindings
- Main panel (normal): 5 bindings
- Main panel (patch building): 11 bindings
- Main panel (staging): 17 bindings
- Menu: 3 bindings
- Reflog: 15 bindings
- Remote branches: 14 bindings
- Remotes: 7 bindings
- Secondary: 3 bindings
- Stash: 9 bindings
- Status: 7 bindings
- Sub-commits: 15 bindings
- Submodules: 9 bindings
- Tags: 11 bindings
- Worktrees: 5 bindings

## Inventario de menús/submenús detectados en código

Nota: muchos labels aparecen como `self.c.Tr.*`; LGVS debe resolverlos contra `pkg/i18n/english.go`, no inventarlos.

- `pkg/gui/extras_panel.go:13` title `gui.c.Tr.CommandLog`; labels: gui.c.Tr.ToggleShowCommandLog, gui.c.Tr.FocusCommandLog; keys: gocui.NewKeyRune('t'), gocui.NewKeyRune('f')
- `pkg/gui/menu_panel.go:14` title `(dynamic)`; labels: gui.c.Tr.Cancel; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/options_menu_action.go:48` title `self.c.Tr.Keybindings`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/diffing_menu_action.go:72` title `self.c.Tr.DiffingMenuTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/custom_patch_options_menu_action.go:114` title `self.c.Tr.PatchOptionsTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/bisect_controller.go:157` title `self.c.Tr.Bisect.BisectMenuTitle`; labels: fmt.Sprintf(self.c.Tr.Bisect.MarkStart, fmt.Sprintf(self.c.Tr.Bisect.MarkStart, self.c.Tr.Bisect.ChooseTerms; keys: gocui.NewKeyRune('b'), gocui.NewKeyRune('g'), gocui.NewKeyRune('t')
- `pkg/gui/controllers/bisect_controller.go:164` title `self.c.Tr.Bisect.BisectMenuTitle`; labels: fmt.Sprintf(self.c.Tr.Bisect.MarkStart, fmt.Sprintf(self.c.Tr.Bisect.MarkStart, self.c.Tr.Bisect.ChooseTerms; keys: gocui.NewKeyRune('b'), gocui.NewKeyRune('g'), gocui.NewKeyRune('t')
- `pkg/gui/controllers/git_flow_controller.go:72` title `"git flow"`; labels: fmt.Sprintf("finish branch '%s'", "start feature", "start hotfix", "start bugfix", "start release"; keys: gocui.NewKeyRune('f'), gocui.NewKeyRune('h'), gocui.NewKeyRune('b'), gocui.NewKeyRune('r')
- `pkg/gui/controllers/filtering_menu_action.go:100` title `self.c.Tr.FilteringMenuTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/tags_controller.go:308` title `menuTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/basic_commits_controller.go:221` title `self.c.Tr.Actions.CopyCommitAttributeToClipboard`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/files_controller.go:700` title `self.c.Tr.MergeConflictsTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/files_controller.go:848` title `self.c.Tr.Actions.IgnoreExcludeFile`; labels: self.c.Tr.IgnoreFile, self.c.Tr.ExcludeFile, self.c.Tr.Cancel, self.c.Tr.AmendCommitWithConflictsContinue, self.c.Tr.AmendCommitWithConflictsAmend; keys: gocui.NewKeyRune('i'), gocui.NewKeyRune('e')
- `pkg/gui/controllers/files_controller.go:892` title `self.c.Tr.AmendCommitTitle`; labels: self.c.Tr.Cancel, self.c.Tr.AmendCommitWithConflictsContinue, self.c.Tr.AmendCommitWithConflictsAmend, self.c.Tr.FilterStagedFiles, self.c.Tr.FilterUnstagedFiles, self.c.Tr.FilterTrackedFiles; keys: gocui.NewKeyRune('s'), gocui.NewKeyRune('u'), gocui.NewKeyRune('t')
- `pkg/gui/controllers/files_controller.go:945` title `self.c.Tr.FilteringMenuTitle`; labels: self.c.Tr.FilterStagedFiles, self.c.Tr.FilterUnstagedFiles, self.c.Tr.FilterTrackedFiles, self.c.Tr.FilterUntrackedFiles, self.c.Tr.NoFilter; keys: gocui.NewKeyRune('s'), gocui.NewKeyRune('u'), gocui.NewKeyRune('t'), gocui.NewKeyRune('T'), gocui.NewKeyRune('r')
- `pkg/gui/controllers/files_controller.go:1084` title `self.c.Tr.StashOptions`; labels: self.c.Tr.StashAllChanges, self.c.Tr.StashAllChangesKeepIndex, self.c.Tr.StashIncludeUntrackedChanges, self.c.Tr.StashStagedChanges, self.c.Tr.StashUnstagedChanges; keys: gocui.NewKeyRune('a'), gocui.NewKeyRune('i'), gocui.NewKeyRune('U'), gocui.NewKeyRune('s'), gocui.NewKeyRune('u')
- `pkg/gui/controllers/files_controller.go:1267` title `self.c.Tr.CopyToClipboardMenu`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/files_controller.go:1491` title `submoduleNode.GetPath()`; labels: self.c.Tr.DiscardAllChanges, self.c.Tr.DiscardUnstagedChanges; keys: self.c.KeybindingsOpts().GetKey(self.c.UserConfig().Keybinding.Files.ConfirmDiscard), gocui.NewKeyRune('u')
- `pkg/gui/controllers/files_controller.go:1555` title `self.c.Tr.DiscardChangesTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/branches_controller.go:429` title `self.c.Tr.BranchUpstreamOptionsTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/branches_controller.go:676` title `menuTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/branches_controller.go:872` title `fmt.Sprint(self.c.Tr.CreatePullRequestOptions)`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/local_commits_controller.go:359` title `self.c.Tr.Fixup`; labels: self.c.Tr.Fixup, self.c.Tr.FixupKeepMessage, self.c.Tr.FixupDiscardMessage, self.c.Tr.FixupKeepMessage; keys: gocui.NewKeyRune('f'), gocui.NewKeyRune('c'), gocui.NewKeyRune('f'), gocui.NewKeyRune('c')
- `pkg/gui/controllers/local_commits_controller.go:401` title `self.c.Tr.SetFixupMessage`; labels: self.c.Tr.FixupDiscardMessage, self.c.Tr.FixupKeepMessage; keys: gocui.NewKeyRune('f'), gocui.NewKeyRune('c')
- `pkg/gui/controllers/local_commits_controller.go:861` title `"Amend commit attribute"`; labels: self.c.Tr.ResetAuthor, self.c.Tr.SetAuthor, self.c.Tr.AddCoAuthor; keys: opts.GetKey(opts.Config.AmendAttribute.ResetAuthor), opts.GetKey(opts.Config.AmendAttribute.SetAuthor), opts.GetKey(opts.Config.AmendAttribute.AddCoAuthor)
- `pkg/gui/controllers/local_commits_controller.go:998` title `self.c.Tr.CreateFixupCommit`; labels: self.c.Tr.FixupMenu_Fixup, self.c.Tr.FixupMenu_AmendWithChanges, self.c.Tr.FixupMenu_AmendWithoutChanges; keys: gocui.NewKeyRune('f'), gocui.NewKeyRune('a'), gocui.NewKeyRune('r')
- `pkg/gui/controllers/local_commits_controller.go:1130` title `self.c.Tr.SquashAboveCommits`; labels: self.c.Tr.SquashCommitsInCurrentBranch, self.c.Tr.SquashCommitsAboveSelectedCommit; keys: gocui.NewKeyRune('b'), gocui.NewKeyRune('a')
- `pkg/gui/controllers/local_commits_controller.go:1225` title `self.c.Tr.LogMenuTitle`; labels: self.c.Tr.ToggleShowGitGraphAll, self.c.Tr.ShowGitGraph, "always", "never", "when maximised", self.c.Tr.SortCommits; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/local_commits_controller.go:1259` title `self.c.Tr.LogMenuTitle`; labels: "always", "never", "when maximised", self.c.Tr.SortCommits, "topological (topo-order)", "date-order", "author-date-order", "default"; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/local_commits_controller.go:1302` title `self.c.Tr.LogMenuTitle`; labels: "topological (topo-order)", "date-order", "author-date-order", "default"; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/workspace_reset_controller.go:183` title `""`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/status_controller.go:168` title `self.c.Tr.SelectConfigFile`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/submodules_controller.go:219` title `self.c.Tr.BulkSubmoduleOptions`; labels: self.c.Tr.BulkInitSubmodules, self.c.Tr.BulkUpdateSubmodules, self.c.Tr.BulkUpdateRecursiveSubmodules, self.c.Tr.BulkDeinitSubmodules; keys: gocui.NewKeyRune('i'), gocui.NewKeyRune('u'), gocui.NewKeyRune('r'), gocui.NewKeyRune('d')
- `pkg/gui/controllers/commits_files_controller.go:301` title `self.c.Tr.CopyToClipboardMenu`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/refs_helper.go:148` title `utils.ResolvePlaceholderString(self.c.Tr.RemoteBranchCheckoutTitle`; labels: self.c.Tr.CheckoutTypeNewBranch, self.c.Tr.CheckoutTypeDetachedHead; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/refs_helper.go:252` title `self.c.Tr.SortOrder`; labels: [, fmt.Sprintf(self.c.Tr.Actions.CheckoutCommitAsDetachedHead, fmt.Sprintf(self.c.Tr.Actions.CheckoutBranchAtCommit; keys: row.key, gocui.NewKeyRune('d'), key
- `pkg/gui/controllers/helpers/refs_helper.go:295` title `fmt.Sprintf("%s %s"`; labels: fmt.Sprintf(self.c.Tr.Actions.CheckoutCommitAsDetachedHead, fmt.Sprintf(self.c.Tr.Actions.CheckoutBranchAtCommit, self.c.Tr.Actions.CheckoutBranch; keys: gocui.NewKeyRune('d'), key, gocui.NewKeyRune('1')
- `pkg/gui/controllers/helpers/refs_helper.go:343` title `self.c.Tr.Actions.CheckoutBranchOrCommit`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/refs_helper.go:478` title `self.c.Tr.MoveCommitsToNewBranch`; labels: fmt.Sprintf(self.c.Tr.MoveCommitsToNewBranchFromBaseItem, fmt.Sprintf(self.c.Tr.MoveCommitsToNewBranchStackedItem; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/commits_helper.go:249` title `self.c.Tr.CommitMenuTitle`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/refresh_helper.go:902` title `self.c.Tr.SelectRemoteRepository`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/working_tree_helper.go:375` title `self.c.Tr.MergeConflictOptionsTitle`; labels: [, [, [, [; keys: gocui.NewKeyRune('c'), gocui.NewKeyRune('i'), gocui.NewKeyRune('b'), gocui.NewKeyRune('m')
- `pkg/gui/controllers/helpers/merge_and_rebase_helper.go:67` title `title`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/merge_and_rebase_helper.go:186` title `self.c.Tr.FoundConflictsTitle`; labels: self.c.Tr.ViewConflictsMenuItem, fmt.Sprintf(self.c.Tr.AbortMenuItem; keys: gocui.NewKeyRune('a')
- `pkg/gui/controllers/helpers/merge_and_rebase_helper.go:369` title `title`; labels: self.c.Tr.RegularMergeFastForward, self.c.Tr.RegularMergeNonFastForward, self.c.Tr.RegularMergeNonFastForward, self.c.Tr.RegularMergeFastForward; keys: gocui.NewKeyRune('m'), gocui.NewKeyRune('n'), gocui.NewKeyRune('m'), gocui.NewKeyRune('f')
- `pkg/gui/controllers/helpers/merge_and_rebase_helper.go:459` title `self.c.Tr.Merge`; labels: self.c.Tr.SquashMergeUncommitted, self.c.Tr.SquashMergeCommitted; keys: gocui.NewKeyRune('s'), gocui.NewKeyRune('S')
- `pkg/gui/controllers/helpers/worktree_helper.go:76` title `self.c.Tr.WorktreeTitle`; labels: utils.ResolvePlaceholderString(self.c.Tr.CreateWorktreeFrom, utils.ResolvePlaceholderString(self.c.Tr.CreateWorktreeFromDetached; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/worktree_helper.go:232` title `self.c.Tr.WorktreeTitle`; labels: utils.ResolvePlaceholderString(self.c.Tr.CreateWorktreeFrom, utils.ResolvePlaceholderString(self.c.Tr.CreateWorktreeFromDetached; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/branches_helper.go:221` title `title`; labels: self.c.Tr.SwitchToWorktree, self.c.Tr.DetachWorktree, self.c.Tr.RemoveWorktree; keys: (dynamic/no direct keys)
- `pkg/gui/controllers/helpers/repos_helper.go:140` title `self.c.Tr.RecentRepos`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/popup/popup_handler.go:20` title `(dynamic)`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/popup/popup_handler.go:36` title `title`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/popup/popup_handler.go:58` title `title`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/types/common.go:138` title `(dynamic)`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/types/common.go:152` title `(dynamic)`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/services/custom_commands/client.go:111` title `title`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)
- `pkg/gui/services/custom_commands/handler_creator.go:239` title `prompt.Title`; labels: candidate.label; keys: (dynamic/no direct keys)
- `pkg/gui/services/custom_commands/handler_creator.go:264` title `prompt.Title`; labels: (dynamic/no direct labels); keys: (dynamic/no direct keys)

## Menús MVP que ahora LGVS tiene mal o incompletos

### Files `D` — Reset working tree

LGVS debe mapear a lazygit workspace reset controller, no a menú inventado:

- título en lazygit source: `""` dinámico en `workspace_reset_controller.go`
- opciones incluyen nuke working tree y resets soft/mixed/hard según contexto
- `gui.animateExplosion` decide animación
- confirmaciones deben tener texto lazygit/i18n

### Files `d` — Discard changes

Fuente: `pkg/gui/controllers/files_controller.go` alrededor de `DiscardChangesTitle`.

Opciones mínimas que LGVS debe replicar:

- Discard all changes
- Discard unstaged changes
- Unstage staged changes cuando aplique
- Para submodules: menú especial por submodule
- Tecla confirmación de discard: `keybinding.files.confirmDiscard`, default `x`

### Files `S` — Stash options

Fuente: `createStashMenu()`.

Opciones y keys detectadas:

- `StashAllChanges`: `a`
- `StashAllChangesKeepIndex`: `i`
- `StashIncludeUntrackedChanges`: `U`
- `StashStagedChanges`: `s`
- `StashUnstagedChanges`: revisar continuación del archivo para el key exacto antes de implementar

### Files `<ctrl+b>` — status filter

Fuente: `handleStatusFilterPressed()`.

Opciones:

- Filter staged files: `s`
- Filter unstaged files: `u`
- Filter tracked files: `t`
- Filter untracked files: `T`
- No filter: `r`
- Con radio button del filtro actual.

### Main staging

LGVS ahora tiene “Hunk mode” demasiado tosco. lazygit dice:

- `<left>` previous hunk
- `<right>` next hunk
- `a` toggle line-by-line vs hunk selection mode
- `<space>` toggle selection staged/unstaged
- `d` discard/unstage según lado
- `<tab>` switch staged/unstaged
- `E` edit hunk
- `c`, `w`, `C`, `<ctrl+f>` commit flows

Esto implica que LGVS necesita **Line mode real**, no solo hunk list.

### Bottom line/options map

Fuente: `pkg/gui/options_map.go`.

Formato lazygit:

- `description: key | description: key | ...`
- se trunca con `…`
- mezcla bindings locales + globales, quitando globales que chocan con locales
- algunos modes meten bindings prioritarios en color (`rebase`, `patch`, `bisect`)

LGVS no debería escribir ayuda manual por panel. Debe generar la ayuda desde el mismo catálogo de bindings, porque si no se pudre al minuto. Ya pasó.

## Full keybindings dump

### Global keybindings
- `<c-r>`: **Switch to a recent repo**
- `<pgup> (fn+up/shift+k)`: **Scroll up main window**
- `<pgdown> (fn+down/shift+j)`: **Scroll down main window**
- `@`: **View command log options** — View options for the command log e.g. show/hide the command log and focus the command log.
- `P`: **Push** — Push the current branch to its upstream branch. If no upstream is configured, you will be prompted to configure an upstream branch.
- `p`: **Pull** — Pull changes from the remote for the current branch. If no upstream is configured, you will be prompted to configure an upstream branch.
- `)`: **Increase rename similarity threshold** — Increase the similarity threshold for a deletion and addition pair to be treated as a rename. The default can be changed in the config file with the key 'git.renameSimilarityThreshold'.
- `(`: **Decrease rename similarity threshold** — Decrease the similarity threshold for a deletion and addition pair to be treated as a rename. The default can be changed in the config file with the key 'git.renameSimilarityThreshold'.
- `}`: **Increase diff context size** — Increase the amount of the context shown around changes in the diff view. The default can be changed in the config file with the key 'git.diffContextSize'.
- `{`: **Decrease diff context size** — Decrease the amount of the context shown around changes in the diff view. The default can be changed in the config file with the key 'git.diffContextSize'.
- `:`: **Execute shell command** — Bring up a prompt where you can enter a shell command to execute.
- `<c-p>`: **View custom patch options**
- `m`: **View merge/rebase options** — View options to abort/continue/skip the current merge/rebase.
- `R`: **Refresh** — Refresh the git state (i.e. run `git status`, `git branch`, etc in background to update the contents of panels). This does not run `git fetch`.
- `+`: **Next screen mode (normal/half/fullscreen)**
- `_`: **Prev screen mode**
- `\|`: **Cycle pagers** — Choose the next pager in the list of configured pagers
- `<esc>`: **Cancel**
- `?`: **Open keybindings menu**
- `<c-s>`: **View filter options** — View options for filtering the commit log, so that only commits matching the filter are shown.
- `W`: **View diffing options** — View options relating to diffing two refs e.g. diffing against selected ref, entering ref to diff against, and reversing the diff direction.
- `<c-e>`: **View diffing options** — View options relating to diffing two refs e.g. diffing against selected ref, entering ref to diff against, and reversing the diff direction.
- `q`: **Quit**
- `<c-z>`: **Suspend the application**
- `<c-w>`: **Toggle whitespace** — Toggle whether or not whitespace changes are shown in the diff view. The default can be changed in the config file with the key 'git.ignoreWhitespaceInDiffView'.
- `z`: **Undo** — The reflog will be used to determine what git command to run to undo the last git command. This does not include changes to the working tree; only commits are taken into consideration.
- `Z`: **Redo** — The reflog will be used to determine what git command to run to redo the last git command. This does not include changes to the working tree; only commits are taken into consideration.

### List panel navigation
- `,`: **Previous page**
- `.`: **Next page**
- `< (<home>)`: **Scroll to top**
- `> (<end>)`: **Scroll to bottom**
- `v`: **Toggle range select**
- `<s-down>`: **Range select down**
- `<s-up>`: **Range select up**
- `/`: **Search the current view by text**
- `H`: **Scroll left**
- `L`: **Scroll right**
- `]`: **Next tab**
- `[`: **Previous tab**

### Commit files
- `<c-o>`: **Copy path to clipboard**
- `y`: **Copy to clipboard**
- `c`: **Checkout** — Checkout file. This replaces the file in your working tree with the version from the selected commit.
- `d`: **Discard** — Discard this commit's changes to this file. This runs an interactive rebase in the background, so you may get a merge conflict if a later commit also changes this file.
- `o`: **Open file** — Open file in default application.
- `e`: **Edit** — Open file in external editor.
- `<c-t>`: **Open external diff tool (git difftool)**
- `<space>`: **Toggle file included in patch** — Toggle whether the file is included in the custom patch. See https://github.com/jesseduffield/lazygit#rebase-magic-custom-patches.
- `a`: **Toggle all files** — Add/remove all commit's files to custom patch. See https://github.com/jesseduffield/lazygit#rebase-magic-custom-patches.
- `<enter>`: **Enter file / Toggle directory collapsed** — If a file is selected, enter the file so that you can add/remove individual lines to the custom patch. If a directory is selected, toggle the directory.
- ```: **Toggle file tree view** — Toggle file view between flat and tree layout. Flat layout shows all file paths in a single list, tree layout groups files by directory. The default can be changed in the config file with the key 'gui.showFileTree'.
- `-`: **Collapse all files** — Collapse all directories in the files tree
- `=`: **Expand all files** — Expand all directories in the file tree
- `0`: **Focus main view**
- `/`: **Filter the current view by text**

### Commit summary
- `<enter>`: **Confirm**
- `<esc>`: **Close**

### Commits
- `<c-o>`: **Copy abbreviated commit hash to clipboard**
- `<c-r>`: **Reset copied (cherry-picked) commits selection**
- `b`: **View bisect options**
- `s`: **Squash** — Squash the selected commit into the commit below it. The selected commit's message will be appended to the commit below it.
- `f`: **Fixup** — Meld the selected commit into the commit below it. Similar to squash, but the selected commit's message will be discarded.
- `c`: **Set fixup message** — Set the message option for the fixup commit. The -C option means to use this commit's message instead of the target commit's message.
- `r`: **Reword** — Reword the selected commit's message.
- `R`: **Reword with editor**
- `d`: **Drop** — Drop the selected commit. This will remove the commit from the branch via a rebase. If the commit makes changes that later commits depend on, you may need to resolve merge conflicts.
- `e`: **Edit (start interactive rebase)** — Edit the selected commit. Use this to start an interactive rebase from the selected commit. When already mid-rebase, this will mark the selected commit for editing, which means that upon continuing the rebase, the rebase will pause at the selected commit to allow you to make changes.
- `i`: **Start interactive rebase** — Start an interactive rebase for the commits on your branch. This will include all commits from the HEAD commit down to the first merge commit or main branch commit.<br>If you would instead like to start an interactive rebase from the selected commit, press `e`.
- `p`: **Pick** — Mark the selected commit to be picked (when mid-rebase). This means that the commit will be retained upon continuing the rebase.
- `F`: **Create fixup commit** — Create 'fixup!' commit for the selected commit. Later on, you can press `S` on this same commit to apply all above fixup commits.
- `S`: **Apply fixup commits** — Squash all 'fixup!' commits, either above the selected commit, or all in current branch (autosquash).
- `<c-j>`: **Move commit down one**
- `<c-k>`: **Move commit up one**
- `V`: **Paste (cherry-pick)**
- `B`: **Mark as base commit for rebase** — Select a base commit for the next rebase. When you rebase onto a branch, only commits above the base commit will be brought across. This uses the `git rebase --onto` command.
- `A`: **Amend** — Amend commit with staged changes. If the selected commit is the HEAD commit, this will perform `git commit --amend`. Otherwise the commit will be amended via a rebase.
- `a`: **Amend commit attribute** — Set/Reset commit author or set co-author.
- `t`: **Revert** — Create a revert commit for the selected commit, which applies the selected commit's changes in reverse.
- `T`: **Tag commit** — Create a new tag pointing at the selected commit. You'll be prompted to enter a tag name and optional description.
- `<c-l>`: **View log options** — View options for commit log e.g. changing sort order, hiding the git graph, showing the whole git graph.
- `G`: **Open pull request in browser**
- `<space>`: **Checkout** — Checkout the selected commit as a detached HEAD.
- `y`: **Copy commit attribute to clipboard** — Copy commit attribute to clipboard (e.g. hash, URL, diff, message, author).
- `o`: **Open commit in browser**
- `n`: **Create new branch off of commit**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `C`: **Copy (cherry-pick)** — Mark commit as copied. Then, within the local commits view, you can press `V` to paste (cherry-pick) the copied commit(s) into your checked out branch. At any time you can press `<esc>` to cancel the selection.
- `<c-t>`: **Open external diff tool (git difftool)**
- `*`: **Select commits of current branch**
- `0`: **Focus main view**
- `<enter>`: **View files**
- `w`: **View worktree options**
- `/`: **Search the current view by text**

### Confirmation panel
- `<enter>`: **Confirm**
- `<esc>`: **Close/Cancel**
- `<c-o>`: **Copy to clipboard**

### Files
- `<c-o>`: **Copy path to clipboard**
- `<space>`: **Stage** — Toggle staged for selected file.
- `<c-b>`: **Filter files by status**
- `y`: **Copy to clipboard**
- `c`: **Commit** — Commit staged changes.
- `w`: **Commit changes without pre-commit hook**
- `A`: **Amend last commit**
- `C`: **Commit changes using git editor**
- `<c-f>`: **Find base commit for fixup** — Find the commit that your current changes are building upon, for the sake of amending/fixing up the commit. This spares you from having to look through your branch's commits one-by-one to see which commit should be amended/fixed up. See docs: <https://github.com/jesseduffield/lazygit/tree/master/docs/Fixup_Commits.md>
- `e`: **Edit** — Open file in external editor.
- `o`: **Open file** — Open file in default application.
- `i`: **Ignore or exclude file**
- `r`: **Refresh files**
- `s`: **Stash** — Stash all changes. For other variations of stashing, use the view stash options keybinding.
- `S`: **View stash options** — View stash options (e.g. stash all, stash staged, stash unstaged).
- `a`: **Stage all** — Toggle staged/unstaged for all files in working tree.
- `<enter>`: **Stage lines / Collapse directory** — If the selected item is a file, focus the staging view so you can stage individual hunks/lines. If the selected item is a directory, collapse/expand it.
- `d`: **Discard** — View options for discarding changes to the selected file.
- `g`: **View upstream reset options**
- `D`: **Reset** — View reset options for working tree (e.g. nuking the working tree).
- ```: **Toggle file tree view** — Toggle file view between flat and tree layout. Flat layout shows all file paths in a single list, tree layout groups files by directory. The default can be changed in the config file with the key 'gui.showFileTree'.
- `<c-t>`: **Open external diff tool (git difftool)**
- `M`: **View merge conflict options** — View options for resolving merge conflicts.
- `f`: **Fetch** — Fetch changes from remote.
- `-`: **Collapse all files** — Collapse all directories in the files tree
- `=`: **Expand all files** — Expand all directories in the file tree
- `0`: **Focus main view**
- `/`: **Filter the current view by text**

### Input prompt
- `<enter>`: **Confirm**
- `<esc>`: **Close/Cancel**

### Local branches
- `<c-o>`: **Copy branch name to clipboard**
- `i`: **Show git-flow options**
- `<space>`: **Checkout** — Checkout selected item.
- `n`: **New branch**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `o`: **Create pull request**
- `O`: **View create pull request options**
- `G`: **Open pull request in browser**
- `<c-y>`: **Copy pull request URL to clipboard**
- `c`: **Checkout by name** — Checkout by name. In the input box you can enter '-' to switch to the previous branch.
- `-`: **Checkout previous branch**
- `F`: **Force checkout** — Force checkout selected branch. This will discard all local changes in your working directory before checking out the selected branch.
- `d`: **Delete** — View delete options for local/remote branch.
- `r`: **Rebase** — Rebase the checked-out branch onto the selected branch.
- `M`: **Merge** — View options for merging the selected item into the current branch (regular merge, squash merge)
- `f`: **Fast-forward** — Fast-forward selected branch from its upstream.
- `T`: **New tag**
- `s`: **Sort order**
- `g`: **Reset**
- `R`: **Rename branch**
- `u`: **View upstream options** — View options relating to the branch's upstream e.g. setting/unsetting the upstream and resetting to the upstream.
- `<c-t>`: **Open external diff tool (git difftool)**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Main panel (merging)
- `<space>`: **Pick hunk**
- `b`: **Pick all hunks**
- `<up>`: **Previous hunk**
- `<down>`: **Next hunk**
- `<left>`: **Previous conflict**
- `<right>`: **Next conflict**
- `z`: **Undo** — Undo last merge conflict resolution.
- `e`: **Edit file** — Open file in external editor.
- `o`: **Open file** — Open file in default application.
- `M`: **View merge conflict options** — View options for resolving merge conflicts.
- `<esc>`: **Return to files panel**

### Main panel (normal)
- `mouse wheel down (fn+up)`: **Scroll down**
- `mouse wheel up (fn+down)`: **Scroll up**
- `<tab>`: **Switch view** — Switch to other view (staged/unstaged changes).
- `<esc>`: **Exit back to side panel**
- `/`: **Search the current view by text**

### Main panel (patch building)
- `<left>`: **Go to previous hunk**
- `<right>`: **Go to next hunk**
- `v`: **Toggle range select**
- `a`: **Toggle hunk selection** — Toggle line-by-line vs. hunk selection mode.
- `<c-o>`: **Copy selected text to clipboard**
- `o`: **Open file** — Open file in default application.
- `e`: **Edit file** — Open file in external editor.
- `<space>`: **Toggle lines in patch**
- `d`: **Remove lines from commit** — Remove the selected lines from this commit. This runs an interactive rebase in the background, so you may get a merge conflict if a later commit also changes these lines.
- `<esc>`: **Exit custom patch builder**
- `/`: **Search the current view by text**

### Main panel (staging)
- `<left>`: **Go to previous hunk**
- `<right>`: **Go to next hunk**
- `v`: **Toggle range select**
- `a`: **Toggle hunk selection** — Toggle line-by-line vs. hunk selection mode.
- `<c-o>`: **Copy selected text to clipboard**
- `<space>`: **Stage** — Toggle selection staged / unstaged.
- `d`: **Discard** — When unstaged change is selected, discard the change using `git reset`. When staged change is selected, unstage the change.
- `o`: **Open file** — Open file in default application.
- `e`: **Edit file** — Open file in external editor.
- `<esc>`: **Return to files panel**
- `<tab>`: **Switch view** — Switch to other view (staged/unstaged changes).
- `E`: **Edit hunk** — Edit selected hunk in external editor.
- `c`: **Commit** — Commit staged changes.
- `w`: **Commit changes without pre-commit hook**
- `C`: **Commit changes using git editor**
- `<c-f>`: **Find base commit for fixup** — Find the commit that your current changes are building upon, for the sake of amending/fixing up the commit. This spares you from having to look through your branch's commits one-by-one to see which commit should be amended/fixed up. See docs: <https://github.com/jesseduffield/lazygit/tree/master/docs/Fixup_Commits.md>
- `/`: **Search the current view by text**

### Menu
- `<enter>`: **Execute**
- `<esc>`: **Close/Cancel**
- `/`: **Filter the current view by text**

### Reflog
- `<c-o>`: **Copy abbreviated commit hash to clipboard**
- `<space>`: **Checkout** — Checkout the selected commit as a detached HEAD.
- `y`: **Copy commit attribute to clipboard** — Copy commit attribute to clipboard (e.g. hash, URL, diff, message, author).
- `o`: **Open commit in browser**
- `n`: **Create new branch off of commit**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `C`: **Copy (cherry-pick)** — Mark commit as copied. Then, within the local commits view, you can press `V` to paste (cherry-pick) the copied commit(s) into your checked out branch. At any time you can press `<esc>` to cancel the selection.
- `<c-r>`: **Reset copied (cherry-picked) commits selection**
- `<c-t>`: **Open external diff tool (git difftool)**
- `*`: **Select commits of current branch**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Remote branches
- `<c-o>`: **Copy branch name to clipboard**
- `<space>`: **Checkout** — Checkout a new local branch based on the selected remote branch, or the remote branch as a detached head.
- `n`: **New branch**
- `M`: **Merge** — View options for merging the selected item into the current branch (regular merge, squash merge)
- `r`: **Rebase** — Rebase the checked-out branch onto the selected branch.
- `d`: **Delete** — Delete the remote branch from the remote.
- `u`: **Set as upstream** — Set the selected remote branch as the upstream of the checked-out branch.
- `s`: **Sort order**
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `<c-t>`: **Open external diff tool (git difftool)**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Remotes
- `<enter>`: **View branches**
- `n`: **New remote**
- `d`: **Remove** — Remove the selected remote. Any local branches tracking a remote branch from the remote will be unaffected.
- `e`: **Edit** — Edit the selected remote's name or URL.
- `f`: **Fetch** — Fetch updates from the remote repository. This retrieves new commits and branches without merging them into your local branches.
- `F`: **Add fork remote** — Quickly add a fork remote by replacing the owner in the origin URL and optionally check out a branch from new remote.
- `/`: **Filter the current view by text**

### Secondary
- `<tab>`: **Switch view** — Switch to other view (staged/unstaged changes).
- `<esc>`: **Exit back to side panel**
- `/`: **Search the current view by text**

### Stash
- `<space>`: **Apply** — Apply the stash entry to your working directory.
- `g`: **Pop** — Apply the stash entry to your working directory and remove the stash entry.
- `d`: **Drop** — Remove the stash entry from the stash list.
- `n`: **New branch** — Create a new branch from the selected stash entry. This works by git checking out the commit that the stash entry was created from, creating a new branch from that commit, then applying the stash entry to the new branch as an additional commit.
- `r`: **Rename stash**
- `0`: **Focus main view**
- `<enter>`: **View files**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Status
- `o`: **Open config file** — Open file in default application.
- `e`: **Edit config file** — Open file in external editor.
- `u`: **Check for update**
- `<enter>`: **Switch to a recent repo**
- `a`: **Show/cycle all branch logs**
- `A`: **Show/cycle all branch logs (reverse)**
- `0`: **Focus main view**

### Sub-commits
- `<c-o>`: **Copy abbreviated commit hash to clipboard**
- `<space>`: **Checkout** — Checkout the selected commit as a detached HEAD.
- `y`: **Copy commit attribute to clipboard** — Copy commit attribute to clipboard (e.g. hash, URL, diff, message, author).
- `o`: **Open commit in browser**
- `n`: **Create new branch off of commit**
- `N`: **Move commits to new branch** — Create a new branch and move the unpushed commits of the current branch to it. Useful if you meant to start new work and forgot to create a new branch first. Note that this disregards the selection, the new branch is always created either from the main branch or stacked on top of the current branch (you get to choose which).
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `C`: **Copy (cherry-pick)** — Mark commit as copied. Then, within the local commits view, you can press `V` to paste (cherry-pick) the copied commit(s) into your checked out branch. At any time you can press `<esc>` to cancel the selection.
- `<c-r>`: **Reset copied (cherry-picked) commits selection**
- `<c-t>`: **Open external diff tool (git difftool)**
- `*`: **Select commits of current branch**
- `0`: **Focus main view**
- `<enter>`: **View files**
- `w`: **View worktree options**
- `/`: **Search the current view by text**

### Submodules
- `<c-o>`: **Copy submodule name to clipboard**
- `<enter>`: **Enter** — Enter submodule. After entering the submodule, you can press `<esc>` to escape back to the parent repo.
- `d`: **Remove** — Remove the selected submodule and its corresponding directory.
- `u`: **Update** — Update selected submodule.
- `n`: **New submodule**
- `e`: **Update submodule URL**
- `i`: **Initialize** — Initialize the selected submodule to prepare for fetching. You probably want to follow this up by invoking the 'update' action to fetch the submodule.
- `b`: **View bulk submodule options**
- `/`: **Filter the current view by text**

### Tags
- `<c-o>`: **Copy tag to clipboard**
- `<space>`: **Checkout** — Checkout the selected tag as a detached HEAD.
- `n`: **New tag** — Create new tag from current commit. You'll be prompted to enter a tag name and optional description.
- `d`: **Delete** — View delete options for local/remote tag.
- `P`: **Push tag** — Push the selected tag to a remote. You'll be prompted to select a remote.
- `g`: **Reset** — View reset options (soft/mixed/hard) for resetting onto selected item.
- `<c-t>`: **Open external diff tool (git difftool)**
- `0`: **Focus main view**
- `<enter>`: **View commits**
- `w`: **View worktree options**
- `/`: **Filter the current view by text**

### Worktrees
- `n`: **New worktree**
- `<space>`: **Switch** — Switch to the selected worktree.
- `o`: **Open in editor**
- `d`: **Remove** — Remove the selected worktree. This will both delete the worktree's directory, as well as metadata about the worktree in the .git directory.
- `/`: **Filter the current view by text**

## Checklist de paridad para próximas versiones

- [ ] Crear módulo `lazygitConfig.ts`: localiza y lee config lazygit.
- [ ] Crear defaults TS desde `GetDefaultConfigForPlatform`.
- [ ] Crear `keymap.ts`: resuelve keybinding path → tecla real.
- [ ] Sustituir keydown hardcoded por keymap configurable.
- [ ] Crear `lazygitI18n.ts`: strings mínimos desde `english.go`.
- [ ] Crear `lazygitMenu.ts`: QuickPick builder común que acepte title/items/key/tooltip/disabled/radio.
- [ ] Rehacer Files menu `d/D/S/<ctrl+b>` con labels lazygit.
- [ ] Rehacer Main staging con hunk/line modes reales.
- [ ] Añadir test de snapshot: LGVS keybindings vs `docs/keybindings/Keybindings_en.md` extract.
- [ ] Añadir test de snapshot: menús MVP vs `docs/lazygit-parity-extract.json`.

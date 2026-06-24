# Known bugs / limitations

## Native SCM deep-panel scroll

Status: open, documented for `0.1.86`.

LazyGitVS keeps separate native VS Code SCM sidebar views because that is the accepted UX. The downside is annoying and real: VS Code does not expose a reliable public API to scroll a collapsed/deep contributed SCM view into the visible part of a cramped sidebar.

Impact:

- Numeric jumps `7` and `8` can update LGVS state/focus for Tags/Remotes.
- In a short SCM sidebar, VS Code may still not visibly scroll the `7 Tags` / `8 Remotes` native view headers into sight.
- Hacks tested and rejected: hiding every other panel, resizing views, blind `list.scrollDown`, forcing `focusSideBar`, and replacing all panels with one owned-scroll webview. Those made the UI worse or lied in screenshots.

Current release stance:

- Keep native SCM panels.
- Best-effort reveal only.
- Do not claim visual deep-panel reveal is fixed unless the dogfood screenshot proves it in a cramped window.

Verification command for this bug:

```bash
npm run dogfood:ui:cramped
```

The lane should prove that numeric jumps update LGVS focus/state for `7 Tags` and `8 Remotes` in a cramped window. It must not be interpreted as proof that VS Code reliably scrolled the native deep panel headers unless the saved screenshots show that exact visual outcome.

# Marketplace release notes

LazyGitVS is published on the Visual Studio Marketplace. Updates are released through GitHub Actions and require the Marketplace PAT repository secret.

## Intended publisher

Current package publisher ID:

```text
lazygitvs
```

Before publishing, `package.json` `publisher` must exactly match the publisher ID created in Marketplace. Change it only with an explicit publisher decision, not vibes.

## Human-only setup

Publisher and PAT management require Microsoft login in the browser, usually with 2FA/CAPTCHA. Do not put the PAT in git.

Create publisher:

```text
https://marketplace.visualstudio.com/manage
```

Create PAT:

- Scope: Marketplace → Manage
- Expiration: short/medium-lived, rotate when needed

## Publishing

GitHub Actions publishes release tags automatically.

Required repository secret:

```text
VSCE_PAT
```

Tag format must match `package.json` exactly:

```bash
# package.json version 0.1.98 -> tag v0.1.98
git tag v0.1.98
git push origin v0.1.98
```

The publish workflow checks release consistency, runs tests, packages the VSIX, publishes it to the Visual Studio Marketplace, and attaches the VSIX to the GitHub release.

For local/manual verification, use an environment variable, not a committed file:

```bash
export VSCE_PAT='REDACTED'
npx vsce verify-pat lazygitvs
npm run package:dist
npx vsce publish --packagePath dist/lazygitvs-<version>.vsix -p "$VSCE_PAT"
```

## Current package checks

Required files are present:

- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `resources/icon.png`
- `.vscodeignore`

Dangerous/local files excluded from VSIX:

- `.git/**`
- `src/**`
- `node_modules/**`
- `*.vsix`
- `*.log`
- `dogfood-output/**`
- `.vscode-test/**`
- `docs/plans/**`
- local/env files

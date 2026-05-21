# Building LazyGitVS

## Requirements

- Node.js 20+
- npm
- Git
- VS Code CLI (`code`) only if you want to install the generated VSIX locally

## Install dependencies

```bash
npm ci
```

## Test

```bash
npm test
```

## UI dogfood

```bash
npm run dogfood:ui
```

The dogfood run launches a real VS Code Extension Development Host and writes ignored evidence to:

```text
dogfood-output/
```

## Build VSIX

```bash
npm run package
```

Default dogfood/local output:

```text
../releases/LazyGitVS/lazygitvs-<version>.vsix
```

Portable repo-local output for CI/public artifacts:

```bash
npm run package:dist
# dist/lazygitvs-<version>.vsix
```

## Build to a custom local path

Use an environment override:

```bash
LGVS_VSIX_OUT_DIR=/path/to/output npm run package:local
```

Or a full file override:

```bash
LGVS_VSIX_OUT_FILE=/path/to/lazygitvs-custom.vsix npm run package:local
```

Keep local paths/env files out of Git.

## Install local VSIX

```bash
code --install-extension ../releases/LazyGitVS/lazygitvs-<version>.vsix --force
```

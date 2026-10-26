# CI/CD

Single-branch model: everything lives on `master`. Work happens on short-lived
branches that are merged back into `master` through pull requests.

| Branch      | Role                                       |
| ----------- | ------------------------------------------ |
| `master`    | Production. Tagged + published on merge.   |
| `feature/*`, `fix/*`, `hotfix/*` | Short-lived, branched from `master`, PR'd back into it. |

## Workflows

### `ci.yml` — quality gate
Runs on every PR and push to `master`: `npm ci`, lint (prettier + eslint + tsc), `build`, `test:ci`
and the bundle size budget (`npm run size`).
Exposes the **`verify`** status check used by branch protection.

### `pr-validation.yml` — release label
On every PR into `master`, enforces exactly one label among
`release:major` / `release:minor` / `release:patch` / `release:skip`.
Exposes the **`require-release-label`** status check.

### `release.yml` — release on merge (label-driven, approval-gated)
When a PR is merged into `master`:
1. **prepare** reads the release label and computes the bump (skips on `release:skip` or no label).
2. **release** waits for manual approval via the **`release`** environment, then:
   computes the next version from the latest git tag, builds, publishes to npm
   (`--access public`), pushes the `vX.Y.Z` tag and creates the GitHub Release.

The released version lives in the **git tag** and the **published npm package**, not
in a commit on `master`. Nothing is pushed to the protected `master` branch, so no
PAT or bypass rule is needed — `GITHUB_TOKEN` can push a tag. `package.json` on
`master` is only a baseline; the tag is the source of truth for the next bump.

A manual `workflow_dispatch` (with a `patch`/`minor`/`major` input) is available as a fallback.

### `deploy-pages.yml` — demo
On every push to `master`: builds the demo (`npm run build:demo`) and force-pushes
`dist-demo/` as an orphan commit on `gh-pages`, served at https://korial29.github.io/air-hockey/.
The demo plays over `BroadcastChannel` between tabs of the same browser, so it needs no server.

## One-time setup

Run the helper (requires `gh` with admin rights):

```bash
./.github/setup-repo.sh
```

It creates the labels and protects `master`.

Then **Settings → Pages →** source *Deploy from a branch*, branch `gh-pages`, folder `/`.

Then, in the GitHub UI:

1. **Settings → Environments →** create `release` and add yourself as a *required reviewer*.
   This is what turns the release into a *proposal* awaiting approval.
2. **Settings → Secrets and variables → Actions:**
   - `NPM_PUBLISH_TOKEN` — npm automation token, for `npm publish`. (Only secret required.)

## Day-to-day

1. Branch `feature/x` off `master`.
2. Open a PR into `master` with one `release:*` label.
3. Merge once CI is green.
4. Approve the `release` environment → it tags, publishes and creates the GitHub Release.

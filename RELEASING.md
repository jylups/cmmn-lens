# Releasing

The plugin and its server package (`@jylups/cmmn-lens-server`) are released
together, with the same version. The plugin starts the server with
`npx @jylups/cmmn-lens-server@<version>`, pinned in
`plugins/cmmn-lens/.mcp.json`, so a release publishes the server to npm first.

## Once: link the npm package to this repository

Releases are published by `.github/workflows/release.yml` with npm's trusted
publishing: GitHub Actions proves to npm which repository and workflow it runs,
so no npm token is stored anywhere.

1. On npmjs.com, open the package `@jylups/cmmn-lens-server`, then Settings,
   Trusted publishing, and add a GitHub Actions publisher: owner `jylups`,
   repository `cmmn-lens`, workflow `release.yml`.
2. If npmjs.com doesn't offer that before the package exists, publish the
   first version once by hand from a machine logged in to npm (`npm login`):

   ```bash
   npm run build
   npm publish --workspace server
   ```

   then add the trusted publisher, and use the workflow from the next release
   on. The workflow skips the npm step for a version that is on npm already,
   so pushing the tag still creates the GitHub release.

Provenance (the npm badge linking a version to its source) needs a public
repository, so it appears once this repository is public.

## Each release

1. Set the version everywhere it is written:

   ```bash
   node scripts/set-version.mjs 0.2.0
   ```

2. In `CHANGELOG.md`, give the version a dated entry, `## 0.2.0 (2026-12-01)`,
   listing what changed.
3. Commit, merge to `main`, then tag the merge commit and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow checks that the tag, the plugin's version, the server package's
version, the version `.mcp.json` pins and the changelog agree
(`scripts/check-release.mjs`), runs the lint, build and tests, publishes the
server to npm, and creates the GitHub release with the changelog entry.

People who installed the plugin get the new version with
`claude plugin update cmmn-lens@cmmn-lens`, or automatically if they turned on
auto-update for the marketplace.

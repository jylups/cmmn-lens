# Submitting cmmn-lens to the plugin directory (#19)

Prepared 2026-11-22 against the directory's [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist), [publish](https://claude.com/docs/directory/publish) and [submit](https://claude.com/docs/plugins/submit) pages, the [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) and the [Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms), and `claude plugin validate --strict --profile directory plugins/cmmn-lens` (Claude Code 2.1.330), which reports nothing. The directory runs more checks than the validator, plus a security scan and a human review.

## Status: waiting for Verified organization status

The first validation in the developer portal (2026-11-22) refused the submission: **the directory accepts command hooks, MCP servers that run on the user's computer, and scripts only from Verified organizations.** cmmn-lens needs all three (the viewer server reads and writes local files, the prompt hook supplies the selection), so it can't be listed from an organization that isn't Verified. The pages linked above don't state this rule; only the portal does.

- **Requesting Verified status**: on the portal's Submissions page, **Help and appeals → Request verified**. It needs a paid plan and a proven domain, and a person at Anthropic decides. The domain `cllc.io` was proven with a TXT record on its bare domain (2026-11-22); `www.cllc.io` is a CNAME, which can't hold a TXT record.
- **Once Verified**: validate again. The portal said a Verified organization may keep its commands as they are, though they can hold a version for a reviewer; the alternative it describes (plain shell scripts with no package launcher such as `npx`) would mean shipping the bundled server and the minified editor inside the plugin folder, which brings holds of its own. The plan is to keep the commands and expect the review.
- **Fixed after that first validation** (0.1.3): the README no longer shows a download-and-execute command (`curl … | bash`), which the portal flagged as an install-time risk, and the hook names its interpreter in `command` and its file in `args`, as the portal suggests.
- Until then, cmmn-lens installs for anyone from the public marketplace, as the READMEs describe.

## To do before submitting

- [x] **Approve the icon** (approved 2026-11-22): `plugins/cmmn-lens/.claude-plugin/icon.png` (1024 × 1024 PNG, 37 KB; source `docs/icon/icon.svg`). The directory takes it as the listing icon only the first time the plugin is saved or submitted; changing it later doesn't change the listing.
- [x] **Turn on private vulnerability reporting** (on since 2026-11-22). The plugin README sends security reports there, and the Terms ask for a way to receive them.
- [x] **Release 0.1.1** (released 2026-11-22): the server's tools now carry `title` and `destructiveHint` annotations, which the Policy (section 5E) asks for; the plugin pins the server version, so they reach users only with a release (`node scripts/set-version.mjs 0.1.1`, a dated changelog entry, tag `v0.1.1`; see RELEASING.md). Submit after that release, so the reviewed version has them.
- [ ] **Verified organization status**: see "Status" above.
- [ ] **Choose the contact email** for the Compliance step (it isn't written anywhere in the repository).
- [ ] **On claude.ai**: a Pro, Max, Ultra, Team or Enterprise plan; GitHub connected with an account that can push to `jylups/cmmn-lens`.

## Portal steps and what to enter

At [claude.ai/directory/manage](https://claude.ai/directory/manage): **Submit new**, then **Plugin bundle**.

1. **Source**: repository `jylups/cmmn-lens`, plugin path `plugins/cmmn-lens`, branch `main` (or the release tag). Validate; fix anything that blocks; validate again.
2. **Listing details**: read from `plugin.json` (name `cmmn-lens`, description) and the plugin folder's `README.md`, which becomes the listing description. Check how they read.
3. **Data handling**: suggested answers below.
4. **Compliance**: the contact email; the four acknowledgements.
5. **Review and submit**: updates by GitHub push (default). By default a reviewer publishes each passing version.

Limits: 10 submissions per organization per 24 hours (drafts and withdrawn ones count); one submission per repository folder per organization.

### Suggested data handling answers

- **Reads or stores personal data?** No. It reads the CMMN files Claude opens in the viewer and writes one only when the user saves from the viewer. The selection and the summary of saved changes are kept in the local server's memory until they are reported or the session ends.
- **Sends data to services beyond declared connectors?** No. The only network use is the local page on `127.0.0.1` and npx downloading the pinned server package from the npm registry on first use. No telemetry. In CMMN edit mode, the Help tool opens Flowable's public CMMN documentation in a new browser tab when the user clicks it, and in a BPMN or DMN view the bpmn.io watermark opens bpmn.io when clicked; nothing is sent with either.
- **How long is data kept?** Nothing is kept after the session: the server's registry file (port, token, project folder) is deleted when the server stops.
- **Intended for people under 18?** No; it is a developer tool for case model authors.

## Checklist

### Files and layout

- [x] Plugin folder `plugins/cmmn-lens/` with `.claude-plugin/plugin.json`; the repository is its own marketplace (`.claude-plugin/marketplace.json`).
- [x] `README.md` in the plugin folder (about 600 words), with what it does, the install line, example prompts, what it runs, reads and sends, settings, requirements and support. The directory reads only the plugin folder, so the root README doesn't count.
- [x] `LICENSE` (MIT) in the plugin folder, and `license` in `plugin.json`.
- [x] Everything the hook and the MCP server use is inside the plugin folder or comes from npm; no `..` paths.
- [x] No symlinks, submodules, LFS pointers, `.DS_Store` or other system files; no `.gitattributes`; no `.npmrc` or other package-manager config.
- [x] Sizes: 8 files in the plugin folder, the largest the icon (37 KB); the repository archives to about 132 KiB with 68 tracked files.
- [x] Readable source in the plugin folder; the minified editor bundle exists only in the npm package and is git-ignored.
- [x] No `package.json` or lockfile in the plugin folder (the root's development tooling is outside it).

### Manifest and name

- [x] Name `cmmn-lens`: lowercase, hyphenated, not a reserved word, not generic only, no third-party mark; free on GitHub and npm. Permanent once published.
- [x] `version` (0.3.0, raised each release, checked by CI against the server package and the pinned server), `description`, `author`, `homepage`, `repository`.
- [x] `hooks/hooks.json` is valid, under a top-level `hooks` object, with the documented `UserPromptSubmit` event and a `command` hook; not repeated in `plugin.json`.
- [x] `userConfig.selection_context`: a boolean with title, description and default; nothing sensitive.

### What it runs and connects to

- [x] `.mcp.json`: a stdio server declared with `command` and `args`, an exact version (`@jylups/cmmn-lens-server@0.3.0`), no `@latest` or range.
- [x] The hook runs `node` with its file in `args`, named from `${CLAUDE_PLUGIN_ROOT}` with no other variable, substitution or inline program.
- [x] No credentials in any file; no environment credential read or sent.
- [x] The README discloses everything it runs, reads, writes and sends, which is what the security scan compares against.
- [x] Tool descriptions match what the tools do; no hidden or remote instructions (Policy section 2).

### Expected reviewer holds

These are allowed, but the submission waits for a person:

- **The pinned npx server.** A pinned launcher package is always checked. Explanation for the reviewer: the server and its built viewer are published from this repository's `server/` folder (MIT, with third-party notices) by `.github/workflows/release.yml`, with npm provenance once trusted publishing runs; the plugin pins the exact version.
- **The `.mjs` hook script.** The validator doesn't follow non-shell scripts. It is a short, readable Node file with no dependencies, which reads the local server registry and calls `127.0.0.1`; the hook runs it as `node` with the file in `args`.

### Policy items

- [x] At least three working example prompts (Policy 3E): four in the plugin README.
- [x] Documentation of how it works and troubleshooting (3C): the plugin README, the repository README, RELEASING.md.
- [x] Support channel (3B): GitHub issues.
- [x] Security reports (Terms): private vulnerability reporting, on.
- [x] Privacy (1D, 1E, 1G, 3A): no user data collected or sent and no remote service, so no privacy policy link is needed as the policy reads; the prompt hook doesn't read or keep prompt text and stores nothing.
- [x] Tool annotations `readOnlyHint`, `destructiveHint`, `title` (5E): released with 0.1.1.
- [x] Current dependencies for a local server (5G).
- [x] Testing account (3D): not applicable; the plugin has no accounts or remote service.
- [x] Not an unsupported category, no endpoints it doesn't control, no implied endorsement by Anthropic (the README names Claude Code only to say what the plugin is for).

## After it is listed

Merging to `main` and raising the version is how a listing is updated; each new version is scanned (and reviewed unless auto-publish is turned on in the portal). Notify Anthropic of material changes to functionality, data practices or endpoints (Policy 3H).

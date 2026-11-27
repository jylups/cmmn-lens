# Changelog

All notable changes to the cmmn-lens plugin and its server package
(`@jylups/cmmn-lens-server`), which are released together with the same
version.

## 0.1.5 (2026-11-27)

- Edit mode takes `cmmn-js-properties-panel-flowable` 3.14.1: the model hierarchy's Models view (the forms, processes, cases and decisions the case refers to), radio choices for Asynchronous and Leave asynchronously, and fields for model keys, users and groups (plain text fields here, as the plugin offers no list of values to pick)
- Edit mode loads the cmmn-js touch module: touch gestures and larger targets on touch screens, nothing changed with a mouse or trackpad
- THIRD_PARTY_NOTICES.md also lists a license that a folder inside a package carries, such as cmmn-js's touch gestures from bpmn-js-touch-interaction (MIT)

## 0.1.4 (2026-11-23)

- Edit mode takes `@jylups/cmmn-js` 0.25.1 and `cmmn-js-properties-panel-flowable` 3.6.0: copy, cut and paste of case elements (Cmd/Ctrl+C, X, V; a pasted plan item gets its own definition, with its Flowable attributes), two-finger panning on touch screens, and the panel's Flowable Design views (the case's own properties when nothing is selected, the model tree, variable mappings as tables, rules and reactivation conditions as True or an expression)

## 0.1.3 (2026-11-22)

- The prompt hook names its interpreter in `command` and its file in `args`, as the plugin directory suggests; this form also starts on Windows without Git Bash
- The READMEs link to Claude Code's setup guide instead of showing a download-and-execute command, which the plugin directory flags as an install-time risk
- docs/directory-submission.md records that the directory accepts the plugin's local server, hook and script only from Verified organizations

## 0.1.2 (2026-11-22)

- The server package has no runtime dependencies: the server and everything it serves are bundled at build time, so npx downloads one package and the first start takes a second or two, also when several sessions start at once (0.1.1's first start could pass the 30-second limit with several sessions)
- The plugin README has a troubleshooting section

## 0.1.1 (2026-11-22)

- The plugin has an icon and a README of its own for the plugin directory listing
- The MCP tools' annotations carry their title and `destructiveHint: false`

## 0.1.0 (2026-11-22)

The first release.

- `cmmn-viewer` skill: Claude opens the viewer when it works on a local
  `.cmmn` file, validates after each edit, highlights what it changed, and
  reads the user's selection and saved changes
- Viewer page on `localhost`, beside the chat in the Claude desktop app's
  browser pane: follows the file as it changes, keeps the zoom and the
  selection, lists import problems, and shows the selection's properties
- Edit mode with the cmmn-js Modeler and the Flowable properties panel; saves
  write the file, and a change by Claude under unsaved edits asks which
  version to keep
- MCP tools: `open_view`, `validate`, `get_selection`, `highlight`,
  `get_changes`
- A prompt hook that tells Claude what the user selected (can be turned off)
  and what they changed and saved in the viewer

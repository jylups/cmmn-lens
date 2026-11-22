# Changelog

All notable changes to the cmmn-lens plugin and its server package
(`@jylups/cmmn-lens-server`), which are released together with the same
version.

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

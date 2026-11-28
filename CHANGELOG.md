# Changelog

All notable changes to the cmmn-lens plugin and its server package
(`@jylups/cmmn-lens-server`), which are released together with the same
version.

## 0.2.0 (2026-11-27)

- The server package's description and README name BPMN
- The server reads files through model types, so BPMN, DMN and forms are added one module each. CMMN works as before. An `.xml` file opens when its root element is in a model type's namespace (a CMMN `.xml` file as before); other `.xml` files are refused with a message instead of failing to parse
- The viewer page loads what the file's model type needs: its viewer script and styles with the page, and its editor bundle and styles on Edit. Following, selection, highlight, the properties panel, save and conflicts are shared by every type. The build writes each type's editor separately, under `public/build/<type>/` (the CMMN editor moves to `/assets/build/cmmn/editor.js`)
- BPMN: `.bpmn` and `.bpmn20.xml` files (and `.xml` files with a BPMN root element) open in a viewer built on `@jylups/flowable-bpmn-js` 0.1.0, and Edit opens its Modeler with the Flowable properties panel, lint and the touch module. Following, selection, highlight, save and conflicts work as for CMMN. `validate` checks BPMN with the Flowable descriptor (the Activiti namespace read as Flowable, unknown Flowable elements kept); `get_selection` describes Flowable attributes, flows in and out, conditions and defaults, event definitions, and the lane and process; `get_changes` and `highlight` work on BPMN files, a message or signal highlighting the events that use it
- The read-only properties panel shows a BPMN element's flows in and out with their conditions and the default flow, a flow's ends, event definitions, documentation, and its lane and process
- The skill opens the viewer for `.bpmn` and `.bpmn20.xml` files too, validates them after each edit, keeps their diagram in step and writes Flowable's conventions; the plugin's description and both READMEs cover BPMN
- The bpmn.io watermark stays visible in the BPMN viewer and editor, as bpmn-js' license requires; the notices list the BPMN packages and the BPMN font, and the READMEs' license sections name them
- `open_view` and `validate` report the file's model type (`type: "cmmn"`), and the tool descriptions name the model types and the files each accepts

## 0.1.6 (2026-11-27)

- Edit mode takes `@jylups/cmmn-js` 0.26.1 and its context pad tools, as in Flowable Design: Copy, Cut and Paste beside the selected element (Paste on the case plan and stages while something is copied), the tools on the left and the shapes to add on the right, tasks and milestones resizable from their corners, a button that collapses the palette, and Help, which opens Flowable's CMMN reference page for the element in a new browser tab. Their styles load only in edit mode
- Pasting a plan item with entry or exit criteria writes a valid model: the copy's criteria get their own sentries (cmmn-js 0.26.1; 0.1.4 and 0.1.5 left them on the original sentries, with diagram shapes that referred to missing ids)
- `cmmn-js-properties-panel-flowable` 3.14.2, which accepts cmmn-js 0.26

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

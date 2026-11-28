# cmmn-lens

A Claude Code plugin that shows the local Flowable CMMN file Claude is editing in an interactive viewer beside the chat. The view follows the file as it changes, lets you select and inspect elements, and tells Claude what you selected.

**Status:** 0.1.0 is released ([release notes](https://github.com/jylups/cmmn-lens/releases/tag/v0.1.0)); the plugin starts its server with `npx @jylups/cmmn-lens-server@0.1.0` from npm. See the [issues](https://github.com/jylups/cmmn-lens/issues) and milestones for what comes next.

## What it will run

- A local MCP server, started by Claude Code when the plugin is enabled.
- A web page served by that server on `localhost` only, with a random port and token. In the Claude desktop app the page opens in the built-in browser pane; in the terminal and VS Code it opens in your browser.
- It reads the `.cmmn` file you open in the viewer, and writes it only when you save from the viewer.
- While the server runs, it keeps a small file (its port, token and project folder) in a `cmmn-lens` folder under the system's temporary folder, readable only by you, so the plugin's prompt hook can find it.
- Before each prompt, a hook (Node) asks the running server for your selection in the viewer and adds it to the prompt's context. It can be turned off with the plugin's option.
- It sends nothing to other servers and collects no usage data. In edit mode, the **Help** tool opens Flowable's CMMN reference page for the selected element in a new browser tab when you click it.

## Requirements

Node 22 or later on the machine that runs Claude Code (the plugin's server and its prompt hook run with Node).

## Install

In a shell:

```bash
claude plugin install cmmn-lens --marketplace jylups/cmmn-lens
```

Or inside a Claude Code terminal session:

```
/plugin install cmmn-lens --marketplace jylups/cmmn-lens
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it available in every project). With a Claude Code older than 2.1.292, add the marketplace first: `claude plugin marketplace add jylups/cmmn-lens`, then `claude plugin install cmmn-lens@cmmn-lens`.

**Claude desktop app:** the app's sessions use the same plugins as the `claude` command, so the command above installs the plugin there too; start a new session afterwards. The app doesn't add a `claude` command to your shell: if `claude` isn't found, install the command-line tool as [Claude Code's setup guide](https://code.claude.com/docs/en/setup) describes.

The install may say an option isn't set: that is **Add the viewer selection to prompts**, which is on until you turn it off.

## Update

Plugins from this marketplace don't update by themselves unless you turn on auto-update for it. To update:

```bash
claude plugin marketplace update cmmn-lens
```

```bash
claude plugin update cmmn-lens@cmmn-lens
```

Then start a new session: a session loads its plugins when it starts.

## Use it in a project

The plugin's `cmmn-viewer` skill tells Claude to open the viewer when it works on a local `.cmmn` file, before it changes anything, and to validate the file after each edit. In the Claude desktop app the view opens in the built-in browser pane, beside the chat; elsewhere Claude gives you its URL.

When you save changes in the view's edit mode, the plugin tells Claude what you changed in your next prompt, once. When you select elements in the view, the plugin adds them to each prompt's context, so you can say "rename this" or "what does this do?" without naming the element. To turn that off, set the plugin's **Add the viewer selection to prompts** option to off (`/config`, or the plugin's settings in the desktop app).

To make sure Claude uses it in a project that keeps CMMN models, add this to the project's `CLAUDE.md`, with your own folder:

```markdown
## CMMN models

The case models are in `models/`. When you work on one, use the cmmn-viewer skill:
open it in the viewer before you change it, and validate it after each edit.
```

## Repository layout

| Path | What it is |
|---|---|
| `.claude-plugin/marketplace.json` | The marketplace that lists the plugin |
| `plugins/cmmn-lens/` | The plugin folder that Claude Code installs: the `cmmn-viewer` skill and the prompt hook |
| `server/` | The MCP server and the viewer page (`@jylups/cmmn-lens-server` on npm) |
| `scripts/` | Release helpers: set the version, check a release tag, print a changelog entry |
| `spikes/native-pane/` | A prototype pane mod, not shipped; see [docs/spikes/native-pane.md](docs/spikes/native-pane.md) |
| `docs/` | Notes, spike write-ups, the icon's source and the [directory submission checklist](docs/directory-submission.md) |
| `tests/` | Checks of the manifests |

## Development

Requires Node 22 or later.

```bash
npm install
npm run build
npm run lint
npm test
```

`npm run build` builds the server package as it is published, so it runs with no dependencies installed: `server/dist/server.mjs` (the MCP server, bundled), `server/public/vendor/` (the cmmn-js viewer and the Flowable descriptor the page loads) and `server/public/build/` (the Modeler and the Flowable properties panel for edit mode). Git ignores all three. Run it before using the server from this repository; `npm test` runs it first.

Validate the manifests with the Claude Code CLI:

```bash
claude plugin validate --strict .
claude plugin validate --strict plugins/cmmn-lens
```

### The viewer server

`server/` is an MCP server (stdio) with five tools so far: `open_view`, `validate`, `get_selection`, `highlight` and `get_changes`.

`open_view`: given the path of a `.cmmn` file, it starts a web server on `127.0.0.1` with a random port, and returns the URL of a page that shows the diagram with the cmmn-js viewer and the Flowable extensions. Calling it again for the same file returns the same URL. Every page and file request needs the server's random token, and the web server stops when the MCP server exits.

The page follows the file: the server watches the file's folder and tells the page, over server-sent events, when the content changes, so edits, shell writes and editors' saves all show within a second. The page keeps the zoom and scroll position, lists import errors and warnings under its bar, and keeps the last version that opened when a new one doesn't, or when the file is deleted.

**Edit** switches the page to the cmmn-js Modeler with the Flowable properties panel (copy, cut and paste with Cmd/Ctrl+C, X, V); **Save** (or Cmd/Ctrl+S) writes the model to the file, replacing it in one step and keeping its permissions, and **Done** goes back to the viewer. While there are no unsaved edits, changes to the file still show in the editor. When the file changes under unsaved edits (Claude edited it, say), a bar asks whether to load the file's version or keep your edits, and a save made on an older version is refused, so neither side's change is lost without you choosing.

Beside the diagram (under it when the pane is narrow) a read-only properties panel shows the selected elements as the file has them: the task or other item a plan item stands for, its attributes, its entry and exit criteria with their sentries, and its stage. It can be hidden. A page that loads again shows the selection the server holds.

`validate`: given the path of a `.cmmn` file, it parses it the way the viewer does, with the CMMN and Flowable descriptors, and lists the problems with their element ids and lines. Errors are XML that doesn't parse, duplicate ids and references to elements that don't exist. Warnings are attributes nothing reads and elements with no shape in the diagram, which the viewer can't show.

While it runs, the server lists itself (port, token, project folder) in a registry folder under the system's temporary folder, readable only by you, and removes the entry when it stops. The plugin's `UserPromptSubmit` hook (`plugins/cmmn-lens/hooks/selection-context.mjs`) reads the servers of the session's project, asks each for its selection (`GET /selection`, with the token), and adds the newest to the prompt's context, with the changes the user saved since the last prompt (`GET /changes`).

`get_selection`: the page posts the user's selection to the server as it changes, and keeps it across updates of the file. The tool describes the selected elements from the file as it is now: the task or other item a plan item stands for, its attributes, its entry and exit criteria with their sentries, and its stage. Without a path it reads the viewer whose selection changed last.

`highlight`: marks elements in the view and scrolls them into view, until the file changes again. A task, stage or milestone is marked through the plan items that use it, and a sentry through its criteria. The mark applies to the version of the file it was made for, so a highlight sent right after an edit shows once the page has that version.

`get_changes`: when the user saves from the viewer, the server compares the version it replaces with the new one, element by element (added, removed and changed elements, with each change before and after, and a count of moved shapes), and keeps the result until the agent has seen it. The tool returns it once; the prompt hook adds it to the next prompt.

To try it, open a Claude Code session in this folder: `.mcp.json` registers the server as `cmmn-lens-dev` (approve it when asked), and `server/test/fixtures/claim.cmmn` is a small sample. The plugin itself starts the server from the published npm package once that exists.

Releases: see [RELEASING.md](RELEASING.md) and [CHANGELOG.md](CHANGELOG.md).

Load the plugin from the working copy for one session:

```bash
claude --plugin-dir plugins/cmmn-lens
```

## Licenses

cmmn-lens is [MIT](LICENSE) licensed.

The server package includes code and files from other packages, bundled into the server or a model type's editor, or copied into `public/vendor`: for CMMN, the cmmn-js fork and diagram-js, the CMMN and Flowable moddle packages and the Flowable properties panel; for BPMN, bpmn-js and diagram-js, flowable-bpmn-js with its Flowable moddle, behaviors and properties panel, the bpmn.io properties panel and bpmnlint; and their dependencies. [`server/THIRD_PARTY_NOTICES.md`](server/THIRD_PARTY_NOTICES.md) lists each with its version, license and license text; `npm run build` writes it, CI checks that it matches the build, and the npm package ships it. They are MIT, ISC, BSD-3-Clause or Apache-2.0 licensed, except:

- the CMMN font (`cmmn-font`) and the BPMN font (`bpmn-font`): SIL Open Font License 1.1
- the Font Awesome icons the CMMN properties panel draws (`@fortawesome/free-solid-svg-icons`): CC BY 4.0 for the icons, MIT for the code
- `bpmn-js`: the bpmn.io license, see below
- `@jylups/cmmn-js`: MIT terms in its own LICENSE file, which its `package.json` points to

**The bpmn.io watermark.** bpmn-js' license requires the bpmn.io watermark that links to bpmn.io to stay fully visible and not be covered. The BPMN viewer and editor show it in the canvas's bottom right corner, left of the properties panel, with nothing over it; don't hide or cover it when changing the page. The LICENSE of the cmmn-js fork ([jylups/cmmn-js](https://github.com/jylups/cmmn-js)) in the version bundled here, 0.26.1, has no watermark clause.

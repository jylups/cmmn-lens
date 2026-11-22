# cmmn-lens

A Claude Code plugin that shows the local Flowable CMMN file Claude is editing in an interactive viewer beside the chat. The view follows the file as it changes, lets you select and inspect elements, and tells Claude what you selected.

**Status:** in development. The plugin has the `cmmn-viewer` skill, and `server/` has the viewer and its tools (`open_view`, `validate`, `get_selection`, `highlight`), but the plugin doesn't start the server yet: that comes once the server is published to npm. Until then, try the tools in a session opened in this repository (see [The viewer server](#the-viewer-server)). See the [issues](https://github.com/jylups/cmmn-lens/issues) and milestones for the plan.

## What it will run

- A local MCP server, started by Claude Code when the plugin is enabled.
- A web page served by that server on `localhost` only, with a random port and token. In the Claude desktop app the page opens in the built-in browser pane; in the terminal and VS Code it opens in your browser.
- It reads the `.cmmn` file you open in the viewer, and writes it only when you save from the viewer.
- While the server runs, it keeps a small file (its port, token and project folder) in a `cmmn-lens` folder under the system's temporary folder, readable only by you, so the plugin's prompt hook can find it.
- Before each prompt, a hook (Node) asks the running server for your selection in the viewer and adds it to the prompt's context. It can be turned off with the plugin's option.
- It sends nothing to other servers and collects no usage data.

## Install

In a Claude Code terminal session:

```
/plugin install cmmn-lens --marketplace jylups/cmmn-lens
```

Answer `y` to add the marketplace, then pick a scope. In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `jylups/cmmn-lens`, then **Add plugin**.

While the repository is private, only people with access to it can install the plugin.

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
| `server/` | The MCP server and the viewer page (`@jylups/cmmn-lens-server`, not published yet) |
| `tests/` | Checks of the manifests |

## Development

Requires Node 22 or later.

```bash
npm install
npm run build
npm run lint
npm test
```

`npm run build` bundles what the page loads in edit mode (the cmmn-js Modeler and the Flowable properties panel, which have no browser bundle of their own) into `server/public/build/`, which git ignores. View mode works without it.

Validate the manifests with the Claude Code CLI:

```bash
claude plugin validate --strict .
claude plugin validate --strict plugins/cmmn-lens
```

### The viewer server

`server/` is an MCP server (stdio) with five tools so far: `open_view`, `validate`, `get_selection`, `highlight` and `get_changes`.

`open_view`: given the path of a `.cmmn` file, it starts a web server on `127.0.0.1` with a random port, and returns the URL of a page that shows the diagram with the cmmn-js viewer and the Flowable extensions. Calling it again for the same file returns the same URL. Every page and file request needs the server's random token, and the web server stops when the MCP server exits.

The page follows the file: the server watches the file's folder and tells the page, over server-sent events, when the content changes, so edits, shell writes and editors' saves all show within a second. The page keeps the zoom and scroll position, lists import errors and warnings under its bar, and keeps the last version that opened when a new one doesn't, or when the file is deleted.

**Edit** switches the page to the cmmn-js Modeler with the Flowable properties panel; **Save** (or Cmd/Ctrl+S) writes the model to the file, replacing it in one step and keeping its permissions, and **Done** goes back to the viewer. While there are no unsaved edits, changes to the file still show in the editor. When the file changes under unsaved edits (Claude edited it, say), a bar asks whether to load the file's version or keep your edits, and a save made on an older version is refused, so neither side's change is lost without you choosing.

Beside the diagram (under it when the pane is narrow) a read-only properties panel shows the selected elements as the file has them: the task or other item a plan item stands for, its attributes, its entry and exit criteria with their sentries, and its stage. It can be hidden. A page that loads again shows the selection the server holds.

`validate`: given the path of a `.cmmn` file, it parses it the way the viewer does, with the CMMN and Flowable descriptors, and lists the problems with their element ids and lines. Errors are XML that doesn't parse, duplicate ids and references to elements that don't exist. Warnings are attributes nothing reads and elements with no shape in the diagram, which the viewer can't show.

While it runs, the server lists itself (port, token, project folder) in a registry folder under the system's temporary folder, readable only by you, and removes the entry when it stops. The plugin's `UserPromptSubmit` hook (`plugins/cmmn-lens/hooks/selection-context.mjs`) reads the servers of the session's project, asks each for its selection (`GET /selection`, with the token), and adds the newest to the prompt's context, with the changes the user saved since the last prompt (`GET /changes`).

`get_selection`: the page posts the user's selection to the server as it changes, and keeps it across updates of the file. The tool describes the selected elements from the file as it is now: the task or other item a plan item stands for, its attributes, its entry and exit criteria with their sentries, and its stage. Without a path it reads the viewer whose selection changed last.

`highlight`: marks elements in the view and scrolls them into view, until the file changes again. A task, stage or milestone is marked through the plan items that use it, and a sentry through its criteria. The mark applies to the version of the file it was made for, so a highlight sent right after an edit shows once the page has that version.

`get_changes`: when the user saves from the viewer, the server compares the version it replaces with the new one, element by element (added, removed and changed elements, with each change before and after, and a count of moved shapes), and keeps the result until the agent has seen it. The tool returns it once; the prompt hook adds it to the next prompt.

To try it, open a Claude Code session in this folder: `.mcp.json` registers the server as `cmmn-lens-dev` (approve it when asked), and `server/test/fixtures/claim.cmmn` is a small sample. The plugin itself starts the server from the published npm package once that exists.

Load the plugin from the working copy for one session:

```bash
claude --plugin-dir plugins/cmmn-lens
```

## Licenses

cmmn-lens is [MIT](LICENSE) licensed.

The viewer page includes code and files from other packages, bundled into the editor or served from `node_modules`: the cmmn-js fork and diagram-js, the CMMN and Flowable moddle packages, the Flowable properties panel and their dependencies. [`server/THIRD_PARTY_NOTICES.md`](server/THIRD_PARTY_NOTICES.md) lists each with its version, license and license text; `npm run build` writes it, CI checks that it matches the build, and the npm package ships it. They are MIT, ISC or Apache-2.0 licensed, except:

- the CMMN font (`cmmn-font`): SIL Open Font License 1.1
- the Font Awesome icons the properties panel draws (`@fortawesome/free-solid-svg-icons`): CC BY 4.0 for the icons, MIT for the code
- `@jylups/cmmn-js`: see below

**The bpmn.io watermark.** The LICENSE of the cmmn-js fork ([jylups/cmmn-js](https://github.com/jylups/cmmn-js)) has had no watermark clause since commit `ccfcc40` (2026-11-22). The version bundled here, 0.24.1, was released before that commit, so its LICENSE file, reproduced in the notices, still has the clause. A cmmn-js release with the updated LICENSE carries the new terms into this repository once the dependency is updated.

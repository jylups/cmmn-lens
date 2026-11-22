# cmmn-lens

A Claude Code plugin that shows the local Flowable CMMN file Claude is editing in an interactive viewer beside the chat. The view follows the file as it changes, lets you select and inspect elements, and tells Claude what you selected.

**Status:** in development. The plugin has the `cmmn-viewer` skill, and `server/` has the viewer and its tools (`open_view`, `validate`), but the plugin doesn't start the server yet: that comes once the server is published to npm. Until then, try the tools in a session opened in this repository (see [The viewer server](#the-viewer-server)). See the [issues](https://github.com/jylups/cmmn-lens/issues) and milestones for the plan.

## What it will run

- A local MCP server, started by Claude Code when the plugin is enabled.
- A web page served by that server on `localhost` only, with a random port and token. In the Claude desktop app the page opens in the built-in browser pane; in the terminal and VS Code it opens in your browser.
- It reads the `.cmmn` file you open in the viewer, and writes it only when you save from the viewer.
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
| `plugins/cmmn-lens/` | The plugin folder that Claude Code installs |
| `server/` | The MCP server and the viewer page (`@jylups/cmmn-lens-server`, not published yet) |
| `tests/` | Checks of the manifests |

## Development

Requires Node 22 or later.

```bash
npm install
npm run lint
npm test
```

Validate the manifests with the Claude Code CLI:

```bash
claude plugin validate --strict .
claude plugin validate --strict plugins/cmmn-lens
```

### The viewer server

`server/` is an MCP server (stdio) with two tools so far, `open_view` and `validate`.

`open_view`: given the path of a `.cmmn` file, it starts a web server on `127.0.0.1` with a random port, and returns the URL of a page that shows the diagram with the cmmn-js viewer and the Flowable extensions. Calling it again for the same file returns the same URL. Every page and file request needs the server's random token, and the web server stops when the MCP server exits.

The page follows the file: the server watches the file's folder and tells the page, over server-sent events, when the content changes, so edits, shell writes and editors' saves all show within a second. The page keeps the zoom and scroll position, lists import errors and warnings under its bar, and keeps the last version that opened when a new one doesn't, or when the file is deleted.

`validate`: given the path of a `.cmmn` file, it parses it the way the viewer does, with the CMMN and Flowable descriptors, and lists the problems with their element ids and lines. Errors are XML that doesn't parse, duplicate ids and references to elements that don't exist. Warnings are attributes nothing reads and elements with no shape in the diagram, which the viewer can't show.

To try it, open a Claude Code session in this folder: `.mcp.json` registers the server as `cmmn-lens-dev` (approve it when asked), and `server/test/fixtures/claim.cmmn` is a small sample. The plugin itself starts the server from the published npm package once that exists.

Load the plugin from the working copy for one session:

```bash
claude --plugin-dir plugins/cmmn-lens
```

## License

[MIT](LICENSE). The viewer will bundle third-party packages under their own licenses; their notices will ship with it.

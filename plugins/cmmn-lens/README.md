# cmmn-lens

See the Flowable CMMN case model Claude is working on, beside the chat. When Claude creates, edits, reviews or explains a local `.cmmn` file, the cmmn-lens plugin opens an interactive viewer of it, keeps the view in step with every change, and lets you point at elements instead of naming them.

In the Claude desktop app the viewer opens in the built-in browser pane, beside the chat; in the terminal and VS Code, Claude gives you a link to open it in your browser.

## Install

In a Claude Code terminal session:

```
/plugin install cmmn-lens --marketplace jylups/cmmn-lens
```

In the Claude desktop app: **+** next to the prompt box, then **Plugins**, **Add marketplace** with `jylups/cmmn-lens`, then **Add plugin**.

## What it does

- **Follows the file.** The diagram updates within a second of each change, whoever made it, and keeps your zoom, position and selection. Import errors and warnings are listed under the view.
- **Validates.** After each edit Claude checks the file with the CMMN and Flowable descriptors (broken references, duplicate ids, unknown attributes, elements with no shape) and fixes what it broke.
- **Points at changes.** Claude highlights the elements it added or changed.
- **Knows what you select.** Click an element and say "rename this" or "what does this do?". The properties panel shows the selection's Flowable attributes and criteria.
- **Lets you edit.** Edit mode has the Flowable properties panel; saving writes the file. If Claude changed the file while you had unsaved edits, the viewer asks which version to keep, and Claude is told what you changed and saved.

## Try it

- "Open `models/claim.cmmn` and explain the case plan."
- "Add a human task 'Check documents' before 'Approve the claim', for the group `clerks`."
- Select a task in the view, then: "What starts this task?"
- After editing in the view: "I moved two tasks into a new stage. Check the model still validates."

## What it runs, reads and sends

- **A local MCP server**, started by Claude Code with `npx @jylups/cmmn-lens-server@<pinned version>`. On first use npx downloads that package from the npm registry; nothing else is downloaded.
- **A web page on `127.0.0.1` only**, with a random port and a random token in its address; requests without the token, or from pages on other sites, are refused. It stops with the MCP server.
- **Files:** it reads the `.cmmn` (or `.xml`) files Claude opens in the viewer, and writes one only when you save from the viewer. While it runs, it keeps a small file (its port, token and project folder) in a `cmmn-lens` folder under the system's temporary folder, readable only by you, so the prompt hook can find it.
- **A prompt hook** (Node) runs before each prompt. It asks the local server for your selection in the viewer and for changes you saved there, and adds them to the prompt's context. It doesn't read or keep the text of your prompts, and it stores nothing.
- **Nothing leaves your machine:** no other network requests, no telemetry, no accounts.

## Settings

**Add the viewer selection to prompts** (on by default): turn it off to stop the hook adding your selection. Changes you save in the viewer are always reported, since saving is your own act. Change it in `/config`, or in the plugin's settings in the desktop app.

## Requirements

Node 22 or later on the machine that runs Claude Code.

## Support

Report problems and ask questions in the [issues](https://github.com/jylups/cmmn-lens/issues). Report security problems privately through the repository's [security advisories](https://github.com/jylups/cmmn-lens/security/advisories/new).

## License

MIT. The viewer includes third-party packages under their own licenses, listed in the server package's `THIRD_PARTY_NOTICES.md`.

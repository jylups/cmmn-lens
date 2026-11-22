---
name: cmmn-viewer
description: Show a local CMMN (.cmmn) case model in the cmmn-lens viewer while you create, edit, review or explain it, and validate it after each edit. Use whenever you work on a local .cmmn file, Flowable case model or case plan, even if the user doesn't ask to see it.
---

# Showing a CMMN model while you work on it

The cmmn-lens MCP server has these tools for local CMMN files:

- `open_view` opens a viewer for a file and returns its URL on `localhost`. The page follows the file: each time the file changes, the diagram updates within a second, keeping the user's zoom and position. Calling it again for the same file returns the same URL (`isReused: true`).
- `validate` parses a file the way the viewer does, with the CMMN and Flowable descriptors, and lists the problems with their element ids and lines.
- `highlight` marks elements in a viewer and scrolls them into view, until the file changes again.
- `get_selection` returns the elements the user has selected in a viewer, described from the file as it is now: the task or other item a plan item stands for, its attributes (Flowable ones included), its entry and exit criteria with their sentries, and its stage.

They take a path, absolute or relative to the working directory, of a `.cmmn` or `.xml` file; for `get_selection` and `highlight` it is optional (the viewer used last).

## When you start on a file

As soon as you work on a local `.cmmn` file, whether you read it to explain it, edit it, or create it, open the view once, before you change anything:

1. Call `open_view` with the file's path.
2. Show the URL to the user:
   - If you have a built-in browser pane (the Claude desktop app's browser tools, such as `preview_start` with a `url`), open the URL there, so the diagram sits beside the chat.
   - Otherwise, give the URL as a link and say it opens the diagram in a browser.
3. Don't open the view again for the same file in the same session: the page already follows every change. If the user closed it, give them the URL again.

For a new file, write it first (with a diagram, see below), then open the view.

## When the user points at the diagram

When the user refers to part of the model without naming it ("this task", "the selected one", "what I clicked", "what does this do?"), use what they have selected in the view. The plugin usually adds it to the prompt's context ("The user has selected in the cmmn-lens viewer of …"); when that is missing, or you need it again later in the turn, call `get_selection`. Answer about the elements it names. Use their ids when you edit them. If nothing is selected, ask the user to click the element in the view. The selection stays across updates of the file, so after an edit it still names the same elements.

## After each edit

1. Call `validate` on the file.
2. Fix every error before you go on: XML that doesn't parse, duplicate ids, and references to elements that don't exist make the model wrong.
3. Look at the warnings. Fix the ones you caused, such as a misspelled `flowable:` attribute or a plan item with no shape. Mention the others to the user rather than changing what you weren't asked to change.
4. Call `highlight` with the ids of the elements you added or changed, so the user sees where the change is. A task's or sentry's id is fine: the plan items or criteria that show it are marked. Skip this for a change that touches most of the model.
5. Don't tell the user to reload the view: it updates by itself.

When you explain part of a model, you can also `highlight` the elements you are talking about.

## Keep the diagram in step with the model

The viewer only draws elements that have a shape in the diagram (`cmmndi:CMMNDI`). When you add a plan item, discretionary item, entry or exit criterion, or the case plan model, also add its `cmmndi:CMMNShape` with `dc:Bounds`, placed where it doesn't overlap other shapes and inside its stage or case plan model. When you add an on part that should be drawn, add its `cmmndi:CMMNEdge` with waypoints. When you remove an element, remove its shapes and edges too. `validate` warns about elements without a shape.

## Work on the local copy only

Change only the local file. Don't deploy it, upload it or write it to a running Flowable server unless the user asks for that as a separate step. If the user shares a model from a running system, save it as a local file first and open the view on that.

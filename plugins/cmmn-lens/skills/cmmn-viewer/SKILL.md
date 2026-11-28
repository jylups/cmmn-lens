---
name: cmmn-viewer
description: Show a local CMMN case model (.cmmn) or BPMN process model (.bpmn, .bpmn20.xml) in the cmmn-lens viewer while you create, edit, review or explain it, and validate it after each edit. Use whenever you work on a local .cmmn, .bpmn or .bpmn20.xml file, a Flowable case model, case plan or process definition, even if the user doesn't ask to see it.
---

# Showing a CMMN or BPMN model while you work on it

The cmmn-lens MCP server has these tools for local CMMN and BPMN files:

- `open_view` opens a viewer for a file and returns its URL on `localhost` and the file's model type (`cmmn` or `bpmn`). The page follows the file: each time the file changes, the diagram updates within a second, keeping the user's zoom and position. Calling it again for the same file returns the same URL (`isReused: true`).
- `validate` parses a file the way the viewer does, with the CMMN or BPMN descriptors and the Flowable ones, and lists the problems with their element ids and lines.
- `highlight` marks elements in a viewer and scrolls them into view, until the file changes again.
- `get_changes` returns what the user changed and saved in a viewer since you last looked: elements added, removed and changed, and how many shapes moved. Each change is returned once.
- `get_selection` returns the elements the user has selected in a viewer, described from the file as it is now, with their attributes (Flowable ones included). In CMMN: the task or other item a plan item stands for, its entry and exit criteria with their sentries, and its stage. In BPMN: the flows in and out of a node with their conditions and the default flow, a flow's ends, an event's definitions, and the lane and process or sub-process.

They take a path, absolute or relative to the working directory, of a `.cmmn`, `.bpmn` or `.bpmn20.xml` file, or an `.xml` file whose root element is CMMN or BPMN; for `get_selection` and `highlight` it is optional (the viewer used last).

## When you start on a file

As soon as you work on a local `.cmmn`, `.bpmn` or `.bpmn20.xml` file, whether you read it to explain it, edit it, or create it, open the view once, before you change anything:

1. Call `open_view` with the file's path.
2. Show the URL to the user:
   - If you have a built-in browser pane (the Claude desktop app's browser tools, such as `preview_start` with a `url`), open the URL there, so the diagram sits beside the chat.
   - Otherwise, give the URL as a link and say it opens the diagram in a browser.
3. Don't open the view again for the same file in the same session: the page already follows every change. If the user closed it, give them the URL again.

For a new file, write it first (with a diagram, see below), then open the view.

## When the user points at the diagram

When the user refers to part of the model without naming it ("this task", "the selected one", "what I clicked", "what does this do?"), use what they have selected in the view. The plugin usually adds it to the prompt's context ("The user has selected in the cmmn-lens viewer of …"); when that is missing, or you need it again later in the turn, call `get_selection`. Answer about the elements it names. Use their ids when you edit them. If nothing is selected, ask the user to click the element in the view. The selection stays across updates of the file, so after an edit it still names the same elements.

## When the user edits in the viewer

The viewer has an edit mode: the user can change the model and save it to the file. The plugin adds what they saved to the next prompt's context ("The user changed … in the cmmn-lens viewer and saved it"); when the user says they changed the model and that context is missing, call `get_changes`. Either way, read the file again before you edit it, so you don't overwrite their work with what you remember.

If the user has unsaved edits in the viewer when you change the file, the viewer asks them which version to keep; your change isn't lost unseen.

## After each edit

1. Call `validate` on the file.
2. Fix every error before you go on: XML that doesn't parse, duplicate ids, and references to elements that don't exist make the model wrong.
3. Look at the warnings. Fix the ones you caused, such as a misspelled `flowable:` attribute, or a plan item or flow node with no shape. Mention the others to the user rather than changing what you weren't asked to change.
4. Call `highlight` with the ids of the elements you added or changed, so the user sees where the change is. In CMMN a task's or sentry's id is fine: the plan items or criteria that show it are marked. In BPMN a message's or signal's id marks the events that use it, and a process's id the pools that show it. Skip this for a change that touches most of the model.
5. Don't tell the user to reload the view: it updates by itself.

When you explain part of a model, you can also `highlight` the elements you are talking about.

## Keep the diagram in step with the model

The viewer only draws elements that have a shape or edge in the diagram. `validate` warns about elements without one.

In CMMN, the diagram is `cmmndi:CMMNDI`. When you add a plan item, discretionary item, entry or exit criterion, or the case plan model, also add its `cmmndi:CMMNShape` with `dc:Bounds`, placed where it doesn't overlap other shapes and inside its stage or case plan model. When you add an on part that should be drawn, add its `cmmndi:CMMNEdge` with waypoints. When you remove an element, remove its shapes and edges too.

In BPMN, the diagram is the `bpmndi:BPMNDiagram` whose `bpmndi:BPMNPlane` points at the process (or at the collaboration, when there are pools). When you add a task, event, gateway, sub-process, pool, lane, data object or annotation, also add its `bpmndi:BPMNShape` with `dc:Bounds`, placed where it doesn't overlap other shapes and inside its pool, lane or expanded sub-process; put a boundary event on its task's border. When you add a sequence flow, message flow or association, add its `bpmndi:BPMNEdge` with `di:waypoint`s from the source's border to the target's. When you remove an element, remove its shape or edge, and the sequence flows that start or end on it.

## Flowable BPMN conventions

Flowable deploys `.bpmn20.xml` and `.bpmn` files. Write Flowable attributes and extension elements with the `flowable:` prefix (`xmlns:flowable="http://flowable.org/bpmn"`), not `activiti:`; the viewer reads `activiti:` as Flowable, and saving from the viewer writes `flowable:`. Give conditions as `<conditionExpression xsi:type="tFormalExpression">${...}</conditionExpression>`, and name a gateway's default flow with its `default` attribute. Keep the process `isExecutable="true"` and the file's `targetNamespace`.

## Work on the local copy only

Change only the local file. Don't deploy it, upload it or write it to a running Flowable server unless the user asks for that as a separate step. If the user shares a model from a running system, save it as a local file first and open the view on that.

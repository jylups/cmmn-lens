# @jylups/cmmn-lens-server

The MCP server of the [cmmn-lens](https://github.com/jylups/cmmn-lens) plugin
for Claude Code. The plugin starts it; you don't need to install it yourself.

It serves an interactive viewer for local Flowable CMMN and BPMN files on `localhost`
(random port and token), which follows the file as it changes, shows the
selected elements' properties, and has an edit mode with the Flowable
properties panel. Its tools let Claude open the viewer (`open_view`), check a
file (`validate`), read the user's selection (`get_selection`) and saved
changes (`get_changes`), and point at elements (`highlight`).

It reads the files it is asked to open, writes one only when the user saves
from the viewer, and sends nothing to other servers.

Requires Node 22 or later. MIT licensed; the third-party packages the viewer
includes are listed in `THIRD_PARTY_NOTICES.md`.

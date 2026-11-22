# Spike: the diagram in a native pane (#14)

**Recommendation: drop the native pane for now.** The desktop app's browser pane already shows the full interactive viewer beside the chat; a native pane would show a static, size-limited picture of the same diagram, needs that same viewer page open to get its picture, and builds on an API that is still moving. Keep the prototype in `spikes/native-pane/` as a reference; it isn't part of the plugin.

Checked on Claude Code 2.1.330, 2026-11-22.

## What a pane can draw

A mod (function-hooks plugin) draws panes from declared elements; it has no DOM, so cmmn-js and diagram-js can't run in it. The closest element is `Svg`:

- **Static.** The SVG is drawn as an image, or, with `isInteractive`, in a sandboxed frame with no scripts, where hover, CSS `:hover` and `<title>` tooltips work. Clicks on shapes don't reach the mod: `Svg` is a leaf, and a press goes to an enclosing element.
- **Size-limited.** At most 131,072 characters of markup; a larger tree is refused.
- **Not everywhere.** Desktop, VS Code and mobile draw it; the terminal doesn't (its element table still resolves an `Svg`, which it draws as nothing, so the mod has to check the surface). The terminal has `Image` for pixels, which would need the SVG rasterized (a WebAssembly rasterizer through `$.wasm` is possible, but heavy).
- **Client modules don't help.** A `Client` region gets pointer and key events, but draws with the terminal's element table, which has no `Svg`.

## How big the SVG gets

The page's drawn canvas, serialized without diagram-js's hit areas:

| Model | Elements | SVG characters |
|---|---|---|
| `claim.cmmn` (the test sample) | 11 | 7,565 |
| `complex.cmmn` (a cmmn-js test model) | 47 | 32,932 |

That is about 700 characters per element, so the limit is reached at roughly 180 elements, which real case models can pass (stages, tasks, criteria, connectors and labels each count).

**Found on the way:** `saveSVG` of `@jylups/cmmn-js` 0.24.1 returns an empty drawing (`width="0" height="0"`, only the marker definitions), apparently a mismatch with diagram-js 15. A snapshot would have to be serialized from the page's canvas instead. Worth an issue in jylups/cmmn-js regardless of this spike.

## Where the picture would come from

The server runs in Node with no DOM or layout, so it can't draw the diagram itself without writing a second renderer. The picture would come from the viewer page: after each import it would post its serialized canvas to the server (a new `GET /snapshot` route), and the pane would fetch it through the registry, as the prompt hook does (`$.http.fetch` to `127.0.0.1`, reading the registry with `$.fs` and `TMPDIR`). So the pane only works while the browser page is open, which is when it is least needed.

## The prototype

`spikes/native-pane/` is a mod with a `/cmmn-pane` command and a pane that shows the snapshot's name, the diagram as `Svg` (interactive frame), a link to the interactive view, and the diagram's elements as buttons (selecting one only shows a toast in the spike). It passes `claude plugin validate`, and `claude plugin test` checks four cases: the desktop pane draws the SVG, the link and the buttons; the terminal says it draws no SVG and keeps the rest; a diagram over the limit isn't drawn; with no viewer running the pane says how to get one. It was not loaded into a live desktop session, and the server has no `/snapshot` route.

## Risks of the mods API

- It is early access and "moves between releases"; the declaration file is the authority for each build.
- Anthropic can turn installed mods off remotely.
- The plugin directory has rules of its own for hooks modules, which `plugin validate` doesn't apply.

## When to look again

- If panes gain an element that hosts a web page (a web view), the real viewer could move into a pane and replace the browser pane.
- If the browser pane stops being available to plugins, a native pane becomes the only way beside the chat.
- A smaller mod could still pay off without these limits: a band above the prompt showing the open file and its `validate` result, which works on every surface.

// Spike for #14: a pane beside the chat that shows the diagram of the open
// cmmn-lens view as SVG, with the diagram's elements as buttons, and a link to
// the interactive view. A mod has no DOM, so the pane can't run cmmn-js: it
// draws an SVG snapshot that the view server would serve at GET /snapshot
// (not built: the page would serialize its canvas, as cmmn-js 0.24.1's own
// saveSVG returns an empty drawing).
//
// The pane finds the server the way the plugin's prompt hook does: through the
// registry files under the temporary folder.

import type { Register } from 'claude-code'

const PANE = 'cmmn-lens-pane'
const SVG_LIMIT = 131072

type Snapshot = { name: string; url: string; svg: string; elements: Array<{ id: string; name?: string }> }
type Loaded = { snapshot?: Snapshot; problem?: string }

async function load($: any): Promise<Loaded> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
  const dir = `${tmp}/cmmn-lens/servers`

  if (!(await $.fs.exists(dir))) {
    return { problem: 'No cmmn-lens viewer is running. Ask Claude to open a CMMN file.' }
  }

  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.json')) continue

    try {
      const server = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
      const response = await $.http.fetch(`http://127.0.0.1:${server.port}/snapshot?t=${server.token}`)

      if (response.ok) {
        return { snapshot: JSON.parse(response.text) as Snapshot }
      }
    } catch {
      // a server that stopped, or one without the snapshot endpoint
    }
  }

  return { problem: 'The running viewer has no snapshot to show.' }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cmmn-pane', description: 'Show the open CMMN diagram in a pane' })

    return next(e)
  })

  on('command.run', { command: 'cmmn-pane' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'CMMN diagram' })

    return { text: isPlaced ? 'CMMN diagram pane opened.' : 'This surface has no room for the pane.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e) as any
    const { Box, Text, Button, Link } = elements
    const { snapshot, problem } = await load($)

    if (!snapshot) {
      return <Text dimColor>{problem}</Text>
    }

    // the terminal's table still resolves an Svg, which it draws as nothing
    const tooBig = snapshot.svg.length > SVG_LIMIT

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{snapshot.name}</Text>
        {e.surface !== 'terminal' && !tooBig
          ? <elements.Svg source={snapshot.svg} alt={`Diagram of ${snapshot.name}`} isInteractive />
          : <Text dimColor>
              {tooBig
                ? `The diagram is too large for a pane (${snapshot.svg.length} characters of SVG, at most ${SVG_LIMIT}).`
                : 'This surface draws no SVG.'}
            </Text>}
        <Link href={snapshot.url} text="Open the interactive view" />
        <Box flexDirection="column">
          {snapshot.elements.slice(0, 50).map(element => (
            <Button key={`select-${element.id}`}
              onPress={async () => { await $.ui.toast(`Selected ${element.id} (the spike doesn't post selections)`) }}>
              {element.name ?? element.id}
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}

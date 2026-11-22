import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'cmmn-lens-pane-spike',
  component: 'Pane',
  requestId: 'cmmn-lens-pane',
  props: {
    title: 'CMMN diagram',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="10" y="10" width="80" height="40"/><text x="20" y="35">Review</text></svg>'

function serve(on: any, svg: string) {
  on('env.get', () => ({ value: '/tmp/' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: '123.json', type: 'file' }] }))
  on('fs.read', () => ({ value: JSON.stringify({ pid: 123, port: 4321, token: 'abc', projectDir: '/work' }) }))
  on('http.fetch', () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({
        name: 'claim.cmmn',
        url: 'http://127.0.0.1:4321/view/1?t=abc',
        svg,
        elements: [{ id: 'PI_review', name: 'Review the claim' }, { id: 'PI_approve' }],
      }),
    },
  }))
}

test('the desktop pane draws the diagram, a link and the elements', async ($, on) => {
  serve(on, SVG)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Svg' }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /claim\.cmmn/ }))).toBeDefined()
  expect((await ui.find({ key: 'select-PI_review' }))).toBeDefined()
  await ui.unmount()
})

test('the terminal, which draws no SVG, says so and keeps the rest', async ($, on) => {
  serve(on, SVG)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const note = await ui.find({ type: 'Text', text: /draws no SVG/ })
  const button = await ui.find({ key: 'select-PI_approve' })

  expect({ note: Boolean(note), button: Boolean(button) }).toEqual({ note: true, button: true })
  await ui.unmount()
})

test('a diagram over the SVG limit is not drawn', async ($, on) => {
  serve(on, `<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(20000)}</svg>`)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /too large for a pane/ }))).toBeDefined()
  await ui.unmount()
})

test('without a viewer the pane says how to get one', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /No cmmn-lens viewer is running/ }))).toBeDefined()
  await ui.unmount()
})

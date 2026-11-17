/**
 * How many cards a row pages by, at phone widths.
 *
 * The two arrows used to take 64px each at every width, which left room for
 * two 128px cards only from 400px up. The common phones are 360 to 393px
 * wide, so their rows moved one title per swipe. A phone's arrows are 44px
 * now, and two cards fit from 360px.
 */

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const { useItemsPerPage, useCardWidth } = require('@src/hooks/useItemsPerPage')

function Probe() {
  return (
    <output>
      {useItemsPerPage()}/{useCardWidth()}
    </output>
  )
}

let container
let root

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<Probe />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  jest.restoreAllMocks()
})

// The resize handler is throttled to one run per 100 ms
async function at(width) {
  window.innerWidth = width
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
  return container.textContent
}

it.each([
  [360, '2/128'], // the smallest common Android width: exactly two cards and two arrows
  [375, '2/128'],
  [390, '2/128'],
  [393, '2/128'],
  [430, '2/128'],
])('a %ipx phone pages two cards at a time', async (width, expected) => {
  expect(await at(width)).toBe(expected)
})

it('a 320px screen still fits one', async () => {
  expect(await at(320)).toBe('1/128')
})

it('wider screens page as they did: their arrows are still 64px', async () => {
  expect(await at(640)).toBe('3/144')
  expect(await at(1024)).toBe('3/192')
  expect(await at(1898)).toBe('8/192')
})

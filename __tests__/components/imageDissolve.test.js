/**
 * The dissolve's heightmap and mask strip: one image always dissolves the same
 * way, two images differently, and the blur only ever burns away.
 */

import { FRAMES, dissolveMaskLayout, greyscaleBmp, heightmap, maskStrip, seedOf, withGutters } from '@components/imageDissolve'

const W = 16
const H = 24

test('an image always gets the same heightmap, and two images different ones', () => {
  const a = heightmap(seedOf('https://files.test/a/poster.jpg'), W, H)
  const again = heightmap(seedOf('https://files.test/a/poster.jpg'), W, H)
  const b = heightmap(seedOf('https://files.test/b/poster.jpg'), W, H)

  expect(Array.from(again)).toEqual(Array.from(a))
  expect(Array.from(b)).not.toEqual(Array.from(a))
})

test('the heightmap spans 0..1', () => {
  const map = heightmap(seedOf('x'), W, H)
  // Float32 storage: within rounding of the ends
  expect(Math.min(...map)).toBeCloseTo(0, 6)
  expect(Math.max(...map)).toBeCloseTo(1, 6)
})

test("bright art sits low, so it comes through first", () => {
  const seed = seedOf('https://files.test/poster.jpg')
  // Bright on the right half, dark on the left
  const lit = heightmap(seed, W, H, (u) => (u >= 0.5 ? 1 : 0))
  const mean = (map, fromX, toX) => {
    let sum = 0
    let n = 0
    for (let y = 0; y < H; y++) for (let x = fromX; x < toX; x++, n++) sum += map[y * W + x]
    return sum / n
  }
  expect(mean(lit, W / 2, W)).toBeLessThan(mean(lit, 0, W / 2))
})

test('the strip starts whole, ends clear, and no pixel ever comes back', () => {
  const map = heightmap(seedOf('y'), W, H)
  const strip = maskStrip(map)
  const area = W * H
  expect(strip.length).toBe(area * FRAMES)

  const alpha = (frame, i) => strip[frame * area + i]
  for (let i = 0; i < area; i++) {
    expect(alpha(0, i)).toBe(255)
    expect(alpha(FRAMES - 1, i)).toBe(0)
    for (let frame = 1; frame < FRAMES; frame++) expect(alpha(frame, i)).toBeLessThanOrEqual(alpha(frame - 1, i))
  }
})

test('low ground burns first', () => {
  const map = new Float32Array([0, 1])
  const strip = maskStrip(map)
  const middle = Math.floor(FRAMES / 2)
  // Halfway through, the lowest point is gone and the highest is still there
  expect(strip[middle * 2 + 0]).toBe(0)
  expect(strip[middle * 2 + 1]).toBe(255)
})

test('the strip is written as an 8-bit greyscale BMP, rows top-down', () => {
  // 3 wide, so each row is padded to 4 bytes
  const grey = new Uint8Array([10, 20, 30, 40, 50, 60])
  const file = greyscaleBmp(grey, 3, 2)
  const view = new DataView(file.buffer)

  expect(String.fromCharCode(file[0], file[1])).toBe('BM')
  const pixels = view.getUint32(10, true)
  expect(pixels).toBe(14 + 40 + 1024)
  expect(view.getUint32(2, true)).toBe(file.length)
  expect(view.getInt32(18, true)).toBe(3)
  expect(view.getInt32(22, true)).toBe(-2) // top-down
  expect(view.getUint16(28, true)).toBe(8)
  // Palette entry n is grey n
  expect(Array.from(file.subarray(54 + 200 * 4, 54 + 200 * 4 + 3))).toEqual([200, 200, 200])
  // First row, then the second at the next 4-byte boundary
  expect(Array.from(file.subarray(pixels, pixels + 3))).toEqual([10, 20, 30])
  expect(Array.from(file.subarray(pixels + 4, pixels + 7))).toEqual([40, 50, 60])
})

test('a crossfade, not a burn: no point jumps far in one step, so the steps never show', () => {
  const map = heightmap(seedOf('z'), W, H)
  const strip = maskStrip(map)
  const area = W * H
  let biggestStep = 0
  for (let frame = 1; frame < FRAMES; frame++) {
    for (let i = 0; i < area; i++) {
      biggestStep = Math.max(biggestStep, strip[(frame - 1) * area + i] - strip[frame * area + i])
    }
  }
  // A threshold sweep flips a point from 255 to 0 in a step or two
  expect(biggestStep).toBeLessThanOrEqual(40)
})

test("each frame carries copies of its own edge rows, so scaling never blends in a neighbour's", () => {
  // 1 wide, 3 rows a frame: frame f holds rows 10f+1, 10f+2, 10f+3
  const strip = new Uint8Array(FRAMES * 3).map((_, i) => 10 * Math.floor(i / 3) + (i % 3) + 1)
  const padded = withGutters(strip, 1, 3)
  const cell = padded.length / FRAMES
  expect(cell).toBe(3 + 4) // two gutter rows each side
  const frame = (f) => Array.from(padded.subarray(f * cell, (f + 1) * cell))
  expect(frame(0)).toEqual([1, 1, 1, 2, 3, 3, 3])
  expect(frame(5)).toEqual([51, 51, 51, 52, 53, 53, 53])
})

test('the layout puts each frame, and only that frame, in the box', () => {
  const frameHeight = 96
  const cell = frameHeight + 4
  const { size, from, to } = dissolveMaskLayout(frameHeight)
  // The strip is FRAMES cells tall, at the box's scale of one frame
  expect(parseFloat(size.split(' ')[1])).toBeCloseTo(((FRAMES * cell) / frameHeight) * 100, 3)
  // A position p moves the strip p × (strip − box) up: in source rows, p × travel
  const travel = FRAMES * cell - frameHeight
  const topRow = (percent) => (parseFloat(percent) / 100) * travel
  expect(topRow(from)).toBeCloseTo(2, 2) // frame 0's first own row
  expect(topRow(to)).toBeCloseTo((FRAMES - 1) * cell + 2, 2) // the last frame's
  // Stepping evenly between them lands on every frame's first own row
  for (let i = 0; i < FRAMES; i++) {
    const at = parseFloat(from) + ((parseFloat(to) - parseFloat(from)) * i) / (FRAMES - 1)
    expect(topRow(`${at}%`)).toBeCloseTo(i * cell + 2, 1)
  }
})

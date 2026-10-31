/**
 * The crossfade a loaded image comes out of its blurhash with, shaped by a
 * heightmap of its own: every point of the blur fades smoothly, but low
 * ground starts first and high ground last, so the image comes through in
 * soft drifts rather than all at once.
 *
 * The heightmap is fractal value noise seeded by the image's URL, so no two
 * images fade alike, mixed with the brightness of the image's blurhash, so
 * bright areas of the art sit low and come through first. It is baked once
 * into a strip of FRAMES luminance masks (the fade at evenly spaced moments);
 * the stand-in wears the strip as a CSS mask and the `image-dissolve`
 * keyframes (app/global.css) step through it. Per frame the browser repaints
 * one masked layer, nothing more.
 *
 * Kept soft on purpose. Each point fades over FADE_WINDOW of the run, so a
 * step moves it only a few percent and the steps do not show; and the noise
 * keeps only its broad layers, so the map, stretched about six times onto the
 * image, has nothing finer than the stretch can smooth. A narrow edge and fine
 * noise read as pixelated smoke.
 *
 * Measured on the movie list: about 2 ms of main thread per mask, and eight
 * posters dissolving at once never pushed a frame past 12 ms.
 */

/** Steps in a mask strip: ~48 a second over DISSOLVE_MS. */
export const FRAMES = 24
/** How long the crossfade runs. */
export const DISSOLVE_MS = 500
/** Longest side of the heightmap, in pixels; the mask is stretched to the image. */
const MAP_SIZE = 96
/**
 * The share of the run each point takes to fade. The rest is when it starts:
 * the lowest point at once, the highest at 1 - FADE_WINDOW.
 */
const FADE_WINDOW = 0.45
/** Noise layers, broadest first; finer ones would show as blocks once stretched. */
const OCTAVES = 3
/** How much of the height is the art's brightness rather than noise. */
const ART_WEIGHT = 0.4
/**
 * Rows each frame repeats of its own top and bottom edge in the strip. The
 * strip is stretched ~6x, and scaling blends the edge row of the box with the
 * row beyond it: without these, the next frame's bottom row bled into the top
 * of the image (and the following frame's top into the bottom), a faint line
 * mid-fade where neighbouring frames differ most.
 */
const GUTTER = 2

const LATTICE = 256
let lattice = null

/** One shared table of random values: an image's seed only moves where it is sampled. */
function latticeTable() {
  if (lattice) return lattice
  lattice = new Float32Array(LATTICE * LATTICE)
  let s = 1
  for (let i = 0; i < lattice.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    lattice[i] = s / 4294967296
  }
  return lattice
}

const smooth = (t) => t * t * (3 - 2 * t)

function valueNoise(table, x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smooth(x - xi)
  const yf = smooth(y - yi)
  const row0 = (yi & 255) * LATTICE
  const row1 = ((yi + 1) & 255) * LATTICE
  const a = table[row0 + (xi & 255)]
  const b = table[row0 + ((xi + 1) & 255)]
  const c = table[row1 + (xi & 255)]
  const d = table[row1 + ((xi + 1) & 255)]
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
}

/** FNV-1a: an image's URL to its seed. */
export function seedOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The heightmap, normalised to 0..1.
 *
 * @param {number} seed
 * @param {number} width
 * @param {number} height
 * @param {((u: number, v: number) => number)|null} [brightness] - the art's, 0..1, at a point of the image
 * @returns {Float32Array} width × height, row by row
 */
export function heightmap(seed, width, height, brightness = null) {
  const table = latticeTable()
  const ox = (seed & 0xffff) / 300
  const oy = (seed >>> 16) / 300
  // Broad features, about a third of the map across, whatever its size
  const scale = 3 / Math.max(width, height)
  const map = new Float32Array(width * height)
  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let amp = 0.5
      let freq = scale
      let norm = 0
      for (let octave = 0; octave < OCTAVES; octave++) {
        sum += amp * valueNoise(table, ox + x * freq, oy + y * freq)
        norm += amp
        amp *= 0.5
        freq *= 2
      }
      const noise = sum / norm
      // Bright art sits low, so it comes through first
      const value = brightness ? (1 - ART_WEIGHT) * noise + ART_WEIGHT * (1 - brightness(x / width, y / height)) : noise
      map[y * width + x] = value
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  const span = max - min || 1
  for (let i = 0; i < map.length; i++) map[i] = (map[i] - min) / span
  return map
}

/**
 * The mask strip: FRAMES greyscale masks stacked top to bottom, a luminance
 * mask (white shows the blur, black lets the image through), from all white
 * (frame 0, the blur whole) to all black (the last frame, the blur gone).
 *
 * Each point eases out (smoothstep) over FADE_WINDOW of the run, starting as
 * late as its height: a crossfade whose timing the heightmap sets, not a
 * threshold sweeping across it.
 *
 * @param {Float32Array} map - from heightmap()
 * @returns {Uint8Array} one byte a pixel, width × (height × FRAMES)
 */
export function maskStrip(map) {
  const area = map.length
  const out = new Uint8Array(area * FRAMES)
  const lead = 1 - FADE_WINDOW
  for (let frame = 0; frame < FRAMES; frame++) {
    const t = frame / (FRAMES - 1)
    const base = frame * area
    for (let i = 0; i < area; i++) {
      const progress = (t - map[i] * lead) / FADE_WINDOW
      const faded = progress <= 0 ? 0 : progress >= 1 ? 1 : smooth(progress)
      out[base + i] = Math.round((1 - faded) * 255)
    }
  }
  return out
}

/**
 * The strip with GUTTER copies of each frame's edge rows above and below it.
 *
 * @param {Uint8Array} strip - from maskStrip()
 * @param {number} width
 * @param {number} frameHeight
 * @returns {Uint8Array} width × ((frameHeight + 2 × GUTTER) × FRAMES)
 */
export function withGutters(strip, width, frameHeight) {
  const cell = frameHeight + 2 * GUTTER
  const out = new Uint8Array(width * cell * FRAMES)
  for (let frame = 0; frame < FRAMES; frame++) {
    const from = frame * frameHeight * width
    const to = frame * cell * width
    for (let row = 0; row < cell; row++) {
      const source = Math.min(frameHeight - 1, Math.max(0, row - GUTTER))
      out.set(strip.subarray(from + source * width, from + (source + 1) * width), to + row * width)
    }
  }
  return out
}

/**
 * Where the mask sits on the stand-in: its size, and its position on the
 * first and last frame (the `image-dissolve` keyframes step between the two
 * through `--dissolve-from` / `--dissolve-to`). Frame i shows its own rows
 * only, starting GUTTER rows into its cell.
 *
 * @param {number} frameHeight - rows in a frame, without its gutters
 * @returns {{ size: string, from: string, to: string }}
 */
export function dissolveMaskLayout(frameHeight) {
  const cell = frameHeight + 2 * GUTTER
  // A percentage position p puts the image's p% at the box's p%: the image
  // moves p × (strip - box) up, which in source rows is p × travel
  const travel = FRAMES * cell - frameHeight
  const percent = (rows) => `${((rows / travel) * 100).toFixed(4)}%`
  return {
    size: `100% ${(((FRAMES * cell) / frameHeight) * 100).toFixed(4)}%`,
    from: percent(GUTTER),
    to: percent((FRAMES - 1) * cell + GUTTER),
  }
}

/**
 * An 8-bit greyscale BMP of the strip: a fixed header, a grey palette and the
 * bytes as they are. Uncompressed on purpose: the browser's async PNG encoder
 * took 280-360 ms a mask while a page of posters was rendering (8 ms idle),
 * past the wait, so every poster faded instead; this is built in well under
 * a millisecond. ~100 KB, held for the dissolve only.
 *
 * @param {Uint8Array} grey - one byte a pixel, rows top to bottom
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} the file
 */
export function greyscaleBmp(grey, width, height) {
  const rowSize = Math.ceil(width / 4) * 4
  const pixelOffset = 14 + 40 + 256 * 4
  const fileSize = pixelOffset + rowSize * height
  const file = new Uint8Array(fileSize)
  const view = new DataView(file.buffer)
  // File header
  file[0] = 0x42 // 'B'
  file[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, pixelOffset, true)
  // BITMAPINFOHEADER; a negative height stores the rows top-down
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 8, true)
  view.setUint32(34, rowSize * height, true)
  view.setUint32(46, 256, true)
  // Grey palette: index n is (n, n, n)
  for (let n = 0; n < 256; n++) {
    const o = 54 + n * 4
    file[o] = n
    file[o + 1] = n
    file[o + 2] = n
  }
  for (let y = 0; y < height; y++) {
    file.set(grey.subarray(y * width, (y + 1) * width), pixelOffset + y * rowSize)
  }
  return file
}

/**
 * Bilinear brightness of a decoded image, sampled at (u, v) in 0..1.
 */
function brightnessSampler(data, width, height) {
  const lum = new Float32Array(width * height)
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255
  }
  return (u, v) => {
    const x = Math.min(width - 1, u * width)
    const y = Math.min(height - 1, v * height)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(width - 1, x0 + 1)
    const y1 = Math.min(height - 1, y0 + 1)
    const fx = x - x0
    const fy = y - y0
    return (
      lum[y0 * width + x0] * (1 - fx) * (1 - fy) +
      lum[y0 * width + x1] * fx * (1 - fy) +
      lum[y1 * width + x0] * (1 - fx) * fy +
      lum[y1 * width + x1] * fx * fy
    )
  }
}

/**
 * Whether this browser can build a mask (OffscreenCanvas) and the viewer has
 * not asked for less motion. Client-only.
 */
export function canDissolve() {
  if (typeof window === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Builds an image's mask strip and hands back an object URL for it, with
 * where to place it (dissolveMaskLayout); the caller revokes the URL once the
 * dissolve is over. The heightmap takes the blurhash's proportions, which are
 * the image's, so a backdrop's noise is not a poster's stretched sideways.
 *
 * @param {string} key - the image's URL, which seeds the noise
 * @param {string} blurDataURL - the image's blurhash, as a data URL
 * @returns {Promise<{ url: string, size: string, from: string, to: string }>}
 */
export async function buildDissolveMask(key, blurDataURL) {
  const blur = await createImageBitmap(await (await fetch(blurDataURL)).blob())
  const sample = new OffscreenCanvas(blur.width, blur.height)
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true })
  sampleCtx.drawImage(blur, 0, 0)
  const brightness = brightnessSampler(sampleCtx.getImageData(0, 0, blur.width, blur.height).data, blur.width, blur.height)

  const portrait = blur.height >= blur.width
  const width = portrait ? Math.max(16, Math.round((MAP_SIZE * blur.width) / blur.height)) : MAP_SIZE
  const height = portrait ? MAP_SIZE : Math.max(16, Math.round((MAP_SIZE * blur.height) / blur.width))
  blur.close()

  const strip = withGutters(maskStrip(heightmap(seedOf(key), width, height, brightness)), width, height)
  const file = greyscaleBmp(strip, width, (height + 2 * GUTTER) * FRAMES)
  return { url: URL.createObjectURL(new Blob([file], { type: 'image/bmp' })), ...dissolveMaskLayout(height) }
}

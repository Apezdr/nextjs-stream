import { classNames } from '@src/utils'
import { normalizeContentRating } from '@src/utils/contentRating'
import { getMpaRatingCopy } from '@src/utils/contentRatingCopy'
import { getMpaRatingAsset } from '@src/utils/contentRatingMpaAssets'

const TEXT_FONT = 'Arial, Helvetica, sans-serif'
const DESCRIPTORS_UNAVAILABLE = 'SPECIFIC CONTENT INFORMATION NOT PROVIDED'
const ARIAL_BOLD_WIDTHS = Object.freeze({
  ' ': 0.278,
  A: 0.722,
  B: 0.722,
  C: 0.722,
  D: 0.722,
  E: 0.667,
  F: 0.611,
  G: 0.778,
  H: 0.722,
  I: 0.278,
  J: 0.556,
  K: 0.722,
  L: 0.611,
  M: 0.833,
  N: 0.722,
  O: 0.778,
  P: 0.667,
  Q: 0.778,
  R: 0.722,
  S: 0.667,
  T: 0.611,
  U: 0.722,
  V: 0.667,
  W: 0.944,
  X: 0.667,
  Y: 0.667,
  Z: 0.611,
})

function findFieldEvidence(enrichments, field) {
  return enrichments.find((enrichment) => enrichment.fields.includes(field)) || null
}

function estimatedTextWidth(value, fontSize) {
  const glyphWidth = [...value].reduce(
    (width, character) => width + (ARIAL_BOLD_WIDTHS[character] ?? 0.667),
    0
  )
  const tracking = Math.max(0, value.length - 1) * -0.035
  return (glyphWidth + tracking) * fontSize
}

function wrapText(value, maxWidth, fontSize) {
  const words = value.trim().split(/\s+/)
  const lines = []
  let currentLine = ''

  for (const word of words) {
    if (estimatedTextWidth(word, fontSize) > maxWidth) {
      if (currentLine) {
        lines.push(currentLine)
        currentLine = ''
      }

      let chunk = ''
      for (const character of word) {
        const candidate = `${chunk}${character}`
        if (chunk && estimatedTextWidth(candidate, fontSize) > maxWidth) {
          lines.push(chunk)
          chunk = character
        } else {
          chunk = candidate
        }
      }
      if (chunk) lines.push(chunk)
      continue
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (estimatedTextWidth(candidate, fontSize) <= maxWidth) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines
}

function descriptorLayout(descriptors, textArea) {
  const values = descriptors.map((descriptor) => descriptor.toUpperCase())
  const buildLines = (fontSize) => values.flatMap((value) => wrapText(value, textArea.width, fontSize))

  let fontSize = textArea.fontSize
  let lineHeight = textArea.lineHeight
  let lines = buildLines(fontSize)
  let maxLines = Math.max(1, Math.floor(textArea.height / lineHeight))

  if (lines.length > maxLines) {
    fontSize *= 0.82
    lineHeight *= 0.82
    lines = buildLines(fontSize)
    maxLines = Math.max(1, Math.floor(textArea.height / lineHeight))
  }

  if (lines.length > maxLines) {
    lines = [
      ...lines.slice(0, Math.max(0, maxLines - 1)),
      'MORE DESCRIPTORS',
    ]
  }

  const blockHeight = fontSize + Math.max(0, lines.length - 1) * lineHeight
  const y = textArea.y + (textArea.height - blockHeight) / 2 + fontSize * 0.82

  return { fontSize, lineHeight, lines, y }
}

function DescriptorText({ asset, descriptors }) {
  if (!asset.mask || !asset.text) return null

  const values = descriptors.length > 0 ? descriptors : [DESCRIPTORS_UNAVAILABLE]
  const layout = descriptorLayout(values, asset.text)
  return (
    <>
      <rect
        data-rating-descriptor-mask
        fill="#fff"
        height={asset.mask.height}
        width={asset.mask.width}
        x={asset.mask.x}
        y={asset.mask.y}
      />
      <text
        data-rating-descriptors
        fill="#000"
        fontFamily={TEXT_FONT}
        fontSize={layout.fontSize}
        fontWeight="700"
        letterSpacing="-0.035em"
        x={asset.text.x}
        y={layout.y}
      >
        {layout.lines.map((line, index) => (
          <tspan
            data-descriptor-line
            dy={index === 0 ? 0 : layout.lineHeight}
            key={`${line}-${index}`}
            x={asset.text.x}
          >
            {line}
          </tspan>
        ))}
      </text>
    </>
  )
}

function NotRatedSvg({ className, copy }) {
  return (
    <svg
      aria-label="MPA content rating NR: Not rated"
      className={classNames('block h-auto w-full max-w-sm', className)}
      data-content-rating="NR"
      data-content-rating-panel="NR"
      height="39"
      preserveAspectRatio="xMinYMin meet"
      role="img"
      viewBox="0 0 116 39"
      width="116"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Not rated by the MPA</title>
      <desc>{copy.definition}</desc>
      <rect fill="#fff" height="32" stroke="#000" strokeWidth="1.5" width="110" x="0.75" y="0.75" />
      <text fill="#000" fontFamily={TEXT_FONT} fontSize="16" fontWeight="700" textAnchor="middle" x="55" y="16">
        NOT RATED
      </text>
      <text data-rating-definition fill="#000" fontFamily={TEXT_FONT} fontSize="4" fontWeight="700" textAnchor="middle" x="55" y="26">
        {copy.definition}
      </text>
    </svg>
  )
}

export default function ContentRatingPanel({ rating, className = '' }) {
  const normalized = normalizeContentRating(rating, 'movie')
  if (!normalized || normalized.system !== 'MPA') return null

  const copy = getMpaRatingCopy(normalized.contentRating)
  if (!copy) return null

  const {
    certificateId,
    contentRating,
    descriptors,
    enrichments = [],
  } = normalized
  const asset = getMpaRatingAsset(contentRating)
  if (!asset) return <NotRatedSvg className={className} copy={copy} />

  const certificateEvidence = findFieldEvidence(enrichments, 'certificateId')
  const descriptorEvidence = findFieldEvidence(enrichments, 'descriptors')
  const accessibleDetails = [
    `${copy.name}.`,
    descriptors.length > 0
      ? `Content descriptors: ${descriptors.join(', ')}.`
      : 'Specific content information was not provided.',
    copy.definition,
    certificateId ? `Certificate ${certificateId}.` : null,
    certificateEvidence ? `Corroborated by ${certificateEvidence.source}.` : null,
    descriptorEvidence ? `Descriptors from ${descriptorEvidence.source}.` : null,
  ].filter(Boolean).join(' ')

  return (
    <svg
      aria-label={`MPA content rating ${contentRating}: ${copy.name}`}
      className={classNames('block h-auto w-full max-w-sm', className)}
      data-content-rating={contentRating}
      data-content-rating-panel={contentRating}
      height={asset.height}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      shapeRendering="geometricPrecision"
      viewBox={`0 0 ${asset.width} ${asset.height}`}
      width={asset.width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{`Rated ${contentRating}: ${copy.name}`}</title>
      <desc>{accessibleDetails}</desc>
      <circle
        aria-hidden="true"
        cx={asset.registration.cx}
        cy={asset.registration.cy}
        data-rating-registration-halo
        fill="#fff"
        r="2.8"
      />
      <image
        aria-hidden="true"
        data-rating-template={contentRating}
        height={asset.height}
        href={asset.src}
        preserveAspectRatio="xMinYMin meet"
        width={asset.width}
        x="0"
        y="0"
      />
      <DescriptorText asset={asset} descriptors={descriptors} />
    </svg>
  )
}
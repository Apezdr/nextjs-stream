const REGISTRATION_RIGHT_PADDING = 1

const asset = (src, artworkWidth, height, mask, text) => Object.freeze({
  src,
  width: artworkWidth + REGISTRATION_RIGHT_PADDING,
  height,
  registration: Object.freeze({
    cx: artworkWidth - 2.45,
    cy: height - 2.98,
  }),
  mask: mask ? Object.freeze(mask) : null,
  text: text ? Object.freeze(text) : null,
})

export const MPA_RATING_ASSETS = Object.freeze({
  G: asset(
    '/assets/content-ratings/mpa/g.svg',
    116.3506012,
    33.4490356,
    null,
    null
  ),
  PG: asset(
    '/assets/content-ratings/mpa/pg.svg',
    116.4658508,
    45.6868286,
    { x: 50.2, y: 1.2, width: 59.3, height: 36.4 },
    { x: 52.2, y: 4.5, width: 54.7, height: 29.5, fontSize: 5.4, lineHeight: 6 }
  ),
  'PG-13': asset(
    '/assets/content-ratings/mpa/pg-13.svg',
    116.2641602,
    40.8917084,
    { x: 52.8, y: 1.2, width: 56.6, height: 31.4 },
    { x: 54.8, y: 4, width: 52.2, height: 25.5, fontSize: 5.1, lineHeight: 5.7 }
  ),
  R: asset(
    '/assets/content-ratings/mpa/r.svg',
    116.4790649,
    47.7042389,
    { x: 40.4, y: 1.2, width: 69.2, height: 38.4 },
    { x: 42.2, y: 5, width: 65.2, height: 30.5, fontSize: 5.6, lineHeight: 6.3 }
  ),
  'NC-17': asset(
    '/assets/content-ratings/mpa/nc-17.svg',
    116.344841,
    39.3009682,
    { x: 56.9, y: 1.2, width: 52.5, height: 29.9 },
    { x: 58.8, y: 3.7, width: 48.4, height: 24.5, fontSize: 4.9, lineHeight: 5.5 }
  ),
})

export function getMpaRatingAsset(contentRating) {
  return Object.hasOwn(MPA_RATING_ASSETS, contentRating)
    ? MPA_RATING_ASSETS[contentRating]
    : null
}

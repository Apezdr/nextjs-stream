const MPA_RATING_COPY = Object.freeze({
  G: Object.freeze({
    name: 'General audiences',
    definition: 'Suitable for viewers of all ages.',
  }),
  PG: Object.freeze({
    name: 'Parental guidance suggested',
    definition: 'Some material may not be suitable for children.',
  }),
  'PG-13': Object.freeze({
    name: 'Parents strongly cautioned',
    definition: 'Some material may be inappropriate for children under 13.',
  }),
  R: Object.freeze({
    name: 'Restricted',
    definition: 'Under 17 requires an accompanying parent or adult guardian.',
  }),
  'NC-17': Object.freeze({
    name: 'Adults only',
    definition: 'Intended for adults; viewers 17 and under are not admitted.',
  }),
  NR: Object.freeze({
    name: 'Not rated',
    definition: 'This title has not received an MPA classification.',
  }),
})

export function getMpaRatingCopy(contentRating) {
  return Object.hasOwn(MPA_RATING_COPY, contentRating)
    ? MPA_RATING_COPY[contentRating]
    : null
}
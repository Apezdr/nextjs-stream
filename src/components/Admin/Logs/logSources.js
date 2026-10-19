/**
 * Which log sources the Logs page shows. A selection is { mode, tokens }:
 * mode 'all' shows everything except the tokens, mode 'only' shows just
 * them. A token is `area:<id>` (a whole area, including categories that
 * haven't logged yet) or a category name. The processor applies the same
 * rule to its `hide` / `only` parameters (routes/logs.mjs).
 */

export const ALL_SOURCES = Object.freeze({ mode: 'all', tokens: Object.freeze([]) })

const areaToken = (areaId) => `area:${areaId}`

export function isShown(selection, category, areaId) {
  const listed = selection.tokens.includes(category) || selection.tokens.includes(areaToken(areaId))
  return selection.mode === 'only' ? listed : !listed
}

/**
 * The areas in the processor's order, each with the categories that logged
 * in the range and their counts. Lines with no category count toward their
 * area ("Other") but have no row of their own.
 */
export function groupSources(areas, facetCategories) {
  return areas.map((area) => {
    const inArea = facetCategories.filter((category) => category.area === area.id)
    return {
      ...area,
      count: inArea.reduce((sum, category) => sum + category.count, 0),
      categories: inArea.filter((category) => category.name !== null),
    }
  })
}

/** 'all', 'none' or 'some' of an area's categories shown. */
export function areaState(selection, area) {
  if (area.categories.length === 0) return isShown(selection, null, area.id) ? 'all' : 'none'
  const shown = area.categories.filter((category) => isShown(selection, category.name, area.id)).length
  if (shown === area.categories.length) return 'all'
  return shown === 0 ? 'none' : 'some'
}

// An 'only' list that lost its last entry would show nothing: back to everything.
const settle = (selection) => (selection.mode === 'only' && selection.tokens.length === 0 ? ALL_SOURCES : selection)

export function setAreaShown(selection, area, show) {
  const own = new Set([areaToken(area.id), ...area.categories.map((category) => category.name)])
  const rest = selection.tokens.filter((token) => !own.has(token))
  // Tokens hide in 'all' mode and show in 'only' mode.
  const listArea = selection.mode === 'all' ? !show : show
  return settle({ mode: selection.mode, tokens: listArea ? [...rest, areaToken(area.id)] : rest })
}

export function setCategoryShown(selection, area, name, show) {
  if (isShown(selection, name, area.id) === show) return selection
  const { tokens } = selection
  if (tokens.includes(areaToken(area.id))) {
    // The whole area is listed: list its other categories instead, leaving this one out.
    const others = area.categories.map((category) => category.name).filter((other) => other !== name)
    const rest = tokens.filter((token) => token !== areaToken(area.id) && !others.includes(token))
    return settle({ mode: selection.mode, tokens: [...rest, ...others] })
  }
  const next = tokens.includes(name) ? tokens.filter((token) => token !== name) : [...tokens, name]
  return settle({ mode: selection.mode, tokens: next })
}

export const onlyArea = (area) => ({ mode: 'only', tokens: [areaToken(area.id)] })
export const onlyCategory = (name) => ({ mode: 'only', tokens: [name] })

/** "All sources", "Hiding Library scan", "Only 3 sources" … */
export function describeSelection(selection, areas) {
  if (selection.tokens.length === 0) return 'All sources'
  const names = selection.tokens.map((token) =>
    token.startsWith('area:') ? (areas.find((area) => areaToken(area.id) === token)?.label ?? token.slice(5)) : token
  )
  const what = names.length === 1 ? names[0] : `${names.length} sources`
  return selection.mode === 'only' ? `Only ${what}` : `Hiding ${what}`
}

/** The selection as the processor's query parameter. */
export function selectionParams(selection) {
  if (selection.tokens.length === 0) return {}
  return { [selection.mode === 'only' ? 'only' : 'hide']: selection.tokens.join(',') }
}

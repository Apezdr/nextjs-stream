/**
 * Which cast tabs have anyone to show: the rule CastTabs renders by, and the
 * one the episode page lays its panels out by (a cast column only when there
 * is a cast). Not a client module, so the server-rendered page can call it.
 */

const validPeople = (cast) => (Array.isArray(cast) ? cast.filter((person) => person && person.name) : [])

/**
 * The tabs that have an id, a label and at least one named person, each with
 * its cast cut to the named people.
 *
 * @param {Array<{ id: string, label: string, cast: Array<object> }>|null|undefined} tabs
 * @returns {Array<{ id: string, label: string, cast: Array<object> }>}
 */
export function usableCastTabs(tabs) {
  return (tabs || [])
    .filter((tab) => tab && tab.id && tab.label)
    .map((tab) => ({ ...tab, cast: validPeople(tab.cast) }))
    .filter((tab) => tab.cast.length > 0)
}

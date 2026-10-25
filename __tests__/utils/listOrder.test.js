/**
 * @jest-environment node
 *
 * The Movies and TV lists of /api/authenticated/horizontal-list are ordered in
 * the database before paging (listOrder). `sort` used to reorder only the page
 * in hand, and `id` and `date` compared fields the cards don't have, so they
 * didn't sort at all.
 */
const { LIST_SORT_KEYS, listOrder } = require('@src/utils/mediaListUtils/listOrder')

it('offers the keys the route accepts', () => {
  expect(LIST_SORT_KEYS).toEqual(['id', 'title', 'date'])
})

it('orders id by the date a title was added to the library', () => {
  expect(listOrder('movie', 'id', 'desc')).toEqual({ sort: { initialDiscoveryDate: -1, _id: 1 } })
  expect(listOrder('tv', 'id', 'asc')).toEqual({ sort: { initialDiscoveryDate: 1, _id: 1 } })
})

it('orders title ignoring case, numbers in numeric order', () => {
  expect(listOrder('movie', 'title', 'asc')).toEqual({
    sort: { title: 1, _id: 1 },
    collation: { locale: 'en', strength: 2, numericOrdering: true },
  })
})

it("orders date by a movie's release date and a show's latest air date", () => {
  expect(listOrder('movie', 'date', 'desc').sort).toEqual({ 'metadata.release_date': -1, _id: 1 })
  expect(listOrder('tv', 'date', 'desc').sort).toEqual({ 'metadata.last_air_date': -1, _id: 1 })
})

it('refuses an unknown key', () => {
  expect(() => listOrder('movie', 'popularity', 'desc')).toThrow('Unknown list sort "popularity"')
})

describe("the list pages' sort menu", () => {
  const { CONSTANTS, listPageOrder } = require('@src/utils/mediaListUtils/shared')

  it('offers newest, oldest, title and recently added', () => {
    expect(CONSTANTS.VALID_SORT_OPTIONS).toEqual(['newest', 'oldest', 'title', 'added'])
  })

  it('uses the lists\' orders, newest first by default', () => {
    expect(listPageOrder('movie', 'newest')).toEqual(listOrder('movie', 'date', 'desc'))
    expect(listPageOrder('tv', 'oldest')).toEqual(listOrder('tv', 'date', 'asc'))
    expect(listPageOrder('movie', 'title')).toEqual(listOrder('movie', 'title', 'asc'))
    expect(listPageOrder('tv', 'added')).toEqual(listOrder('tv', 'id', 'desc'))
    expect(listPageOrder('movie', 'whatever')).toEqual(listOrder('movie', 'date', 'desc'))
  })
})

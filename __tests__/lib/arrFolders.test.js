/**
 * @jest-environment node
 *
 * The folder a title is added under becomes its originalTitle for good, so the
 * name the dialog shows must be the one Radarr would make (its FileNameBuilder
 * rules), and a typed name must be one the filesystem and the app can use.
 */
import { folderNameProblem, folderOf, joinRootFolder, predictRadarrFolder } from '@src/lib/arr/folders'

const naming = (overrides = {}) => ({
  movieFolderFormat: '{Movie Title}',
  replaceIllegalCharacters: true,
  colonReplacementFormat: 'delete',
  ...overrides,
})

describe('predictRadarrFolder', () => {
  test('the live format {Movie Title}: illegal characters replaced the way Radarr does', () => {
    // Radarr made "/processed_movies/The End!" for "The End?" (2026-09-22).
    expect(predictRadarrFolder({ title: 'The End?', year: 2017 }, naming())).toBe('The End!')
    expect(predictRadarrFolder({ title: 'AC/DC: Live', year: 1992 }, naming())).toBe('AC+DC Live')
    expect(predictRadarrFolder({ title: 'Who Framed "Roger" <Rabbit>*', year: 1988 }, naming())).toBe(
      'Who Framed Roger Rabbit-'
    )
  })

  test('colon replacement follows the naming config', () => {
    const title = { title: 'Mission: Impossible', year: 1996 }
    expect(predictRadarrFolder(title, naming())).toBe('Mission Impossible')
    expect(predictRadarrFolder(title, naming({ colonReplacementFormat: 'smart' }))).toBe('Mission - Impossible')
    expect(predictRadarrFolder(title, naming({ colonReplacementFormat: 'dash' }))).toBe('Mission- Impossible')
    expect(predictRadarrFolder(title, naming({ colonReplacementFormat: 'spaceDashSpace' }))).toBe(
      'Mission - Impossible'
    )
  })

  test('with replacement off, illegal characters are dropped', () => {
    expect(predictRadarrFolder({ title: 'The End?', year: 2017 }, naming({ replaceIllegalCharacters: false }))).toBe(
      'The End'
    )
  })

  test('year and TitleThe tokens, then separators collapse and dots and spaces trim', () => {
    expect(predictRadarrFolder({ title: 'Dune', year: 2021 }, naming({ movieFolderFormat: '{Movie Title} ({Release Year})' }))).toBe(
      'Dune (2021)'
    )
    expect(predictRadarrFolder({ title: 'The Matrix', year: 1999 }, naming({ movieFolderFormat: '{Movie TitleThe}' }))).toBe(
      'Matrix, The'
    )
    expect(predictRadarrFolder({ title: '...And Justice  for All.', year: 1979 }, naming())).toBe('And Justice for All')
  })

  test('no prediction for tokens it cannot reproduce, nested folders, or a blank format', () => {
    expect(predictRadarrFolder({ title: 'Dune', year: 2021 }, naming({ movieFolderFormat: '{Movie CleanTitle}' }))).toBeNull()
    expect(predictRadarrFolder({ title: 'Dune', year: 2021 }, naming({ movieFolderFormat: '{Movie Title}/{Release Year}' }))).toBeNull()
    expect(predictRadarrFolder({ title: 'Dune', year: 2021 }, naming({ movieFolderFormat: '' }))).toBeNull()
    expect(predictRadarrFolder({ title: '', year: 2021 }, naming())).toBeNull()
  })
})

describe('folderNameProblem', () => {
  test('accepts an ordinary name', () => {
    expect(folderNameProblem('Lilo & Stitch (2025)')).toBeNull()
  })

  test.each([
    ['', 'Enter a folder name.'],
    ['   ', 'Enter a folder name.'],
    ['What?', 'can’t contain'],
    ['AC/DC', 'can’t contain'],
    ['tab\tname', 'control characters'],
    [' Leading space', 'start or end'],
    ['Trailing dot.', 'start or end'],
    ['.hidden', 'start or end'],
    ['x'.repeat(181), 'under 180'],
  ])('refuses %j', (name, message) => {
    expect(folderNameProblem(name)).toContain(message)
  })
})

describe('paths', () => {
  test('joinRootFolder keeps the root folder’s separator and drops a trailing one', () => {
    expect(joinRootFolder('/processed_movies', 'The Matrix')).toBe('/processed_movies/The Matrix')
    expect(joinRootFolder('/processed_movies/', 'The Matrix')).toBe('/processed_movies/The Matrix')
    expect(joinRootFolder('D:\\Movies', 'The Matrix')).toBe('D:\\Movies\\The Matrix')
  })

  test('folderOf is the last segment, trailing separator or not', () => {
    expect(folderOf('/processed_movies/The End?/')).toBe('The End?')
    expect(folderOf('/processed_tv/The Wire')).toBe('The Wire')
    expect(folderOf(null)).toBeNull()
  })
})

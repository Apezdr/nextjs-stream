/**
 * src/utils/deletionConfirmation.js: what an admin types to confirm deleting
 * an account, one rule for the dialog (when its button comes on) and the
 * route (which checks again).
 *
 * It used to be the account's email and nothing else. Two accounts in
 * production, old Facebook sign-ins, have an empty email: the dialog's button
 * could never come on for them, and the route would have refused them.
 */
import { confirmsDeletion, deletionConfirmationFor } from '@src/utils/deletionConfirmation'

const ID = '507f1f77bcf86cd799439011'
const ADA = { id: ID, name: 'Ada Lovelace', email: 'Ada.Lovelace@example.invalid' }
const NO_EMAIL = { id: ID, name: 'Linus Old-Account', email: '' }
const NOTHING = { id: ID, name: '', email: '' }

describe('deletionConfirmationFor', () => {
  test('is the email when the account has one', () => {
    expect(deletionConfirmationFor(ADA)).toEqual({ kind: 'email', value: 'Ada.Lovelace@example.invalid' })
  })

  test.each([
    ['empty', ''],
    ['spaces', '   '],
    ['null', null],
    ['missing', undefined],
    ['not text', 42],
  ])('is the name when the email is %s', (_label, email) => {
    expect(deletionConfirmationFor({ ...NO_EMAIL, email })).toEqual({ kind: 'name', value: 'Linus Old-Account' })
  })

  test('is the id when there is neither, as a page holds it (id) or as the database does (_id)', () => {
    expect(deletionConfirmationFor(NOTHING)).toEqual({ kind: 'id', value: ID })
    expect(deletionConfirmationFor({ _id: { toString: () => ID }, name: null })).toEqual({ kind: 'id', value: ID })
  })

  test('for no user at all there is nothing to confirm with', () => {
    expect(deletionConfirmationFor(null)).toEqual({ kind: 'id', value: '' })
    expect(deletionConfirmationFor(undefined)).toEqual({ kind: 'id', value: '' })
  })
})

describe('confirmsDeletion', () => {
  test('only the account’s own email confirms, whatever its case or the spaces around it', () => {
    expect(confirmsDeletion('Ada.Lovelace@example.invalid', ADA)).toBe(true)
    expect(confirmsDeletion('  ada.lovelace@EXAMPLE.invalid ', ADA)).toBe(true)

    expect(confirmsDeletion('', ADA)).toBe(false)
    expect(confirmsDeletion('ada.lovelace@example.invali', ADA)).toBe(false)
    expect(confirmsDeletion('ada.lovelace@example.invalid.', ADA)).toBe(false)
    expect(confirmsDeletion('grace@example.invalid', ADA)).toBe(false)
    expect(confirmsDeletion(undefined, ADA)).toBe(false)
    expect(confirmsDeletion({ $ne: null }, ADA)).toBe(false)
  })

  test('an account with an email is not confirmed by its name or its id', () => {
    expect(confirmsDeletion('Ada Lovelace', ADA)).toBe(false)
    expect(confirmsDeletion(ID, ADA)).toBe(false)
  })

  test('an account with no email is confirmed by its name, and by nothing else', () => {
    expect(confirmsDeletion('Linus Old-Account', NO_EMAIL)).toBe(true)
    expect(confirmsDeletion(' linus old-account ', NO_EMAIL)).toBe(true)

    expect(confirmsDeletion('Linus', NO_EMAIL)).toBe(false)
    expect(confirmsDeletion('', NO_EMAIL)).toBe(false)
    expect(confirmsDeletion('   ', NO_EMAIL)).toBe(false)
    expect(confirmsDeletion(ID, NO_EMAIL)).toBe(false)
    expect(confirmsDeletion('undefined', { ...NO_EMAIL, email: undefined })).toBe(false)
  })

  test('an account with neither is confirmed by its id', () => {
    expect(confirmsDeletion(ID, NOTHING)).toBe(true)
    expect(confirmsDeletion(ID.toUpperCase(), NOTHING)).toBe(true)
    expect(confirmsDeletion('507f1f77bcf86cd799439012', NOTHING)).toBe(false)
    expect(confirmsDeletion('', NOTHING)).toBe(false)
  })

  test('nothing confirms when there is no account, whatever is typed', () => {
    expect(confirmsDeletion('', null)).toBe(false)
    expect(confirmsDeletion('undefined', undefined)).toBe(false)
    expect(confirmsDeletion('', {})).toBe(false)
  })
})

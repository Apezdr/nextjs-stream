// src/utils/deletionConfirmation.js
// What an admin types to confirm deleting an account from the Users page, and
// the check of what they typed. One rule for the dialog, which decides when
// its button comes on, and for the route, which checks again. No imports:
// the dialog is a client component.
//
// The confirmation is the account's email. Not every account has one: an
// account made through a provider that gave no email (old Facebook sign-ins)
// has an empty address, and a dialog that only accepted an email could never
// be confirmed for it. Such an account is confirmed by its name, and one with
// neither by its id. The id always identifies the account; what is typed is
// there to make the admin look at which account it is.

const text = (value) => (typeof value === 'string' ? value.trim() : '')

/** A user's id as text: `id` as the pages hold it, `_id` as the database does. */
function idOf(user) {
  const id = user?.id ?? user?._id
  return id == null ? '' : String(id)
}

/**
 * What must be typed to confirm deleting this account.
 * @param {{ id?: unknown, _id?: unknown, email?: unknown, name?: unknown }|null|undefined} user
 * @returns {{ kind: 'email'|'name'|'id', value: string }} `value` is empty only for no user at all
 */
export function deletionConfirmationFor(user) {
  const email = text(user?.email)
  if (email) return { kind: 'email', value: email }
  const name = text(user?.name)
  if (name) return { kind: 'name', value: name }
  return { kind: 'id', value: idOf(user) }
}

const fold = (value) => value.trim().toLowerCase()

/**
 * Whether what was typed confirms deleting this account: its confirmation,
 * case and the spaces around it aside. Nothing typed never confirms, and
 * nothing confirms an account that has nothing to be confirmed by.
 */
export function confirmsDeletion(typed, user) {
  const { value } = deletionConfirmationFor(user)
  return value !== '' && typeof typed === 'string' && fold(typed) === fold(value)
}

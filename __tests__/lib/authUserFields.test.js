/**
 * @jest-environment node
 *
 * Who may write the extra user fields. better-auth's POST
 * /api/auth/update-user passes the request body through parseUserInput,
 * which accepts every field whose `input` isn't false. `approved` and
 * `limitedAccess` were `input: true`, so any signed-in user could approve
 * themselves; now only the server writes them.
 *
 * Runs better-auth's own parseUserInput. Jest doesn't transform its ESM
 * build, so a small Node ESM process does the call.
 */
import { execFileSync } from 'node:child_process'
import { USER_ADDITIONAL_FIELDS } from '@src/lib/authUserFields'

const SCRIPT = `
import { parseUserInput } from 'better-auth/db'
const [fields, body, action] = JSON.parse(process.argv[1])
try {
  console.log(JSON.stringify({ ok: parseUserInput({ user: { additionalFields: fields } }, body, action) }))
} catch (error) {
  console.log(JSON.stringify({ error: error.message }))
}
`

function parseUserInput(body, action) {
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', SCRIPT, JSON.stringify([USER_ADDITIONAL_FIELDS, body, action])],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
  return JSON.parse(output.trim().split('\n').pop())
}

test.each([[{ approved: true }], [{ limitedAccess: false, approved: true }], [{ limitedAccess: true }]])(
  'update-user refuses %j',
  (body) => {
    expect(parseUserInput(body, 'update').error).toMatch(/is not allowed to be set/)
  }
)

test('a user may still update their own preferences', () => {
  expect(parseUserInput({ preferences: '{"theme":"dark"}' }, 'update')).toEqual({
    ok: { preferences: '{"theme":"dark"}' },
  })
})

test('sign-up input can’t set them either: the defaults apply, and the create hook decides', () => {
  expect(parseUserInput({ approved: true, limitedAccess: true }, 'create').ok).toMatchObject({
    approved: false,
    limitedAccess: false,
  })
})

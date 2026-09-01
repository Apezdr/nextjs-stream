import { stripAuthCookies } from '@src/lib/authCookies'

// Regression cover for the bearer-vs-cookie precedence bug: better-auth's
// bearer plugin appends its re-signed token to the Cookie header, and
// better-call's parseCookies keeps only the FIRST occurrence of a name — so a
// stale session cookie shadows a valid bearer token and the session resolves
// to null. The proxy drops auth cookies whenever a bearer token is present.
describe('stripAuthCookies', () => {
  const SESSION = '__Secure-nextjs-stream.session_token'

  it('removes the session cookie that shadows a bearer token', () => {
    expect(stripAuthCookies(`${SESSION}=dead`)).toBeNull()
  })

  it('keeps unrelated cookies intact', () => {
    expect(stripAuthCookies(`${SESSION}=dead; theme=dark; cf_clearance=abc`)).toBe(
      'theme=dark; cf_clearance=abc'
    )
  })

  it('removes every auth cookie variant, including the legacy prefix', () => {
    const header = [
      'better-auth.session_token=old',
      '__Secure-nextjs-stream.session_data=cache',
      '__Secure-nextjs-stream.dont_remember=1',
      'keep=me',
    ].join('; ')

    expect(stripAuthCookies(header)).toBe('keep=me')
  })

  it('strips duplicates of the same name at different scopes', () => {
    // The parent-domain vs host-only pair is exactly what a Set-Cookie fix
    // could not overwrite — both must go.
    expect(stripAuthCookies(`${SESSION}=stale; ${SESSION}=fresh`)).toBeNull()
  })

  it('leaves a cookie header with no auth cookies unchanged', () => {
    expect(stripAuthCookies('theme=dark; lang=en')).toBe('theme=dark; lang=en')
  })

  it('tolerates malformed pairs without an equals sign', () => {
    expect(stripAuthCookies(`junk; ${SESSION}=dead; keep=me`)).toBe('junk; keep=me')
  })
})

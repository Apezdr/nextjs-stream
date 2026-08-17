import fs from 'node:fs'
import path from 'node:path'

describe('admin sidebar scaffold cleanup', () => {
  it('does not ship the unused Tailwind team placeholders in either sidebar', () => {
    // Mobile and desktop used independent copies, so source-level coverage
    // prevents one hidden breakpoint variant from being accidentally retained.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(styled)/admin/layout.js'),
      'utf8'
    )

    expect(source).not.toMatch(/Your teams|Heroicons|Tailwind Labs|Workcation/)
    expect(source).toContain('Server Status')
    expect(source).toContain('Go back to Site')
    expect(source.indexOf("name: 'Movies'")).toBeLessThan(source.indexOf("name: 'TV'"))
  })
})
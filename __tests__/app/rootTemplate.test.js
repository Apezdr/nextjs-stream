/**
 * The root template wraps every page, so whatever it server-renders decides
 * whether a hard load is visible before the JavaScript arrives.
 *
 * As a framer-motion component with initial="hidden" it was server-rendered
 * with style="opacity:0": the prerendered page sat in the browser, invisible,
 * until hydration (measured: content in the page at 0.7 s, first visible at
 * 2.4 s on a slow CPU). These tests render it the way the server does.
 */

import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('react-toastify', () => ({ ToastContainer: () => null }))
jest.mock('react-toastify/dist/ReactToastify.css', () => ({}), { virtual: true })
jest.mock('@src/contexts/SystemStatusContext', () => ({ SystemStatusProvider: ({ children }) => children }))
jest.mock('@src/contexts/NotificationContext', () => ({ NotificationProvider: ({ children }) => children }))

const Template = require('@src/app/template').default

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('root template', () => {
  it('server-renders the page visible: no inline opacity, no inline transform', () => {
    const html = renderToStaticMarkup(
      <Template>
        <p>page content</p>
      </Template>
    )
    expect(html).toContain('<p>page content</p>')
    expect(html).not.toMatch(/opacity\s*:\s*0/)
    expect(html).not.toContain('style=')
  })

  it('fades in with the CSS animation, only for people who have not asked for reduced motion', () => {
    const html = renderToStaticMarkup(<Template>x</Template>)
    expect(html).toContain('class="motion-safe:animate-page-enter"')
  })

  it('does not bring framer-motion back', () => {
    // The file's comment mentions it by name; what matters is that nothing imports it
    expect(read('src/app/template.js')).not.toMatch(/from\s+['"]framer-motion['"]|<motion\./)
  })
})

describe('the entrance animations', () => {
  const config = require(path.join(process.cwd(), 'tailwind.config.js'))
  const { keyframes, animation } = config.theme.extend

  it('end where the element rests, so they need no fill-mode', () => {
    expect(keyframes['page-enter'].to).toEqual({ opacity: '1' })
    expect(keyframes['rise-in'].to).toEqual({ opacity: '1', transform: 'translateY(0)' })
  })

  it.each(Object.entries(animation))('%s does not keep filling after it ends', (_name, value) => {
    // forwards/both would leave a permanent stacking context, and with a
    // transform a containing block for every position:fixed descendant
    expect(value).not.toMatch(/\b(forwards|both)\b/)
  })
})

describe('landing page', () => {
  it('is not wrapped in a motion component that server-renders hidden', () => {
    const source = read('src/app/(styled)/page.js')
    expect(source).not.toContain('PageContentAnimatePresence')
    expect(source).toContain('motion-safe:animate-rise-in')
  })
})

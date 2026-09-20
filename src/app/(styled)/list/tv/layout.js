/**
 * TV subtree layout. Deliberately does nothing.
 *
 * It used to await the session and redirect unapproved accounts. A layout that
 * awaits anything keeps every page beneath it out of the prerendered shell, so
 * no link could have these pages ready before the click. The approval check now
 * runs in each page, inside the page's own Suspense boundary: SessionGate for
 * the browse and info pages, an inline redirect in the player page.
 *
 * SECURITY: a page added under this folder gets NO approval check from here.
 * __tests__/app/approvalGates.test.js fails until it has its own.
 */
export default function TVSubtreeLayout({ children }) {
  return children
}
